import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { attemptStatus, lockedLessonIds, resumeLesson, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { tell } from './routes-compliance.ts';
import { actingAs } from './effects.ts';
import { STARTER_COURSES } from './starter-courses.ts';
import { uuid } from './crm-helpers.ts';
import { recordCeForCompletion } from './routes-ce.ts';
import type { AppDeps } from './app.ts';

type Locale = 'en' | 'fr-CA';
const localeProp = { enum: ['en', 'fr-CA'] } as const;
const LESSON_TYPES = ['richtext', 'link', 'video', 'quiz'] as const;
const idParams = { type: 'object', properties: { id: uuid } } as const;

/** Nodes where the caller may build and assign training: admins, managers and trainers. */
const authorNodes = (ctx: RequestContext): string[] => ctx.roles.filter((r) => ['admin', 'manager', 'trainer'].includes(r.role)).map((r) => r.nodeId);
/** Extra tries a manager gave this learner for one quiz. */
const extraTries = async (tx: Tx, enrollmentId: string | undefined, lessonId: string): Promise<number> => {
  if (!enrollmentId) return 0;
  const r = (await tx.query<{ n: number }>(`SELECT coalesce((extra_attempts ->> $2)::int, 0) AS n FROM enrollments WHERE id = $1`, [enrollmentId, lessonId])).rows[0];
  return r?.n ?? 0;
};
const canAuthorAt = (ctx: RequestContext, ownerNodeId: string): boolean => ctx.isTenantAdmin || authorNodes(ctx).includes(ownerNodeId);
/** Question banks: each attempt shows a fixed random subset, the same one the server later grades. It changes with every attempt. */
const drawQuestions = <T extends { id: string }>(qs: T[], draw: number | null, seed: string): T[] => {
  if (!draw || draw >= qs.length) return qs;
  const key = (q: T) => createHash('sha256').update(`${seed}:${q.id}`).digest('hex');
  const keep = new Set([...qs].sort((a, b) => key(a).localeCompare(key(b))).slice(0, draw).map((q) => q.id));
  return qs.filter((q) => keep.has(q.id));
};
const loc = (q: { locale?: string }): Locale => (q.locale === 'fr-CA' ? 'fr-CA' : 'en');

/** Course title or description in the reader's language, falling back to English. */
const courseText = (col: 'title' | 'description', l: Locale, a = 'c') =>
  `COALESCE((SELECT ${col} FROM course_locales WHERE course_id = ${a}.id AND locale = '${l}'), (SELECT ${col} FROM course_locales WHERE course_id = ${a}.id AND locale = 'en'), '')`;
const lessonTitle = (l: Locale, a = 'l') =>
  `COALESCE((SELECT title FROM lesson_locales WHERE lesson_id = ${a}.id AND locale = '${l}'), (SELECT title FROM lesson_locales WHERE lesson_id = ${a}.id AND locale = 'en'), '')`;

export function registerLmsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  async function loadCourse(tx: Tx, id: string) {
    const { rows } = await tx.query<{ id: string; owner_node_id: string; status: string; enrollment_mode: string }>('SELECT id, owner_node_id, status, enrollment_mode FROM courses WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Course not found');
    return rows[0];
  }
  async function loadLesson(tx: Tx, id: string) {
    const { rows } = await tx.query<{ id: string; course_id: string; module_id: string; type: string; required: boolean; pass_mark: number | null; max_attempts: number | null; cooldown_minutes: number | null; quiz_draw: number | null; owner_node_id: string; status: string }>(
      `SELECT l.id, l.course_id, l.module_id, l.type, l.required, l.pass_mark, l.max_attempts, l.cooldown_minutes, l.quiz_draw, c.owner_node_id, c.status FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = $1`, [id]);
    if (!rows[0]) throw notFound('Lesson not found');
    return rows[0];
  }
  /** A published course's content is frozen: unpublish it, make the change, and publish again to release the next version. */
  const requireEditable = (status: string) => {
    if (status === 'published') throw conflict('This course is published, so its lessons are locked. Unpublish it, make your changes, then publish again to release a new version.');
  };
  const requireAuthor = (ctx: RequestContext, ownerNodeId: string) => {
    if (!canAuthorAt(ctx, ownerNodeId)) throw forbidden('Only a trainer, manager or administrator of the owning branch can change this course');
  };

  /** In a step-by-step course, learners cannot open or finish a lesson before the required ones ahead of it. Authors are never held back. */
  async function assertUnlocked(tx: Tx, ctx: RequestContext, courseId: string, lessonId: string, ownerNodeId: string) {
    if (canAuthorAt(ctx, ownerNodeId)) return;
    if (!(await tx.query('SELECT 1 FROM courses WHERE id = $1 AND sequential', [courseId])).rowCount) return;
    const rows = (await tx.query<{ id: string; required: boolean; done: boolean }>(
      `SELECT l.id, l.required, (p.status = 'completed') IS TRUE AS done FROM lessons l
         LEFT JOIN enrollments e ON e.user_id = $2 AND e.course_id = l.course_id
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.enrollment_id = e.id WHERE l.course_id = $1 ORDER BY l.position`, [courseId, ctx.userId])).rows;
    if (lockedLessonIds(rows).has(lessonId)) throw forbidden('Finish the earlier lessons first');
  }

  /** Everyone is a learner: opening a published course you can see enrolls you, unless you already are. */
  async function ensureEnrollment(tx: Tx, ctx: RequestContext, courseId: string): Promise<string> {
    const have = await tx.query<{ id: string }>('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [ctx.userId, courseId]);
    if (have.rows[0]) return have.rows[0].id;
    const c = await loadCourse(tx, courseId);
    if (c.status !== 'published') throw forbidden('This course is not published yet');
    if (c.enrollment_mode === 'approval' && !canAuthorAt(ctx, c.owner_node_id)) throw forbidden('This course needs approval. Ask to join it first.');
    const home = (await tx.query<{ home_node_id: string }>('SELECT home_node_id FROM app_users WHERE id = $1', [ctx.userId])).rows[0]?.home_node_id ?? ctx.nodeIds[0]!;
    const id = randomUUID();
    await tx.query(`INSERT INTO enrollments (id, tenant_id, user_id, course_id, learner_node_id) VALUES ($1,$2,$3,$4,$5)`, [id, ctx.tenantId, ctx.userId, courseId, home]);
    return id;
  }

  async function recompute(tx: Tx, ctx: RequestContext, enrollmentId: string, courseId: string): Promise<{ progressPct: number; completed: boolean }> {
    const r = (await tx.query<{ total: number; required: number; done: number; done_required: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE l.required)::int AS required,
              count(p.lesson_id)::int AS done, count(p.lesson_id) FILTER (WHERE l.required)::int AS done_required
         FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.enrollment_id = $1 AND p.status = 'completed'
        WHERE l.course_id = $2`, [enrollmentId, courseId])).rows[0]!;
    const pct = r.total ? Math.round((r.done / r.total) * 10000) / 100 : 0;
    const completed = r.total > 0 && r.done > 0 && r.done_required >= r.required;
    await tx.query(
      `UPDATE enrollments SET progress_pct = $2, started_at = coalesce(started_at, now()),
         status = CASE WHEN $3 THEN 'completed' ELSE 'in_progress' END,
         completed_at = CASE WHEN $3 THEN coalesce(completed_at, now()) ELSE NULL END WHERE id = $1`, [enrollmentId, pct, completed]);
    if (completed) {
      const lang = (await tx.query<{ locale: string }>('SELECT locale FROM app_users WHERE id = $1', [ctx.userId])).rows[0]?.locale ?? 'en';
      await tx.query('INSERT INTO certificates (tenant_id, enrollment_id, locale) VALUES ($1,$2,$3) ON CONFLICT (enrollment_id) DO NOTHING', [ctx.tenantId, enrollmentId, lang]);
      await recordCeForCompletion(tx, ctx, enrollmentId, courseId);
    }
    return { progressPct: pct, completed };
  }

  // ------------------------------------------------------------------ courses
  app.post(
    '/v1/courses',
    { schema: { body: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 4000 }, ownerNodeId: uuid, locale: localeProp, quebecFacing: { type: 'boolean' } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const b = req.body as { title: string; description?: string; ownerNodeId?: string; locale?: Locale; quebecFacing?: boolean };
      const owner = b.ownerNodeId ?? authorNodes(ctx)[0];
      if (!owner || !canAuthorAt(ctx, owner)) throw forbidden('Only a trainer, manager or administrator can create a course');
      const out = await run(ctx, async (tx) => {
        const id = randomUUID();
        const l = b.locale ?? 'en';
        await tx.query(`INSERT INTO courses (id, tenant_id, owner_node_id, default_locale, quebec_facing, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.tenantId, owner, l, b.quebecFacing ?? false, ctx.userId]);
        await tx.query(`INSERT INTO course_locales (course_id, tenant_id, locale, title, description, is_published) VALUES ($1,$2,$3,$4,$5,true)`, [id, ctx.tenantId, l, b.title.trim(), b.description ?? null]);
        await tx.query(`INSERT INTO course_modules (tenant_id, course_id, position, titles) VALUES ($1,$2,1,$3)`, [ctx.tenantId, id, JSON.stringify({ en: 'Lessons', 'fr-CA': 'Leçons' })]);
        await audit(tx, ctx, 'course_created', 'course', id);
        return { id };
      });
      return reply.code(201).send(out);
    },
  );

  app.get('/v1/courses', { schema: { querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const l = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT c.id, c.status, c.owner_node_id AS "ownerNodeId", c.quebec_facing AS "quebecFacing", c.ce_pack AS "cePack", c.ce_hours::float8 AS "ceHours", c.ce_category AS "ceCategory", ${courseText('title', l)} AS title, ${courseText('description', l)} AS description,
                (SELECT count(*)::int FROM lessons x WHERE x.course_id = c.id) AS "lessonCount", c.starter_key AS "starterKey",
                (SELECT coalesce(sum(cardinality(regexp_split_to_array(btrim(coalesce(ll.body->>'text', '')), '[[:space:]]+'))), 0)::int FROM lessons x JOIN lesson_locales ll ON ll.lesson_id = x.id AND ll.locale = 'en' WHERE x.course_id = c.id) AS words,
                (SELECT count(*)::int FROM lessons x WHERE x.course_id = c.id AND x.type = 'video') AS videos,
                (SELECT count(*)::int FROM quiz_questions q JOIN lessons x ON x.id = q.lesson_id WHERE x.course_id = c.id) AS questions,
                e.status AS "myStatus", e.progress_pct::float8 AS "myProgress", e.due_at AS "myDueAt"
           FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
          WHERE c.status <> 'archived' ORDER BY c.created_at DESC`, [ctx.userId])).rows as Array<Record<string, unknown> & { ownerNodeId: string }>;
      // a draft is the author's work in progress: nobody else sees it until it is published
      return { courses: rows.map((r) => ({ ...r, canEdit: canAuthorAt(ctx, r.ownerNodeId) })).filter((r) => (r as { status?: unknown }).status !== 'draft' || r.canEdit) };
    });
  });

  app.get('/v1/courses/:id', { schema: { params: idParams, querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const l = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => {
      const c = (await tx.query(`SELECT c.id, c.status, c.version, c.sequential, c.starter_key AS "starterKey", c.enrollment_mode AS "enrollmentMode", c.owner_node_id AS "ownerNodeId", c.quebec_facing AS "quebecFacing", c.ce_pack AS "cePack", c.ce_hours::float8 AS "ceHours", c.ce_category AS "ceCategory", ${courseText('title', l)} AS title, ${courseText('description', l)} AS description FROM courses c WHERE c.id = $1`, [id])).rows[0];
      if (!c) throw notFound('Course not found');
      if (c.status === 'draft' && !canAuthorAt(ctx, c.ownerNodeId)) throw notFound('Course not found');
      const e = (await tx.query(`SELECT id, status, course_version AS "courseVersion", last_lesson_id AS "lastLessonId", progress_pct::float8 AS "progressPct", due_at AS "dueAt", completed_at AS "completedAt" FROM enrollments WHERE course_id = $1 AND user_id = $2`, [id, ctx.userId])).rows[0] ?? null;
      const lessons = (await tx.query(
        `SELECT l.id, l.module_id AS "moduleId", l.position, l.type, l.required, l.pass_mark AS "passMark", ${lessonTitle(l)} AS title, (p.status = 'completed') AS done,
                (SELECT cardinality(regexp_split_to_array(btrim(coalesce(ll.body->>'text', '')), '[[:space:]]+')) FROM lesson_locales ll WHERE ll.lesson_id = l.id AND ll.locale = 'en') AS words,
                (SELECT count(*)::int FROM quiz_questions q WHERE q.lesson_id = l.id) AS questions
           FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.enrollment_id = $2
          WHERE l.course_id = $1 ORDER BY l.position`, [id, e?.id ?? null])).rows;
      const cert = e ? (await tx.query(`SELECT id, verification_code AS "verificationCode", issued_at AS "issuedAt" FROM certificates WHERE enrollment_id = $1`, [e.id])).rows[0] ?? null : null;
      if (cert) cert.url = `${deps.config.appOrigin}/c/${cert.verificationCode}`;
      const canEdit = canAuthorAt(ctx, c.ownerNodeId);
      const locales = canEdit ? (await tx.query(`SELECT locale, title, description FROM course_locales WHERE course_id = $1`, [id])).rows : undefined;
      const myRequest = e ? null : (await tx.query(`SELECT id, status, decision_note AS "decisionNote" FROM enrollment_requests WHERE course_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`, [id, ctx.userId])).rows[0] ?? null;
      const rows = lessons.map((x) => ({ ...x, done: Boolean(x.done) }));
      const locked = c.sequential && !canEdit ? lockedLessonIds(rows) : new Set<string>();
      const resumeLessonId = e && e.status !== 'completed' ? resumeLesson(rows, locked, e.lastLessonId ?? null) : null;
      return { ...c, canEdit, enrollment: e, certificate: cert, myRequest, lessons: rows.map((x) => ({ ...x, locked: locked.has(x.id) })), resumeLessonId, locales };
    });
  });

  app.patch(
    '/v1/courses/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 4000 }, locale: localeProp, status: { enum: ['draft', 'published', 'archived'] }, quebecFacing: { type: 'boolean' }, sequential: { type: 'boolean' }, enrollmentMode: { enum: ['open', 'approval'] }, ce: { anyOf: [{ type: 'null' }, { type: 'object', required: ['pack', 'hours', 'category'], additionalProperties: false, properties: { pack: { type: 'string', maxLength: 30 }, hours: { type: 'number', minimum: 0.5, maximum: 40 }, category: { enum: ['technical', 'management', 'ethics', 'professional_development', 'general'] } } }] } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { title?: string; description?: string; locale?: Locale; status?: string; quebecFacing?: boolean; sequential?: boolean; enrollmentMode?: 'open' | 'approval'; ce?: { pack: string; hours: number; category: string } | null };
      await run(ctx, async (tx) => {
        const c = await loadCourse(tx, id);
        requireAuthor(ctx, c.owner_node_id);
        const l = b.locale ?? 'en';
        if (b.title !== undefined || b.description !== undefined) {
          if (b.title === undefined && l !== 'en') {
            const has = await tx.query('SELECT 1 FROM course_locales WHERE course_id = $1 AND locale = $2', [id, l]);
            if (has.rowCount === 0) throw invalid('Give a title for the new language');
          }
          await tx.query(
            `INSERT INTO course_locales (course_id, tenant_id, locale, title, description, is_published) VALUES ($1,$2,$3,coalesce($4,''),$5,true)
             ON CONFLICT (course_id, locale) DO UPDATE SET title = coalesce($4, course_locales.title), description = coalesce($5, course_locales.description)`,
            [id, ctx.tenantId, l, b.title?.trim() ?? null, b.description ?? null]);
        }
        if (c.status === 'published' && (b.ce !== undefined || b.quebecFacing !== undefined || b.sequential !== undefined)) requireEditable(c.status);
        if (b.enrollmentMode !== undefined) await tx.query('UPDATE courses SET enrollment_mode = $2, updated_at = now() WHERE id = $1', [id, b.enrollmentMode]);
        if (b.sequential !== undefined) await tx.query('UPDATE courses SET sequential = $2, updated_at = now() WHERE id = $1', [id, b.sequential]);
        if (b.status === 'published') {
          const n = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM lessons WHERE course_id = $1', [id])).rows[0]!.n;
          if (n === 0) throw invalid('Add at least one lesson before publishing');
          // The same course must not be published twice: another published course with this title blocks it.
          const dupe = (await tx.query<{ title: string }>(
            `SELECT l2.title FROM course_locales l1
               JOIN course_locales l2 ON lower(btrim(l2.title)) = lower(btrim(l1.title)) AND l2.locale = l1.locale AND l2.course_id <> l1.course_id
               JOIN courses c2 ON c2.id = l2.course_id AND c2.status = 'published'
              WHERE l1.course_id = $1 AND l1.title <> '' LIMIT 1`, [id])).rows[0];
          if (dupe) throw conflict(`A course called “${dupe.title}” is already published. Open that one, or rename this course before publishing it.`);
        }
        if (b.status !== undefined || b.quebecFacing !== undefined) {
          await tx.query('UPDATE courses SET status = coalesce($2::course_status, status), quebec_facing = coalesce($3, quebec_facing), updated_at = now() WHERE id = $1', [id, b.status ?? null, b.quebecFacing ?? null]);
        }
        if (b.ce !== undefined) {
          if (b.ce && Math.round(b.ce.hours * 2) !== b.ce.hours * 2) throw invalid('Hours go in half-hour steps');
          if (b.ce && !(await tx.query('SELECT 1 FROM ce_rule_packs WHERE code = $1 AND active', [b.ce.pack])).rowCount) throw invalid('Unknown regulator');
          await tx.query('UPDATE courses SET ce_pack = $2, ce_hours = $3, ce_category = $4, updated_at = now() WHERE id = $1', [id, b.ce?.pack ?? null, b.ce?.hours ?? null, b.ce?.category ?? null]);
        }
        let version: number | undefined;
        if (b.status === 'published') version = (await tx.query<{ v: number }>('SELECT publish_course_version($1, $2) AS v', [id, ctx.userId])).rows[0]!.v;
        await audit(tx, ctx, b.status ? `course_${b.status}` : 'course_updated', 'course', id, version ? { version } : undefined);
      });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------ lessons
  app.post(
    '/v1/courses/:id/lessons',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object', required: ['title', 'type'], additionalProperties: false,
          properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, type: { enum: [...LESSON_TYPES] }, text: { type: 'string', maxLength: 50000 }, url: { type: 'string', maxLength: 2000 }, required: { type: 'boolean' }, passMark: { type: 'integer', minimum: 0, maximum: 100 }, maxAttempts: { type: 'integer', minimum: 1, maximum: 50 }, locale: localeProp },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { title: string; type: (typeof LESSON_TYPES)[number]; text?: string; url?: string; required?: boolean; passMark?: number; maxAttempts?: number; locale?: Locale };
      if ((b.type === 'link' || b.type === 'video') && !/^https:\/\//i.test(b.url ?? '')) throw invalid('Give a link starting with https://');
      const out = await run(ctx, async (tx) => {
        const c = await loadCourse(tx, id);
        requireAuthor(ctx, c.owner_node_id);
        requireEditable(c.status);
        const mod = (await tx.query<{ id: string }>('SELECT id FROM course_modules WHERE course_id = $1 ORDER BY position LIMIT 1', [id])).rows[0];
        if (!mod) throw invalid('The course has no module');
        const pos = (await tx.query<{ p: number }>('SELECT coalesce(max(position), 0) + 1 AS p FROM lessons WHERE course_id = $1', [id])).rows[0]!.p;
        const lid = randomUUID();
        await tx.query(
          `INSERT INTO lessons (id, tenant_id, course_id, module_id, position, type, required, pass_mark, max_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [lid, ctx.tenantId, id, mod.id, pos, b.type, b.required ?? true, b.type === 'quiz' ? (b.passMark ?? 70) : null, b.type === 'quiz' ? (b.maxAttempts ?? null) : null]);
        await tx.query(`INSERT INTO lesson_locales (lesson_id, tenant_id, locale, title, body) VALUES ($1,$2,$3,$4,$5)`,
          [lid, ctx.tenantId, b.locale ?? 'en', b.title.trim(), JSON.stringify({ ...(b.text ? { text: b.text } : {}), ...(b.url ? { url: b.url } : {}) })]);
        await audit(tx, ctx, 'lesson_created', 'course', id, { lessonId: lid });
        return { id: lid };
      });
      return reply.code(201).send(out);
    },
  );

  app.patch(
    '/v1/lessons/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, text: { type: 'string', maxLength: 50000 }, url: { type: 'string', maxLength: 2000 }, required: { type: 'boolean' }, passMark: { type: 'integer', minimum: 0, maximum: 100 }, maxAttempts: { type: ['integer', 'null'], minimum: 1, maximum: 50 }, cooldownMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 10080 }, quizDraw: { type: ['integer', 'null'], minimum: 1, maximum: 100 }, locale: localeProp } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { title?: string; text?: string; url?: string; required?: boolean; passMark?: number; maxAttempts?: number | null; cooldownMinutes?: number | null; quizDraw?: number | null; locale?: Locale };
      if (b.url !== undefined && !/^https:\/\//i.test(b.url)) throw invalid('Give a link starting with https://');
      await run(ctx, async (tx) => {
        const l = await loadLesson(tx, id);
        requireAuthor(ctx, l.owner_node_id);
        requireEditable(l.status);
        if (b.required !== undefined || b.passMark !== undefined || 'maxAttempts' in b || 'cooldownMinutes' in b) {
          await tx.query(`UPDATE lessons SET required = coalesce($2, required), pass_mark = coalesce($3, pass_mark), max_attempts = CASE WHEN $4 THEN $5::int ELSE max_attempts END, cooldown_minutes = CASE WHEN $6 THEN $7::int ELSE cooldown_minutes END WHERE id = $1`, [id, b.required ?? null, b.passMark ?? null, 'maxAttempts' in b, b.maxAttempts ?? null, 'cooldownMinutes' in b, b.cooldownMinutes ?? null]);
        }
        if ('quizDraw' in b) await tx.query('UPDATE lessons SET quiz_draw = $2::int WHERE id = $1', [id, b.quizDraw ?? null]);
        if (b.title !== undefined || b.text !== undefined || b.url !== undefined) {
          const lang = b.locale ?? 'en';
          const cur = (await tx.query<{ body: Record<string, unknown> }>('SELECT body FROM lesson_locales WHERE lesson_id = $1 AND locale = $2', [id, lang])).rows[0];
          if (!cur && !b.title) throw invalid('Give a title for the new language');
          const body = { ...(cur?.body ?? {}), ...(b.text !== undefined ? { text: b.text } : {}), ...(b.url !== undefined ? { url: b.url } : {}) };
          await tx.query(
            `INSERT INTO lesson_locales (lesson_id, tenant_id, locale, title, body) VALUES ($1,$2,$3,coalesce($4,''),$5)
             ON CONFLICT (lesson_id, locale) DO UPDATE SET title = coalesce($4, lesson_locales.title), body = $5`, [id, ctx.tenantId, lang, b.title?.trim() ?? null, JSON.stringify(body)]);
        }
        await audit(tx, ctx, 'lesson_updated', 'course', l.course_id, { lessonId: id });
      });
      return reply.code(204).send();
    },
  );

  app.delete('/v1/lessons/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const l = await loadLesson(tx, id);
      requireAuthor(ctx, l.owner_node_id);
      requireEditable(l.status);
      await tx.query('DELETE FROM lesson_progress WHERE lesson_id = $1', [id]);
      await tx.query('DELETE FROM quiz_attempts WHERE lesson_id = $1', [id]);
      await tx.query('DELETE FROM lessons WHERE id = $1', [id]);
      await audit(tx, ctx, 'lesson_deleted', 'course', l.course_id, { lessonId: id });
    });
    return reply.code(204).send();
  });

  app.put(
    '/v1/courses/:id/lessons/order',
    { schema: { params: idParams, body: { type: 'object', required: ['lessonIds'], additionalProperties: false, properties: { lessonIds: { type: 'array', items: uuid, minItems: 1, maxItems: 200 } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const { lessonIds } = req.body as { lessonIds: string[] };
      await run(ctx, async (tx) => {
        const c = await loadCourse(tx, id);
        requireAuthor(ctx, c.owner_node_id);
        requireEditable(c.status);
        const cur = (await tx.query<{ id: string }>('SELECT id FROM lessons WHERE course_id = $1', [id])).rows.map((r) => r.id);
        if (cur.length !== lessonIds.length || new Set(lessonIds).size !== lessonIds.length || !lessonIds.every((x) => cur.includes(x))) throw invalid('List every lesson exactly once');
        await tx.query('UPDATE lessons SET position = position + 10000 WHERE course_id = $1', [id]);
        for (let i = 0; i < lessonIds.length; i++) await tx.query('UPDATE lessons SET position = $2 WHERE id = $1', [lessonIds[i], i + 1]);
      });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------ quiz authoring
  app.put(
    '/v1/lessons/:id/quiz',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object', required: ['questions'], additionalProperties: false,
          properties: {
            locale: localeProp,
            questions: {
              type: 'array', minItems: 1, maxItems: 100,
              items: {
                type: 'object', required: ['prompt', 'options', 'correct'], additionalProperties: false,
                properties: {
                  type: { enum: ['single', 'multi', 'true_false'] }, prompt: { type: 'string', minLength: 1, maxLength: 1000 }, points: { type: 'integer', minimum: 1, maximum: 100 },
                  options: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } },
                  correct: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 0, maximum: 7 } },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { locale?: Locale; questions: { type?: string; prompt: string; options: string[]; correct: number[]; points?: number }[] };
      for (const q of b.questions) {
        if (q.correct.some((i) => i >= q.options.length)) throw invalid('A correct answer points to an option that does not exist');
        if ((q.type ?? 'single') !== 'multi' && q.correct.length !== 1) throw invalid('Single-answer questions need exactly one correct answer');
      }
      await run(ctx, async (tx) => {
        const l = await loadLesson(tx, id);
        requireAuthor(ctx, l.owner_node_id);
        if (l.type !== 'quiz') throw invalid('That lesson is not a quiz');
        requireEditable(l.status);
        await tx.query('DELETE FROM quiz_questions WHERE lesson_id = $1', [id]);
        for (const [i, q] of b.questions.entries()) {
          const keys = q.options.map((_, k) => String(k));
          await tx.query(
            `INSERT INTO quiz_questions (tenant_id, lesson_id, position, type, content, correct, points) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [ctx.tenantId, id, i + 1, q.type ?? 'single', JSON.stringify({ [b.locale ?? 'en']: { prompt: q.prompt, options: q.options.map((text, k) => ({ key: keys[k], text })) } }), JSON.stringify(q.correct.map(String)), q.points ?? 1]);
        }
        await audit(tx, ctx, 'quiz_updated', 'course', l.course_id, { lessonId: id, questions: b.questions.length });
      });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------ learning
  app.get('/v1/lessons/:id', { schema: { params: idParams, querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const lang = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => {
      const l = await loadLesson(tx, id);
      const canEdit = canAuthorAt(ctx, l.owner_node_id);
      if (l.status !== 'published' && !canEdit) throw notFound('Lesson not found');
      await assertUnlocked(tx, ctx, l.course_id, id, l.owner_node_id);
      if (!canEdit && (await tx.query(`SELECT 1 FROM courses c WHERE c.id = $1 AND c.enrollment_mode = 'approval' AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = $2)`, [l.course_id, ctx.userId])).rowCount) throw forbidden('This course needs approval. Ask to join it first.');
      const ll = (await tx.query<{ title: string; body: Record<string, unknown> }>(
        `SELECT title, body FROM lesson_locales WHERE lesson_id = $1 AND locale IN ($2, 'en') ORDER BY (locale = $2) DESC LIMIT 1`, [id, lang])).rows[0];
      const enr = (await tx.query<{ id: string }>('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [ctx.userId, l.course_id])).rows[0];
      if (enr) await tx.query('UPDATE enrollments SET last_lesson_id = $2 WHERE id = $1', [enr.id, id]);
      const prog = enr ? (await tx.query(`SELECT status FROM lesson_progress WHERE enrollment_id = $1 AND lesson_id = $2`, [enr.id, id])).rows[0] : undefined;
      let quiz: unknown;
      if (l.type === 'quiz') {
        const qs = (await tx.query<{ id: string; type: string; content: Record<string, { prompt: string; options: { key: string; text: string }[] }>; correct: string[]; points: number }>(
          'SELECT id, type, content, correct, points FROM quiz_questions WHERE lesson_id = $1 ORDER BY position', [id])).rows;
        const attempts = enr ? (await tx.query(`SELECT score_pct::float8 AS "scorePct", passed, attempted_at AS "attemptedAt", attempt_no AS "attemptNo" FROM quiz_attempts WHERE enrollment_id = $1 AND lesson_id = $2 ORDER BY attempted_at DESC`, [enr.id, id])).rows : [];
        const extra = await extraTries(tx, enr?.id, id);
        const cap = l.max_attempts ? l.max_attempts + extra : null;
        quiz = {
          passMark: l.pass_mark, maxAttempts: cap, cooldownMinutes: l.cooldown_minutes, attempts, ...(canEdit ? { baseMaxAttempts: l.max_attempts } : {}),
          status: attemptStatus({ maxAttempts: cap, cooldownMinutes: l.cooldown_minutes }, (attempts as { attemptedAt: string; passed: boolean }[])),
          ...(canEdit ? { baseDraw: l.quiz_draw } : {}), draw: l.quiz_draw && l.quiz_draw < qs.length ? l.quiz_draw : null, bankSize: qs.length,
          questions: (canEdit ? qs : drawQuestions(qs, l.quiz_draw, `${ctx.userId}:${id}:${(attempts as unknown[]).length}`)).map((q) => {
            const c = q.content[lang] ?? q.content.en ?? Object.values(q.content)[0]!;
            // the answer key leaves the server only for people who can edit the course
            return { id: q.id, type: q.type, prompt: c.prompt, options: c.options, points: q.points, ...(canEdit ? { correct: q.correct } : {}) };
          }),
        };
      }
      return { id, courseId: l.course_id, type: l.type, required: l.required, title: ll?.title ?? '', body: ll?.body ?? {}, done: prog?.status === 'completed', canEdit, quiz };
    });
  });

  app.post('/v1/lessons/:id/complete', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const l = await loadLesson(tx, id);
      if (l.type === 'quiz') throw invalid('Quizzes are completed by passing them');
      if (l.status !== 'published') throw forbidden('This course is not published yet');
      await assertUnlocked(tx, ctx, l.course_id, id, l.owner_node_id);
      const enr = await ensureEnrollment(tx, ctx, l.course_id);
      await tx.query(
        `INSERT INTO lesson_progress (enrollment_id, lesson_id, tenant_id, status, completed_at) VALUES ($1,$2,$3,'completed',now())
         ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET status = 'completed', completed_at = coalesce(lesson_progress.completed_at, now())`, [enr, id, ctx.tenantId]);
      return recompute(tx, ctx, enr, l.course_id);
    });
  });

  app.post(
    '/v1/lessons/:id/quiz/attempt',
    { schema: { params: idParams, body: { type: 'object', required: ['answers'], additionalProperties: false, properties: { answers: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string', maxLength: 4 }, maxItems: 8 } } } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const { answers } = req.body as { answers: Record<string, string[]> };
      return run(ctx, async (tx) => {
        const l = await loadLesson(tx, id);
        if (l.type !== 'quiz') throw invalid('That lesson is not a quiz');
        if (l.status !== 'published') throw forbidden('This course is not published yet');
        await assertUnlocked(tx, ctx, l.course_id, id, l.owner_node_id);
        const enr = await ensureEnrollment(tx, ctx, l.course_id);
        const prior = (await tx.query<{ attempted_at: string; passed: boolean }>('SELECT attempted_at, passed FROM quiz_attempts WHERE enrollment_id = $1 AND lesson_id = $2', [enr, id])).rows.map((r) => ({ attemptedAt: r.attempted_at, passed: r.passed }));
        const cap = l.max_attempts ? l.max_attempts + (await extraTries(tx, enr, id)) : null;
        const st = attemptStatus({ maxAttempts: cap, cooldownMinutes: l.cooldown_minutes }, prior);
        if (st.reason === 'no_attempts_left') throw forbidden('No attempts left for this quiz');
        if (st.reason === 'passed') throw conflict('You have already passed this quiz');
        if (st.reason === 'cooldown') throw conflict(`Please wait before trying again. The next attempt opens at ${st.nextAt}`);
        const bank = (await tx.query<{ id: string; type: string; correct: string[]; points: number }>('SELECT id, type, correct, points FROM quiz_questions WHERE lesson_id = $1 ORDER BY position', [id])).rows;
        const qs = drawQuestions(bank, l.quiz_draw, `${ctx.userId}:${id}:${prior.length}`);
        if (qs.length === 0) throw invalid('This quiz has no questions yet');
        let earned = 0, total = 0;
        const results: { questionId: string; correct: boolean }[] = [];
        for (const q of qs) {
          total += q.points;
          const given = [...new Set(answers[q.id] ?? [])].sort();
          const want = [...q.correct].sort();
          const ok = given.length === want.length && given.every((v, i) => v === want[i]);
          if (ok) earned += q.points;
          results.push({ questionId: q.id, correct: ok });
        }
        const score = Math.round((earned / total) * 10000) / 100;
        const passed = score >= (l.pass_mark ?? 0);
        await tx.query(`INSERT INTO quiz_attempts (tenant_id, enrollment_id, lesson_id, score_pct, passed, answers, attempt_no, course_version) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT course_version FROM enrollments WHERE id = $2))`, [ctx.tenantId, enr, id, score, passed, JSON.stringify(answers), prior.length + 1]);
        let progress = { progressPct: 0, completed: false };
        if (passed) {
          await tx.query(
            `INSERT INTO lesson_progress (enrollment_id, lesson_id, tenant_id, status, completed_at) VALUES ($1,$2,$3,'completed',now())
             ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET status = 'completed', completed_at = coalesce(lesson_progress.completed_at, now())`, [enr, id, ctx.tenantId]);
          progress = await recompute(tx, ctx, enr, l.course_id);
        }
        const after = attemptStatus({ maxAttempts: cap, cooldownMinutes: l.cooldown_minutes }, [...prior, { attemptedAt: new Date().toISOString(), passed }]);
        return { scorePct: score, passed, passMark: l.pass_mark, results, attemptNo: prior.length + 1, attemptsLeft: after.left, nextAttemptAt: after.nextAt, ...progress };
      });
    },
  );

  /** A trainer, manager or administrator gives one learner more tries at a quiz. */
  app.post('/v1/lessons/:id/quiz/extra-attempts', { schema: { params: idParams, body: { type: 'object', required: ['userId', 'extra'], additionalProperties: false, properties: { userId: uuid, extra: { type: 'integer', minimum: 1, maximum: 20 } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as { userId: string; extra: number };
    const course = await run(ctx, async (tx) => {
      const l = await loadLesson(tx, id);
      if (l.type !== 'quiz') throw invalid('That lesson is not a quiz');
      if (!canAuthorAt(ctx, l.owner_node_id)) throw forbidden('Only a trainer, manager or administrator of the owning branch can give extra attempts');
      if (!l.max_attempts) throw invalid('This quiz has no limit on attempts');
      const done = await tx.query(`UPDATE enrollments SET extra_attempts = jsonb_set(extra_attempts, ARRAY[$3::text], to_jsonb(coalesce((extra_attempts ->> $3)::int, 0) + $4::int)) WHERE user_id = $1 AND course_id = $2`, [b.userId, l.course_id, id, b.extra]);
      if (!done.rowCount) throw notFound('That person is not taking this course');
      await audit(tx, ctx, 'quiz_extra_attempts', 'lesson', id, { userId: b.userId, extra: b.extra });
      return (await tx.query<{ t: string }>(`SELECT ${courseText('title', 'en')} AS t FROM courses c WHERE c.id = $1`, [l.course_id])).rows[0]?.t ?? '';
    });
    await tell(deps, ctx.tenantId, [b.userId], 'quiz_attempts', ctx.userId, { course, lessonId: id, extra: b.extra });
    return reply.code(204).send();
  });

  app.post('/v1/courses/:id/enroll', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const eid = await run(ctx, (tx) => ensureEnrollment(tx, ctx, id));
    return reply.code(201).send({ id: eid });
  });

  app.get('/v1/my/learning', { schema: { querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const l = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => ({
      origin: deps.config.appOrigin,
      enrollments: (await tx.query(
        `SELECT e.id, e.course_id AS "courseId", ${courseText('title', l)} AS title, e.status, e.progress_pct::float8 AS "progressPct", e.due_at AS "dueAt", e.completed_at AS "completedAt",
                ct.verification_code AS "certificateCode", c.ce_hours::float8 AS "ceHours",
                e.course_version AS "courseVersion", c.version AS "latestVersion", (e.status = 'completed' AND e.course_version IS NOT NULL AND e.course_version < c.version) AS outdated
           FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN certificates ct ON ct.enrollment_id = e.id
          WHERE e.user_id = $1 ORDER BY (e.status = 'completed'), e.due_at NULLS LAST, e.started_at DESC NULLS LAST`, [ctx.userId])).rows,
    }));
  });

  // ------------------------------------------------------------------ assigning and watching progress
  const ROLES = ['admin', 'manager', 'trainer', 'member', 'learner'] as const;
  const ruleBody = { type: 'object', required: ['nodeId'], additionalProperties: false, properties: { nodeId: uuid, dueAt: { type: 'string', format: 'date-time' }, dueInDays: { type: 'integer', minimum: 1, maximum: 730 }, role: { enum: [...ROLES] } } } as const;
  type Rule = { nodeId: string; dueAt?: string; dueInDays?: number; role?: (typeof ROLES)[number] };

  /** Whoever assigns must lead the branch they assign to, or sit above it. */
  async function requireReach(tx: Tx, ctx: RequestContext, nodeId: string) {
    const reach = ctx.isTenantAdmin || (await tx.query(`SELECT 1 FROM org_reach r WHERE r.descendant_id = $1 AND r.ancestor_id = ANY($2::uuid[])`, [nodeId, authorNodes(ctx)])).rowCount! > 0 || authorNodes(ctx).includes(nodeId);
    if (!reach) throw forbidden('You can only assign training to your own branch or the partners beneath it');
  }

  /** Shows who a rule would enrol, before it is saved: nothing is written. */
  app.post('/v1/courses/:id/assignments/preview', { schema: { params: idParams, body: ruleBody } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as Rule;
    return run(ctx, async (tx) => {
      const c = await loadCourse(tx, id);
      requireAuthor(ctx, c.owner_node_id);
      await requireReach(tx, ctx, b.nodeId);
      const rows = (await tx.query<{ name: string; email: string; enrolled: boolean }>(
        `SELECT au.name, au.email, EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = au.user_id AND e.course_id = $4) AS enrolled
           FROM assignment_audience($1, $2, $3::org_role) au ORDER BY au.name LIMIT 2000`, [ctx.tenantId, b.nodeId, b.role ?? null, id])).rows;
      const fresh = rows.filter((r) => !r.enrolled);
      return { total: rows.length, alreadyEnrolled: rows.length - fresh.length, willEnrol: fresh.length, sample: fresh.slice(0, 10).map((r) => ({ name: r.name, email: r.email })) };
    });
  });

  app.post('/v1/courses/:id/assignments', { schema: { params: idParams, body: ruleBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as Rule;
    if (b.dueAt && b.dueInDays) throw invalid('Give a due date or a number of days, not both');
    const out = await run(ctx, async (tx) => {
      const c = await loadCourse(tx, id);
      requireAuthor(ctx, c.owner_node_id);
      if (c.status !== 'published') throw invalid('Publish the course before assigning it');
      await requireReach(tx, ctx, b.nodeId);
      const aid = (await tx.query<{ id: string }>(
        `INSERT INTO course_assignments (tenant_id, course_id, node_id, due_at, due_in_days, role, assigned_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (course_id, node_id) DO UPDATE SET due_at = EXCLUDED.due_at, due_in_days = EXCLUDED.due_in_days, role = EXCLUDED.role RETURNING id`,
        [ctx.tenantId, id, b.nodeId, b.dueAt ?? null, b.dueInDays ?? null, b.role ?? null, ctx.userId])).rows[0]!.id;
      const enrolled = (await tx.query<{ n: number }>('SELECT sync_enrollments($1) AS n', [aid])).rows[0]!.n;
      if (b.dueAt) await tx.query('UPDATE enrollments SET due_at = $2 WHERE assignment_id = $1 AND status <> \'completed\'', [aid, b.dueAt]);
      await audit(tx, ctx, 'course_assigned', 'course', id, { nodeId: b.nodeId, enrolled, role: b.role ?? null });
      return { id: aid, enrolled };
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/courses/:id/assignments', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const c = await loadCourse(tx, id);
      requireAuthor(ctx, c.owner_node_id);
      return { assignments: (await tx.query(
        `SELECT a.id, a.node_id AS "nodeId", n.name AS "nodeName", a.role, a.due_at AS "dueAt", a.due_in_days AS "dueInDays",
                (SELECT count(*)::int FROM enrollments e WHERE e.assignment_id = a.id) AS enrolled
           FROM course_assignments a JOIN org_nodes n ON n.id = a.node_id WHERE a.course_id = $1 ORDER BY n.name`, [id])).rows };
    });
  });

  // ------------------------------------------------------------------ starter courses
  app.get('/v1/courses/starter', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const have = await run(ctx, async (tx) => (await tx.query<{ starter_key: string; id: string }>(`SELECT starter_key, id FROM courses WHERE starter_key IS NOT NULL AND status <> 'archived'`)).rows);
    const added = new Map(have.map((r) => [r.starter_key, r.id]));
    return { courses: STARTER_COURSES.map((c) => ({ key: c.key, title: c.title, description: c.description, lessons: c.lessons.length, questions: c.quiz.length, courseId: added.get(c.key) ?? null })) };
  });

  /** Copies a starter course into the company as an unpublished draft, in both languages. Run again, it makes another copy. */
  app.post('/v1/courses/starter', { schema: { body: { type: 'object', required: ['key'], additionalProperties: false, properties: { key: { type: 'string', maxLength: 40 }, ownerNodeId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { key: string; ownerNodeId?: string };
    const sc = STARTER_COURSES.find((c) => c.key === b.key);
    if (!sc) throw notFound('Unknown starter course');
    const owner = b.ownerNodeId ?? authorNodes(ctx)[0] ?? ctx.nodeIds[0];
    if (!owner || !canAuthorAt(ctx, owner)) throw forbidden('Only a trainer, manager or administrator can add a course');
    const out = await run(ctx, async (tx) => {
      // Each starter course exists once per company: asking again opens the copy that is already there.
      const had = (await tx.query<{ id: string }>(`SELECT id FROM courses WHERE starter_key = $1 AND status <> 'archived' LIMIT 1`, [sc.key])).rows[0];
      if (had) return { id: had.id, existing: true };
      const id = randomUUID();
      await tx.query(`INSERT INTO courses (id, tenant_id, owner_node_id, default_locale, quebec_facing, created_by, starter_key) VALUES ($1,$2,$3,'en',false,$4,$5)`, [id, ctx.tenantId, owner, ctx.userId, sc.key]);
      for (const [loc, key] of [['en', 'en'], ['fr-CA', 'fr']] as const)
        await tx.query(`INSERT INTO course_locales (course_id, tenant_id, locale, title, description, is_published) VALUES ($1,$2,$3,$4,$5,true)`, [id, ctx.tenantId, loc, sc.title[key], sc.description[key]]);
      const mod = (await tx.query<{ id: string }>(`INSERT INTO course_modules (tenant_id, course_id, position, titles) VALUES ($1,$2,1,$3) RETURNING id`, [ctx.tenantId, id, JSON.stringify({ en: 'Lessons', 'fr-CA': 'Leçons' })])).rows[0]!.id;
      let pos = 0;
      for (const l of sc.lessons) {
        const lid = randomUUID();
        await tx.query(`INSERT INTO lessons (id, tenant_id, course_id, module_id, position, type, required) VALUES ($1,$2,$3,$4,$5,$6,true)`, [lid, ctx.tenantId, id, mod, ++pos, l.video ? 'video' : 'richtext']);
        for (const [loc, key] of [['en', 'en'], ['fr-CA', 'fr']] as const)
          await tx.query(`INSERT INTO lesson_locales (lesson_id, tenant_id, locale, title, body) VALUES ($1,$2,$3,$4,$5)`, [lid, ctx.tenantId, loc, l.title[key], JSON.stringify(l.video ? { url: `/media/${l.video}-${key}.mp4`, text: l.text[key] } : { text: l.text[key] })]);
      }
      const qid = randomUUID();
      await tx.query(`INSERT INTO lessons (id, tenant_id, course_id, module_id, position, type, required, pass_mark, quiz_draw) VALUES ($1,$2,$3,$4,$5,'quiz',true,80,$6)`, [qid, ctx.tenantId, id, mod, ++pos, sc.draw ?? null]);
      await tx.query(`INSERT INTO lesson_locales (lesson_id, tenant_id, locale, title, body) VALUES ($1,$2,'en',$3,'{}'), ($1,$2,'fr-CA',$4,'{}')`, [qid, ctx.tenantId, 'Check your knowledge', 'Vérifiez vos connaissances']);
      for (const [i, q] of sc.quiz.entries()) {
        const content = Object.fromEntries((['en', 'fr-CA'] as const).map((loc) => { const k = loc === 'en' ? 'en' : 'fr'; return [loc, { prompt: q.q[k], options: q.options.map((o, n) => ({ key: String(n), text: o[k] })) }]; }));
        await tx.query(`INSERT INTO quiz_questions (tenant_id, lesson_id, position, type, content, correct, points) VALUES ($1,$2,$3,'single',$4,$5,1)`, [ctx.tenantId, qid, i + 1, JSON.stringify(content), JSON.stringify([String(q.correct)])]);
      }
      await audit(tx, ctx, 'course_created', 'course', id, { starter: sc.key });
      return { id, existing: false };
    });
    return reply.code(out.existing ? 200 : 201).send(out);
  });

  // ------------------------------------------------------------------ asking to join a course
  app.post('/v1/courses/:id/request', { schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 500 } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const note = ((req.body ?? {}) as { note?: string }).note?.trim() || null;
    const made = await run(ctx, async (tx) => {
      const c = await loadCourse(tx, id);
      if (c.status !== 'published') throw forbidden('This course is not published yet');
      if (c.enrollment_mode !== 'approval') throw invalid('This course is open: just start it');
      if ((await tx.query('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [ctx.userId, id])).rowCount) throw conflict('You are already enrolled');
      const me = (await tx.query<{ home_node_id: string; name: string }>('SELECT home_node_id, coalesce(display_name, email::text) AS name FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!;
      const title = (await tx.query<{ t: string }>(`SELECT ${courseText('title', 'en')} AS t FROM courses c WHERE c.id = $1`, [id])).rows[0]!.t;
      let rid: string;
      try {
        rid = (await tx.query<{ id: string }>('INSERT INTO enrollment_requests (tenant_id, course_id, user_id, learner_node_id, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [ctx.tenantId, id, ctx.userId, me.home_node_id, note])).rows[0]!.id;
      } catch (e) { if ((e as { code?: string }).code === '23505') throw conflict('You have already asked to join this course'); throw e; }
      await audit(tx, ctx, 'course_requested', 'course', id);
      return { id: rid, node: me.home_node_id, name: me.name, title };
    });
    // tell the people who lead the learner's branch
    const root = (await deps.authPool.query<{ node: string; admin: string | null }>(
      `SELECT n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin FROM org_nodes n WHERE n.tenant_id = $1 AND n.type = 'tenant' LIMIT 1`, [ctx.tenantId])).rows[0];
    const who = root?.admin ? await withRequestTx(deps.appPool, { ...actingAs(ctx.tenantId, root.admin, root.node), isTenantAdmin: true }, async (tx) => (await tx.query<{ user_id: string }>(
      `SELECT DISTINCT r.user_id FROM user_node_roles r JOIN org_reach g ON g.ancestor_id = r.node_id AND g.descendant_id = $1
         JOIN app_users u ON u.id = r.user_id AND u.status::text <> 'disabled'
        WHERE r.role::text IN ('admin', 'manager', 'trainer') AND r.user_id <> $2`, [made.node, ctx.userId])).rows.map((r) => r.user_id)) : [];
    await tell(deps, ctx.tenantId, who, 'course_request', ctx.userId, { name: made.name, course: made.title, courseId: id, note });
    return reply.code(201).send({ id: made.id });
  });

  /** Pending requests the caller can answer (for one course, or all). Learners see their own through the course page. */
  app.get('/v1/course-requests', { schema: { querystring: { type: 'object', properties: { courseId: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { courseId } = req.query as { courseId?: string };
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ id: string; courseId: string; course: string; ownerNodeId: string; userId: string; name: string; email: string; note: string | null; createdAt: string }>(
        `SELECT q.id, q.course_id AS "courseId", ${courseText('title', 'en')} AS course, c.owner_node_id AS "ownerNodeId", q.user_id AS "userId",
                coalesce(u.display_name, u.email::text) AS name, u.email::text AS email, q.note, q.created_at AS "createdAt"
           FROM enrollment_requests q JOIN courses c ON c.id = q.course_id JOIN app_users u ON u.id = q.user_id
          WHERE q.status = 'pending' AND ($1::uuid IS NULL OR q.course_id = $1) ORDER BY q.created_at LIMIT 200`, [courseId ?? null])).rows;
      return { requests: rows.filter((r) => r.userId !== ctx.userId && canAuthorAt(ctx, r.ownerNodeId)).map(({ ownerNodeId, ...r }) => r) };
    });
  });

  app.post('/v1/course-requests/:id/decision', { schema: { params: idParams, body: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'decline'] }, note: { type: 'string', maxLength: 500 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as { decision: 'approve' | 'decline'; note?: string };
    const out = await run(ctx, async (tx) => {
      const q = (await tx.query<{ course_id: string; user_id: string; learner_node_id: string; status: string; owner: string; title: string }>(
        `SELECT q.course_id, q.user_id, q.learner_node_id, q.status, c.owner_node_id AS owner, ${courseText('title', 'en')} AS title FROM enrollment_requests q JOIN courses c ON c.id = q.course_id WHERE q.id = $1`, [id])).rows[0];
      if (!q) throw notFound('Request not found');
      requireAuthor(ctx, q.owner);
      if (q.user_id === ctx.userId) throw forbidden('Someone else needs to answer your request');
      if (q.status !== 'pending') throw conflict('This request was already answered');
      const decision = b.decision === 'approve' ? 'approved' : 'declined';
      await tx.query('UPDATE enrollment_requests SET status = $2, decision_note = $3, decided_by = $4, decided_at = now() WHERE id = $1', [id, decision, b.note?.trim() || null, ctx.userId]);
      if (decision === 'approved') {
        await tx.query(`INSERT INTO enrollments (tenant_id, user_id, course_id, learner_node_id) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, course_id) DO NOTHING`, [ctx.tenantId, q.user_id, q.course_id, q.learner_node_id]);
      }
      await audit(tx, ctx, `course_request_${decision}`, 'course', q.course_id, { userId: q.user_id });
      return { userId: q.user_id, title: q.title, decision, courseId: q.course_id };
    });
    await tell(deps, ctx.tenantId, [out.userId], 'course_decision', ctx.userId, { course: out.title, courseId: out.courseId, decision: out.decision, note: b.note?.trim() || null });
    return { decision: out.decision };
  });

  /** Published versions of a course, newest first, for the people who can edit it. */
  app.get('/v1/courses/:id/versions', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const c = await loadCourse(tx, id);
      requireAuthor(ctx, c.owner_node_id);
      return {
        versions: (await tx.query(
          `SELECT v.version, v.published_at AS "publishedAt", coalesce(u.display_name, u.email::text) AS "publishedBy", jsonb_array_length(v.snapshot -> 'lessons')::int AS lessons,
                  (SELECT count(*)::int FROM enrollments e WHERE e.course_id = v.course_id AND e.course_version = v.version) AS learners
             FROM course_versions v LEFT JOIN app_users u ON u.id = v.published_by WHERE v.course_id = $1 ORDER BY v.version DESC`, [id])).rows,
      };
    });
  });

  app.get('/v1/courses/:id/progress', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await loadCourse(tx, id);
      if (authorNodes(ctx).length === 0 && !ctx.isTenantAdmin) throw forbidden('Only trainers, managers and administrators can see team progress');
      return {
        learners: (await tx.query(
          `SELECT e.id, u.id AS "userId", u.display_name AS "displayName", u.email, e.status, e.progress_pct::float8 AS "progressPct", e.due_at AS "dueAt", e.completed_at AS "completedAt", e.started_at AS "startedAt",
                  qa.best AS "bestScore", coalesce(qa.n, 0) AS attempts
             FROM enrollments e JOIN app_users u ON u.id = e.user_id
             LEFT JOIN LATERAL (SELECT max(score_pct)::float8 AS best, count(*)::int AS n FROM quiz_attempts q WHERE q.enrollment_id = e.id) qa ON true
            WHERE e.course_id = $1 ORDER BY u.display_name NULLS LAST, u.email`, [id])).rows,
      };
    });
  });

  // ------------------------------------------------------------------ learning paths
  const pathBody = { type: 'object', required: ['name', 'courseIds'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 2000 }, courseIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: uuid } } } as const;
  const loadPath = async (tx: Tx, id: string) => {
    const p = (await tx.query<{ id: string; owner_node_id: string; name: string }>('SELECT id, owner_node_id, name FROM learning_paths WHERE id = $1', [id])).rows[0];
    if (!p) throw notFound('Learning path not found');
    return p;
  };
  const setPathCourses = async (tx: Tx, ctx: RequestContext, pathId: string, courseIds: string[]) => {
    const ok = (await tx.query<{ id: string }>(`SELECT id FROM courses WHERE id = ANY($1::uuid[]) AND status <> 'archived'`, [courseIds])).rows.length;
    if (ok !== courseIds.length) throw invalid('One of the courses was not found');
    await tx.query('DELETE FROM learning_path_courses WHERE path_id = $1', [pathId]);
    for (let i = 0; i < courseIds.length; i++) await tx.query('INSERT INTO learning_path_courses (path_id, tenant_id, course_id, position) VALUES ($1,$2,$3,$4)', [pathId, ctx.tenantId, courseIds[i], i + 1]);
  };

  app.get('/v1/paths', { schema: { querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const l = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => {
      const paths = (await tx.query<{ id: string; name: string; description: string | null; ownerNodeId: string }>(
        `SELECT id, name, description, owner_node_id AS "ownerNodeId" FROM learning_paths ORDER BY created_at DESC LIMIT 200`)).rows;
      const rows = paths.length ? (await tx.query<{ pathId: string; id: string; title: string; status: string; starterKey: string | null; enrollStatus: string | null; progressPct: number | null }>(
        `SELECT pc.path_id AS "pathId", c.id, ${courseText('title', l)} AS title, c.status, c.starter_key AS "starterKey", e.status AS "enrollStatus", e.progress_pct::float8 AS "progressPct"
           FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
          WHERE pc.path_id = ANY($1::uuid[]) ORDER BY pc.position`, [paths.map((p) => p.id), ctx.userId])).rows : [];
      return { paths: paths.map((p) => {
        const courses = rows.filter((r) => r.pathId === p.id);
        return { ...p, canEdit: canAuthorAt(ctx, p.ownerNodeId), courses, done: courses.filter((c) => c.enrollStatus === 'completed').length };
      }) };
    });
  });

  app.post('/v1/paths', { schema: { body: pathBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { name: string; description?: string; courseIds: string[] };
    const owner = authorNodes(ctx)[0];
    if (!owner) throw forbidden('Only a trainer, manager or administrator can create a learning path');
    const out = await run(ctx, async (tx) => {
      const id = randomUUID();
      await tx.query('INSERT INTO learning_paths (id, tenant_id, owner_node_id, name, description, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, ctx.tenantId, owner, b.name.trim(), b.description ?? null, ctx.userId]);
      await setPathCourses(tx, ctx, id, b.courseIds);
      await audit(tx, ctx, 'path_created', 'learning_path', id);
      return { id };
    });
    return reply.code(201).send(out);
  });

  app.patch('/v1/paths/:id', { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { ...pathBody.properties } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; description?: string; courseIds?: string[] };
    await run(ctx, async (tx) => {
      const p = await loadPath(tx, id);
      if (!canAuthorAt(ctx, p.owner_node_id)) throw forbidden('Only the owning branch can change this path');
      if (b.name !== undefined || b.description !== undefined) await tx.query('UPDATE learning_paths SET name = coalesce($2, name), description = coalesce($3, description) WHERE id = $1', [id, b.name?.trim() ?? null, b.description ?? null]);
      if (b.courseIds) { if (b.courseIds.length === 0) throw invalid('A path needs at least one course'); await setPathCourses(tx, ctx, id, b.courseIds); }
      await audit(tx, ctx, 'path_updated', 'learning_path', id);
    });
    return reply.code(204).send();
  });

  app.delete('/v1/paths/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const p = await loadPath(tx, id);
      if (!canAuthorAt(ctx, p.owner_node_id)) throw forbidden('Only the owning branch can delete this path');
      await tx.query('DELETE FROM learning_paths WHERE id = $1', [id]);
      await audit(tx, ctx, 'path_deleted', 'learning_path', id);
    });
    return reply.code(204).send();
  });

  /** Take the whole path: enrol in every published course that does not need approval. */
  app.post('/v1/paths/:id/start', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await loadPath(tx, id);
      const cs = (await tx.query<{ course_id: string }>('SELECT course_id FROM learning_path_courses WHERE path_id = $1 ORDER BY position', [id])).rows;
      let enrolled = 0, skipped = 0;
      for (const c of cs) {
        try { await tx.query('SAVEPOINT p'); await ensureEnrollment(tx, ctx, c.course_id); await tx.query('RELEASE SAVEPOINT p'); enrolled++; }
        catch { await tx.query('ROLLBACK TO SAVEPOINT p'); skipped++; }
      }
      return { enrolled, skipped, firstCourseId: cs[0]?.course_id ?? null };
    });
  });

  /** Assign every published course in the path to a branch, with the same due-date rules as a single course. */
  app.post('/v1/paths/:id/assignments', { schema: { params: idParams, body: ruleBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as Rule;
    if (b.dueAt && b.dueInDays) throw invalid('Give a due date or a number of days, not both');
    const out = await run(ctx, async (tx) => {
      const p = await loadPath(tx, id);
      requireAuthor(ctx, p.owner_node_id);
      await requireReach(tx, ctx, b.nodeId);
      const cs = (await tx.query<{ id: string }>(`SELECT c.id FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.path_id = $1 AND c.status = 'published' ORDER BY pc.position`, [id])).rows;
      if (cs.length === 0) throw invalid('Publish at least one course in the path before assigning it');
      let enrolled = 0;
      for (const c of cs) {
        const aid = (await tx.query<{ id: string }>(
          `INSERT INTO course_assignments (tenant_id, course_id, node_id, due_at, due_in_days, role, assigned_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (course_id, node_id) DO UPDATE SET due_at = EXCLUDED.due_at, due_in_days = EXCLUDED.due_in_days, role = EXCLUDED.role RETURNING id`,
          [ctx.tenantId, c.id, b.nodeId, b.dueAt ?? null, b.dueInDays ?? null, b.role ?? null, ctx.userId])).rows[0]!.id;
        enrolled += (await tx.query<{ n: number }>('SELECT sync_enrollments($1) AS n', [aid])).rows[0]!.n;
        if (b.dueAt) await tx.query('UPDATE enrollments SET due_at = $2 WHERE assignment_id = $1 AND status <> \'completed\'', [aid, b.dueAt]);
      }
      await audit(tx, ctx, 'path_assigned', 'learning_path', id, { nodeId: b.nodeId, courses: cs.length, enrolled });
      return { courses: cs.length, enrolled };
    });
    return reply.code(201).send(out);
  });

  // ------------------------------------------------------------------ duplicate courses
  /** Courses sharing a title are duplicates. Keep the one people already use (most enrolments, then published, then oldest) and archive the empty copies; copies with learners are left alone and reported. */
  app.post('/v1/courses/duplicates', { schema: { body: { type: 'object', additionalProperties: false, properties: { apply: { type: 'boolean' } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const apply = (req.body as { apply?: boolean } | null)?.apply === true;
    if (!ctx.isTenantAdmin) throw forbidden('Only an administrator can remove duplicate courses');
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ id: string; title: string; status: string; owner_node_id: string; enrolled: number }>(
        `SELECT c.id, coalesce((SELECT title FROM course_locales WHERE course_id = c.id AND locale = 'en'), (SELECT title FROM course_locales WHERE course_id = c.id LIMIT 1), '') AS title,
                c.status, c.owner_node_id, (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS enrolled, c.created_at
           FROM courses c WHERE c.status <> 'archived' ORDER BY c.created_at`)).rows;
      const groups = new Map<string, typeof rows>();
      for (const r of rows) { const k = r.title.trim().toLowerCase(); if (!k) continue; groups.set(k, [...(groups.get(k) ?? []), r]); }
      const out: { title: string; kept: string; archived: string[]; blocked: string[] }[] = [];
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        const rank = (r: (typeof rows)[number]) => [-r.enrolled, r.status === 'published' ? 0 : 1];
        const sorted = [...g].sort((a, b) => { const x = rank(a), y = rank(b); return x[0]! - y[0]! || x[1]! - y[1]!; });
        const keep = sorted[0]!;
        const dupes = sorted.slice(1);
        const archivable = dupes.filter((d) => d.enrolled === 0), blocked = dupes.filter((d) => d.enrolled > 0);
        if (apply) for (const d of archivable) {
          await tx.query(`UPDATE courses SET status = 'archived', updated_at = now() WHERE id = $1`, [d.id]);
          await audit(tx, ctx, 'course_archived', 'course', d.id, { duplicateOf: keep.id });
        }
        out.push({ title: keep.title, kept: keep.id, archived: archivable.map((d) => d.id), blocked: blocked.map((d) => d.id) });
      }
      return { applied: apply, groups: out, toArchive: out.reduce((n, g) => n + g.archived.length, 0), blocked: out.reduce((n, g) => n + g.blocked.length, 0) };
    });
  });
}
