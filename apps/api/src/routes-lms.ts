import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { attemptStatus, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { uuid } from './crm-helpers.ts';
import { recordCeForCompletion } from './routes-ce.ts';
import type { AppDeps } from './app.ts';

type Locale = 'en' | 'fr-CA';
const localeProp = { enum: ['en', 'fr-CA'] } as const;
const LESSON_TYPES = ['richtext', 'link', 'video', 'quiz'] as const;
const idParams = { type: 'object', properties: { id: uuid } } as const;

/** Nodes where the caller may build and assign training: admins, managers and trainers. */
const authorNodes = (ctx: RequestContext): string[] => ctx.roles.filter((r) => ['admin', 'manager', 'trainer'].includes(r.role)).map((r) => r.nodeId);
const canAuthorAt = (ctx: RequestContext, ownerNodeId: string): boolean => ctx.isTenantAdmin || authorNodes(ctx).includes(ownerNodeId);
const loc = (q: { locale?: string }): Locale => (q.locale === 'fr-CA' ? 'fr-CA' : 'en');

/** Course title or description in the reader's language, falling back to English. */
const courseText = (col: 'title' | 'description', l: Locale, a = 'c') =>
  `COALESCE((SELECT ${col} FROM course_locales WHERE course_id = ${a}.id AND locale = '${l}'), (SELECT ${col} FROM course_locales WHERE course_id = ${a}.id AND locale = 'en'), '')`;
const lessonTitle = (l: Locale, a = 'l') =>
  `COALESCE((SELECT title FROM lesson_locales WHERE lesson_id = ${a}.id AND locale = '${l}'), (SELECT title FROM lesson_locales WHERE lesson_id = ${a}.id AND locale = 'en'), '')`;

export function registerLmsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  async function loadCourse(tx: Tx, id: string) {
    const { rows } = await tx.query<{ id: string; owner_node_id: string; status: string }>('SELECT id, owner_node_id, status FROM courses WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Course not found');
    return rows[0];
  }
  async function loadLesson(tx: Tx, id: string) {
    const { rows } = await tx.query<{ id: string; course_id: string; module_id: string; type: string; required: boolean; pass_mark: number | null; max_attempts: number | null; cooldown_minutes: number | null; owner_node_id: string; status: string }>(
      `SELECT l.id, l.course_id, l.module_id, l.type, l.required, l.pass_mark, l.max_attempts, l.cooldown_minutes, c.owner_node_id, c.status FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = $1`, [id]);
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

  /** Everyone is a learner: opening a published course you can see enrolls you, unless you already are. */
  async function ensureEnrollment(tx: Tx, ctx: RequestContext, courseId: string): Promise<string> {
    const have = await tx.query<{ id: string }>('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [ctx.userId, courseId]);
    if (have.rows[0]) return have.rows[0].id;
    const c = await loadCourse(tx, courseId);
    if (c.status !== 'published') throw forbidden('This course is not published yet');
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
                (SELECT count(*)::int FROM lessons x WHERE x.course_id = c.id) AS "lessonCount",
                e.status AS "myStatus", e.progress_pct::float8 AS "myProgress", e.due_at AS "myDueAt"
           FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
          WHERE c.status <> 'archived' ORDER BY c.created_at DESC`, [ctx.userId])).rows as Array<Record<string, unknown> & { ownerNodeId: string }>;
      return { courses: rows.map((r) => ({ ...r, canEdit: canAuthorAt(ctx, r.ownerNodeId) })) };
    });
  });

  app.get('/v1/courses/:id', { schema: { params: idParams, querystring: { type: 'object', properties: { locale: localeProp } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const l = loc(req.query as { locale?: string });
    return run(ctx, async (tx) => {
      const c = (await tx.query(`SELECT c.id, c.status, c.version, c.owner_node_id AS "ownerNodeId", c.quebec_facing AS "quebecFacing", c.ce_pack AS "cePack", c.ce_hours::float8 AS "ceHours", c.ce_category AS "ceCategory", ${courseText('title', l)} AS title, ${courseText('description', l)} AS description FROM courses c WHERE c.id = $1`, [id])).rows[0];
      if (!c) throw notFound('Course not found');
      const e = (await tx.query(`SELECT id, status, course_version AS "courseVersion", progress_pct::float8 AS "progressPct", due_at AS "dueAt", completed_at AS "completedAt" FROM enrollments WHERE course_id = $1 AND user_id = $2`, [id, ctx.userId])).rows[0] ?? null;
      const lessons = (await tx.query(
        `SELECT l.id, l.module_id AS "moduleId", l.position, l.type, l.required, l.pass_mark AS "passMark", ${lessonTitle(l)} AS title, (p.status = 'completed') AS done
           FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.enrollment_id = $2
          WHERE l.course_id = $1 ORDER BY l.position`, [id, e?.id ?? null])).rows;
      const cert = e ? (await tx.query(`SELECT id, verification_code AS "verificationCode", issued_at AS "issuedAt" FROM certificates WHERE enrollment_id = $1`, [e.id])).rows[0] ?? null : null;
      if (cert) cert.url = `${deps.config.appOrigin}/c/${cert.verificationCode}`;
      const canEdit = canAuthorAt(ctx, c.ownerNodeId);
      const locales = canEdit ? (await tx.query(`SELECT locale, title, description FROM course_locales WHERE course_id = $1`, [id])).rows : undefined;
      return { ...c, canEdit, enrollment: e, certificate: cert, lessons: lessons.map((x) => ({ ...x, done: Boolean(x.done) })), locales };
    });
  });

  app.patch(
    '/v1/courses/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 4000 }, locale: localeProp, status: { enum: ['draft', 'published', 'archived'] }, quebecFacing: { type: 'boolean' }, ce: { anyOf: [{ type: 'null' }, { type: 'object', required: ['pack', 'hours', 'category'], additionalProperties: false, properties: { pack: { type: 'string', maxLength: 30 }, hours: { type: 'number', minimum: 0.5, maximum: 40 }, category: { enum: ['technical', 'management', 'ethics', 'professional_development', 'general'] } } }] } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { title?: string; description?: string; locale?: Locale; status?: string; quebecFacing?: boolean; ce?: { pack: string; hours: number; category: string } | null };
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
        if (c.status === 'published' && (b.ce !== undefined || b.quebecFacing !== undefined)) requireEditable(c.status);
        if (b.status === 'published') {
          const n = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM lessons WHERE course_id = $1', [id])).rows[0]!.n;
          if (n === 0) throw invalid('Add at least one lesson before publishing');
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
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, text: { type: 'string', maxLength: 50000 }, url: { type: 'string', maxLength: 2000 }, required: { type: 'boolean' }, passMark: { type: 'integer', minimum: 0, maximum: 100 }, maxAttempts: { type: ['integer', 'null'], minimum: 1, maximum: 50 }, cooldownMinutes: { type: ['integer', 'null'], minimum: 1, maximum: 10080 }, locale: localeProp } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { title?: string; text?: string; url?: string; required?: boolean; passMark?: number; maxAttempts?: number | null; cooldownMinutes?: number | null; locale?: Locale };
      if (b.url !== undefined && !/^https:\/\//i.test(b.url)) throw invalid('Give a link starting with https://');
      await run(ctx, async (tx) => {
        const l = await loadLesson(tx, id);
        requireAuthor(ctx, l.owner_node_id);
        requireEditable(l.status);
        if (b.required !== undefined || b.passMark !== undefined || 'maxAttempts' in b || 'cooldownMinutes' in b) {
          await tx.query(`UPDATE lessons SET required = coalesce($2, required), pass_mark = coalesce($3, pass_mark), max_attempts = CASE WHEN $4 THEN $5::int ELSE max_attempts END, cooldown_minutes = CASE WHEN $6 THEN $7::int ELSE cooldown_minutes END WHERE id = $1`, [id, b.required ?? null, b.passMark ?? null, 'maxAttempts' in b, b.maxAttempts ?? null, 'cooldownMinutes' in b, b.cooldownMinutes ?? null]);
        }
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
      const ll = (await tx.query<{ title: string; body: Record<string, unknown> }>(
        `SELECT title, body FROM lesson_locales WHERE lesson_id = $1 AND locale IN ($2, 'en') ORDER BY (locale = $2) DESC LIMIT 1`, [id, lang])).rows[0];
      const enr = (await tx.query<{ id: string }>('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [ctx.userId, l.course_id])).rows[0];
      const prog = enr ? (await tx.query(`SELECT status FROM lesson_progress WHERE enrollment_id = $1 AND lesson_id = $2`, [enr.id, id])).rows[0] : undefined;
      let quiz: unknown;
      if (l.type === 'quiz') {
        const qs = (await tx.query<{ id: string; type: string; content: Record<string, { prompt: string; options: { key: string; text: string }[] }>; correct: string[]; points: number }>(
          'SELECT id, type, content, correct, points FROM quiz_questions WHERE lesson_id = $1 ORDER BY position', [id])).rows;
        const attempts = enr ? (await tx.query(`SELECT score_pct::float8 AS "scorePct", passed, attempted_at AS "attemptedAt", attempt_no AS "attemptNo" FROM quiz_attempts WHERE enrollment_id = $1 AND lesson_id = $2 ORDER BY attempted_at DESC`, [enr.id, id])).rows : [];
        quiz = {
          passMark: l.pass_mark, maxAttempts: l.max_attempts, cooldownMinutes: l.cooldown_minutes, attempts,
          status: attemptStatus({ maxAttempts: l.max_attempts, cooldownMinutes: l.cooldown_minutes }, (attempts as { attemptedAt: string; passed: boolean }[])),
          questions: qs.map((q) => {
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
        const enr = await ensureEnrollment(tx, ctx, l.course_id);
        const prior = (await tx.query<{ attempted_at: string; passed: boolean }>('SELECT attempted_at, passed FROM quiz_attempts WHERE enrollment_id = $1 AND lesson_id = $2', [enr, id])).rows.map((r) => ({ attemptedAt: r.attempted_at, passed: r.passed }));
        const st = attemptStatus({ maxAttempts: l.max_attempts, cooldownMinutes: l.cooldown_minutes }, prior);
        if (st.reason === 'no_attempts_left') throw forbidden('No attempts left for this quiz');
        if (st.reason === 'passed') throw conflict('You have already passed this quiz');
        if (st.reason === 'cooldown') throw conflict(`Please wait before trying again. The next attempt opens at ${st.nextAt}`);
        const qs = (await tx.query<{ id: string; type: string; correct: string[]; points: number }>('SELECT id, type, correct, points FROM quiz_questions WHERE lesson_id = $1 ORDER BY position', [id])).rows;
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
        const after = attemptStatus({ maxAttempts: l.max_attempts, cooldownMinutes: l.cooldown_minutes }, [...prior, { attemptedAt: new Date().toISOString(), passed }]);
        return { scorePct: score, passed, passMark: l.pass_mark, results, attemptNo: prior.length + 1, attemptsLeft: after.left, nextAttemptAt: after.nextAt, ...progress };
      });
    },
  );

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
          `SELECT e.id, u.id AS "userId", u.display_name AS "displayName", u.email, e.status, e.progress_pct::float8 AS "progressPct", e.due_at AS "dueAt", e.completed_at AS "completedAt"
             FROM enrollments e JOIN app_users u ON u.id = e.user_id WHERE e.course_id = $1 ORDER BY u.display_name NULLS LAST, u.email`, [id])).rows,
      };
    });
  });
}
