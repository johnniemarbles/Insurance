import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { page, pageQuery, requireCrm, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const idParams = { type: 'object', properties: { id: uuid } } as const;
const boxParams = idParams;

export function registerNoteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  /** Notes and tasks inherit the box's owner and location, so they are visible exactly where the box is. */
  async function boxScope(tx: Tx, boxId: string) {
    const r = await tx.query<{ owner_node_id: string; context_node_id: string | null }>('SELECT owner_node_id, context_node_id FROM boxes WHERE id = $1', [boxId]);
    if (!r.rows[0]) throw notFound('Box not found');
    return r.rows[0];
  }

  // ---- notes ----
  app.post(
    '/v1/boxes/:id/notes',
    { schema: { params: boxParams, body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 1, maxLength: 20000 }, mentions: { type: 'array', items: uuid, maxItems: 20 } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { body: string; mentions?: string[] };
      const out = await run(ctx, async (tx) => {
        const s = await boxScope(tx, id);
        if (b.mentions?.length) {
          const m = await tx.query('SELECT count(*)::int AS n FROM app_users WHERE id = ANY($1::uuid[])', [b.mentions]);
          if (m.rows[0]!.n !== new Set(b.mentions).size) throw invalid('A mentioned person is not visible to you');
        }
        const noteId = randomUUID();
        await tx.query('INSERT INTO notes (id, tenant_id, box_id, owner_node_id, context_node_id, author_id, body, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [noteId, ctx.tenantId, id, s.owner_node_id, s.context_node_id, ctx.userId, b.body, b.mentions ?? []]);
        await audit(tx, ctx, 'note_added', 'note', noteId, { boxId: id });
        return { id: noteId };
      });
      return reply.code(201).send(out);
    },
  );
  app.get('/v1/boxes/:id/notes', { schema: { params: boxParams, querystring: { type: 'object', properties: pageQuery } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const { limit, offset } = page(req.query as { limit?: number; offset?: number });
    return run(ctx, async (tx) => {
      await boxScope(tx, id);
      const rows = (await tx.query(`SELECT n.id, n.author_id AS "authorId", u.display_name AS "authorName", n.body, n.mentions, n.created_at AS "createdAt" FROM notes n LEFT JOIN app_users u ON u.id = n.author_id WHERE n.box_id = $1 ORDER BY n.created_at DESC, n.id LIMIT $2 OFFSET $3`, [id, limit, offset])).rows;
      return { notes: rows, limit, offset };
    });
  });
  app.delete('/v1/notes/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await tx.query<{ author_id: string }>('SELECT author_id FROM notes WHERE id = $1', [id]);
      if (!r.rows[0]) throw notFound('Note not found');
      if (r.rows[0].author_id !== ctx.userId && !ctx.isTenantAdmin) throw forbidden('Only the author can delete a note');
      await tx.query('DELETE FROM notes WHERE id = $1', [id]);
      await audit(tx, ctx, 'note_deleted', 'note', id);
    });
    return reply.code(204).send();
  });

  // ---- tasks ----
  app.post(
    '/v1/boxes/:id/tasks',
    { schema: { params: boxParams, body: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, dueAt: { type: 'string', format: 'date-time' }, assigneeId: uuid } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { title: string; dueAt?: string; assigneeId?: string };
      const out = await run(ctx, async (tx) => {
        const s = await boxScope(tx, id);
        const assignee = b.assigneeId ?? ctx.userId;
        const a = await tx.query('SELECT 1 FROM app_users WHERE id = $1', [assignee]);
        if (a.rowCount === 0) throw invalid('That assignee is not visible to you');
        const taskId = randomUUID();
        await tx.query('INSERT INTO tasks (id, tenant_id, box_id, owner_node_id, context_node_id, assignee_id, title, due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [taskId, ctx.tenantId, id, s.owner_node_id, s.context_node_id, assignee, b.title.trim(), b.dueAt ?? null]);
        await audit(tx, ctx, 'task_created', 'task', taskId, { boxId: id });
        return { id: taskId };
      });
      return reply.code(201).send(out);
    },
  );
  app.get(
    '/v1/tasks',
    { schema: { querystring: { type: 'object', properties: { boxId: uuid, mine: { type: 'boolean' }, open: { type: 'boolean' }, ...pageQuery } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const q = req.query as { boxId?: string; mine?: boolean; open?: boolean; limit?: number; offset?: number };
      const { limit, offset } = page(q);
      return run(ctx, async (tx) => ({
        tasks: (
          await tx.query(
            `SELECT t.id, t.box_id AS "boxId", t.assignee_id AS "assigneeId", t.title, t.due_at AS "dueAt", t.done_at AS "doneAt", t.created_at AS "createdAt",
                    (SELECT b.name FROM boxes b WHERE b.id = t.box_id) AS "boxName", (SELECT b.pipeline_id FROM boxes b WHERE b.id = t.box_id) AS "pipelineId"
               FROM tasks t WHERE ($1::uuid IS NULL OR t.box_id = $1) AND (NOT $2 OR t.assignee_id = $3) AND (NOT $4 OR t.done_at IS NULL)
              ORDER BY t.due_at NULLS LAST, t.created_at DESC, t.id LIMIT $5 OFFSET $6`,
            [q.boxId ?? null, q.mine ?? false, ctx.userId, q.open ?? false, limit, offset],
          )
        ).rows,
        limit, offset,
      }));
    },
  );
  app.patch(
    '/v1/tasks/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, dueAt: { type: ['string', 'null'], format: 'date-time' }, done: { type: 'boolean' }, assigneeId: uuid } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { title?: string; dueAt?: string | null; done?: boolean; assigneeId?: string };
      await run(ctx, async (tx) => {
        const r = await tx.query<{ owner_node_id: string; assignee_id: string | null }>('SELECT owner_node_id, assignee_id FROM tasks WHERE id = $1', [id]);
        const t = r.rows[0];
        if (!t) throw notFound('Task not found');
        // the owning branch may change anything; the assignee may always tick it off
        const owner = ctx.isTenantAdmin || ctx.nodeIds.includes(t.owner_node_id);
        if (!owner && !(t.assignee_id === ctx.userId && Object.keys(b).every((k) => k === 'done'))) throw forbidden('Only the owning branch can change this task');
        if (b.assigneeId) {
          const a = await tx.query('SELECT 1 FROM app_users WHERE id = $1', [b.assigneeId]);
          if (a.rowCount === 0) throw invalid('That assignee is not visible to you');
        }
        await tx.query(
          `UPDATE tasks SET title = coalesce($2, title), due_at = CASE WHEN $3 THEN $4::timestamptz ELSE due_at END,
             done_at = CASE WHEN $5::boolean IS NULL THEN done_at WHEN $5 THEN coalesce(done_at, now()) ELSE NULL END,
             assignee_id = coalesce($6, assignee_id) WHERE id = $1`,
          [id, b.title?.trim() ?? null, 'dueAt' in b, b.dueAt ?? null, b.done ?? null, b.assigneeId ?? null],
        );
        await audit(tx, ctx, b.done ? 'task_completed' : 'task_updated', 'task', id);
      });
      return reply.code(204).send();
    },
  );
  app.delete('/v1/tasks/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM tasks WHERE id = $1', [id]);
      if (!r.rows[0]) throw notFound('Task not found');
      if (!ctx.isTenantAdmin && !ctx.nodeIds.includes(r.rows[0].owner_node_id)) throw forbidden('Only the owning branch can delete this task');
      await tx.query('DELETE FROM tasks WHERE id = $1', [id]);
      await audit(tx, ctx, 'task_deleted', 'task', id);
    });
    return reply.code(204).send();
  });
}
