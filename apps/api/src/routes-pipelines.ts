import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { FIELD_KEY_RE, FIELD_TYPES, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, notFound, invalid } from './errors.ts';
import { managerNodeIds, requireCrm, resolveOwnerNode, scopeSql, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const DEFAULT_STAGES = [
  { name: 'New', isWon: false, isLost: false },
  { name: 'In progress', isWon: false, isLost: false },
  { name: 'Won', isWon: true, isLost: false },
  { name: 'Lost', isWon: false, isLost: true },
];

const stageSchema = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, isWon: { type: 'boolean' }, isLost: { type: 'boolean' } },
} as const;
const fieldSchema = {
  type: 'object', required: ['key', 'labels', 'type'], additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: FIELD_KEY_RE.source },
    labels: { type: 'object', required: ['en'], additionalProperties: { type: 'string', maxLength: 100 }, properties: { en: { type: 'string', minLength: 1, maxLength: 100 } } },
    type: { type: 'string', enum: [...FIELD_TYPES] },
    options: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 100 },
    required: { type: 'boolean' },
  },
} as const;

interface FieldInput { key: string; labels: Record<string, string>; type: string; options?: string[]; required?: boolean }

function checkField(f: FieldInput) {
  if (f.type === 'dropdown' && (!f.options || f.options.length === 0)) throw invalid(`Dropdown field "${f.key}" needs options`);
  if (f.type !== 'dropdown' && f.options) throw invalid(`Only dropdown fields take options ("${f.key}")`);
  for (const l of Object.keys(f.labels)) if (l !== 'en' && l !== 'fr-CA') throw invalid(`Unsupported label language "${l}"`);
}

export function registerPipelineRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  async function loadForManage(tx: Tx, ctx: RequestContext, id: string) {
    const { rows } = await tx.query<{ id: string; owner_node_id: string }>('SELECT id, owner_node_id FROM pipelines WHERE id = $1', [id]);
    const p = rows[0];
    if (!p) throw notFound('Pipeline not found');
    if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(p.owner_node_id)) throw forbidden('Only a manager of the owning branch can change this pipeline');
    return p;
  }

  app.get('/v1/pipelines', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const pipes = (await tx.query(`SELECT id, name, owner_node_id AS "ownerNodeId", is_shared_down AS "sharedDown", color_theme AS "colorTheme", created_at AS "createdAt" FROM pipelines ORDER BY name`)).rows;
      const ids = pipes.map((p) => p.id);
      const stages = (await tx.query(`SELECT id, pipeline_id AS "pipelineId", name, position, color, is_won AS "isWon", is_lost AS "isLost" FROM stages WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position`, [ids])).rows;
      const fields = (await tx.query(`SELECT id, pipeline_id AS "pipelineId", key, labels, type, options, required, position FROM field_defs WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position`, [ids])).rows;
      return { pipelines: pipes.map((p) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id), fields: fields.filter((f) => f.pipelineId === p.id) })) };
    });
  });

  app.post(
    '/v1/pipelines',
    {
      schema: {
        body: {
          type: 'object', required: ['name'], additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 }, ownerNodeId: uuid, sharedDown: { type: 'boolean' },
            stages: { type: 'array', items: stageSchema, minItems: 1, maxItems: 30 },
            fields: { type: 'array', items: fieldSchema, maxItems: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const b = req.body as { name: string; ownerNodeId?: string; sharedDown?: boolean; stages?: typeof DEFAULT_STAGES; fields?: FieldInput[] };
      const owner = b.ownerNodeId ?? ctx.nodeIds[0]!;
      if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(owner)) throw forbidden('Only a manager of that branch can create a pipeline there');
      for (const f of b.fields ?? []) checkField(f);
      const keys = (b.fields ?? []).map((f) => f.key);
      if (new Set(keys).size !== keys.length) throw invalid('Duplicate field keys');
      const out = await run(ctx, async (tx) => {
        await resolveOwnerNode(tx, owner);
        const id = randomUUID();
        await tx.query('INSERT INTO pipelines (id, tenant_id, owner_node_id, name, is_shared_down, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, ctx.tenantId, owner, b.name.trim(), b.sharedDown ?? false, ctx.userId]);
        let pos = 1;
        for (const s of b.stages ?? DEFAULT_STAGES) {
          await tx.query('INSERT INTO stages (tenant_id, pipeline_id, name, position, is_won, is_lost) VALUES ($1, $2, $3, $4, $5, $6)', [ctx.tenantId, id, s.name.trim(), pos++, s.isWon ?? false, s.isLost ?? false]);
        }
        let fpos = 1;
        for (const f of b.fields ?? []) {
          await tx.query('INSERT INTO field_defs (tenant_id, pipeline_id, key, labels, type, options, required, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [ctx.tenantId, id, f.key, JSON.stringify(f.labels), f.type, f.options ? JSON.stringify(f.options) : null, f.required ?? false, fpos++]);
        }
        await audit(tx, ctx, 'pipeline_created', 'pipeline', id, { name: b.name, ownerNodeId: owner });
        return { id };
      });
      return reply.code(201).send(out);
    },
  );

  app.patch(
    '/v1/pipelines/:id',
    { schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, sharedDown: { type: 'boolean' }, colorTheme: { enum: ['rainbow', 'ocean', 'forest', 'sunset', 'mono'] } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; sharedDown?: boolean; colorTheme?: string };
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        await tx.query('UPDATE pipelines SET name = coalesce($2, name), is_shared_down = coalesce($3, is_shared_down), color_theme = coalesce($4, color_theme) WHERE id = $1', [id, b.name?.trim() ?? null, b.sharedDown ?? null, b.colorTheme ?? null]);
        await audit(tx, ctx, 'pipeline_updated', 'pipeline', id, b);
      });
      return reply.code(204).send();
    },
  );

  app.post('/v1/pipelines/:id/stages', { schema: { params: { type: 'object', properties: { id: uuid } }, body: stageSchema } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const s = req.body as { name: string; isWon?: boolean; isLost?: boolean };
    const out = await run(ctx, async (tx) => {
      await loadForManage(tx, ctx, id);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO stages (tenant_id, pipeline_id, name, position, is_won, is_lost)
         VALUES ($1, $2, $3, (SELECT coalesce(max(position), 0) + 1 FROM stages WHERE pipeline_id = $2), $4, $5) RETURNING id`,
        [ctx.tenantId, id, s.name.trim(), s.isWon ?? false, s.isLost ?? false],
      );
      return { id: rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/pipelines/:id/fields', { schema: { params: { type: 'object', properties: { id: uuid } }, body: fieldSchema } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const f = req.body as FieldInput;
    checkField(f);
    const out = await run(ctx, async (tx) => {
      await loadForManage(tx, ctx, id);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO field_defs (tenant_id, pipeline_id, key, labels, type, options, required, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(max(position), 0) + 1 FROM field_defs WHERE pipeline_id = $2)) RETURNING id`,
        [ctx.tenantId, id, f.key, JSON.stringify(f.labels), f.type, f.options ? JSON.stringify(f.options) : null, f.required ?? false],
      );
      return { id: rows[0]!.id };
    });
    return reply.code(201).send(out);
  });
  // ---- edit stages ----
  const stageParams = { type: 'object', properties: { id: uuid, stageId: uuid } } as const;
  const colorProp = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;

  app.patch(
    '/v1/pipelines/:id/stages/:stageId',
    { schema: { params: stageParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, color: { anyOf: [colorProp, { type: 'null' }] }, isWon: { type: 'boolean' }, isLost: { type: 'boolean' } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id, stageId } = req.params as { id: string; stageId: string };
      const b = req.body as { name?: string; color?: string | null; isWon?: boolean; isLost?: boolean };
      if (b.isWon && b.isLost) throw invalid('A stage cannot be both won and lost');
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        const r = await tx.query(
          `UPDATE stages SET name = coalesce($3, name), color = CASE WHEN $4 THEN $5 ELSE color END,
             is_won = coalesce($6, is_won), is_lost = coalesce($7, is_lost) WHERE id = $1 AND pipeline_id = $2`,
          [stageId, id, b.name?.trim() ?? null, 'color' in b, b.color ?? null, b.isWon ?? null, b.isLost ?? null],
        );
        if (r.rowCount === 0) throw notFound('Stage not found');
        await audit(tx, ctx, 'stage_updated', 'pipeline', id, { stageId, fields: Object.keys(b) });
      });
      return reply.code(204).send();
    },
  );

  // Order is replaced as a whole: the list must name every stage exactly once.
  app.put(
    '/v1/pipelines/:id/stages/order',
    { schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', required: ['stageIds'], additionalProperties: false, properties: { stageIds: { type: 'array', items: uuid, minItems: 1, maxItems: 30 } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const { stageIds } = req.body as { stageIds: string[] };
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        const cur = (await tx.query<{ id: string }>('SELECT id FROM stages WHERE pipeline_id = $1', [id])).rows.map((r) => r.id);
        if (cur.length !== stageIds.length || new Set(stageIds).size !== stageIds.length || !stageIds.every((x) => cur.includes(x))) throw invalid('List every stage of the pipeline exactly once');
        // two passes avoid tripping the (pipeline_id, position) uniqueness mid-way
        await tx.query('UPDATE stages SET position = position + 1000 WHERE pipeline_id = $1', [id]);
        for (let i = 0; i < stageIds.length; i++) await tx.query('UPDATE stages SET position = $2 WHERE id = $1', [stageIds[i], i + 1]);
        await audit(tx, ctx, 'stages_reordered', 'pipeline', id);
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/pipelines/:id/stages/:stageId',
    { schema: { params: stageParams, querystring: { type: 'object', properties: { moveTo: uuid } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id, stageId } = req.params as { id: string; stageId: string };
      const { moveTo } = req.query as { moveTo?: string };
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        const st = await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [stageId, id]);
        if (st.rowCount === 0) throw notFound('Stage not found');
        const count = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM stages WHERE pipeline_id = $1', [id])).rows[0]!.n;
        if (count <= 1) throw invalid('A pipeline needs at least one stage');
        const used = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM boxes WHERE stage_id = $1', [stageId])).rows[0]!.n;
        if (used > 0) {
          if (!moveTo || moveTo === stageId) throw invalid(`${used} box(es) are in this stage: say where to move them (moveTo)`);
          const dest = await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [moveTo, id]);
          if (dest.rowCount === 0) throw invalid('moveTo must be another stage of this pipeline');
          const moved = await tx.query<{ id: string }>('UPDATE boxes SET stage_id = $2, stage_entered_at = now(), updated_at = now() WHERE stage_id = $1 RETURNING id', [stageId, moveTo]);
          for (const m of moved.rows) await tx.query(`INSERT INTO box_events (tenant_id, box_id, kind, from_stage_id, to_stage_id, actor_id) VALUES ($1,$2,'stage_changed',$3,$4,$5)`, [ctx.tenantId, m.id, stageId, moveTo, ctx.userId]);
        }
        await tx.query('DELETE FROM stages WHERE id = $1', [stageId]);
        // close the gap in positions
        const rest = (await tx.query<{ id: string }>('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position', [id])).rows;
        await tx.query('UPDATE stages SET position = position + 1000 WHERE pipeline_id = $1', [id]);
        for (let i = 0; i < rest.length; i++) await tx.query('UPDATE stages SET position = $2 WHERE id = $1', [rest[i]!.id, i + 1]);
        await audit(tx, ctx, 'stage_deleted', 'pipeline', id, { stageId, moveTo: moveTo ?? null });
      });
      return reply.code(204).send();
    },
  );

  // ---- edit columns (custom fields) ----
  const fieldParams = { type: 'object', properties: { id: uuid, fieldId: uuid } } as const;

  app.patch(
    '/v1/pipelines/:id/fields/:fieldId',
    {
      schema: {
        params: fieldParams,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: {
            labels: { type: 'object', required: ['en'], additionalProperties: { type: 'string', maxLength: 100 }, properties: { en: { type: 'string', minLength: 1, maxLength: 100 } } },
            options: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: 100 },
            required: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id, fieldId } = req.params as { id: string; fieldId: string };
      const b = req.body as { labels?: Record<string, string>; options?: string[]; required?: boolean };
      for (const l of Object.keys(b.labels ?? {})) if (l !== 'en' && l !== 'fr-CA') throw invalid(`Unsupported label language "${l}"`);
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        const f = (await tx.query<{ type: string }>('SELECT type FROM field_defs WHERE id = $1 AND pipeline_id = $2', [fieldId, id])).rows[0];
        if (!f) throw notFound('Column not found');
        if (b.options && f.type !== 'dropdown') throw invalid('Only dropdown columns take options');
        // the type and key are fixed once created: existing values depend on them
        await tx.query(
          `UPDATE field_defs SET labels = coalesce($3::jsonb, labels), options = coalesce($4::jsonb, options), required = coalesce($5, required) WHERE id = $1 AND pipeline_id = $2`,
          [fieldId, id, b.labels ? JSON.stringify(b.labels) : null, b.options ? JSON.stringify(b.options) : null, b.required ?? null],
        );
        await audit(tx, ctx, 'field_updated', 'pipeline', id, { fieldId, fields: Object.keys(b) });
      });
      return reply.code(204).send();
    },
  );

  app.put(
    '/v1/pipelines/:id/fields/order',
    { schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', required: ['fieldIds'], additionalProperties: false, properties: { fieldIds: { type: 'array', items: uuid, maxItems: 50 } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const { fieldIds } = req.body as { fieldIds: string[] };
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        const cur = (await tx.query<{ id: string }>('SELECT id FROM field_defs WHERE pipeline_id = $1', [id])).rows.map((r) => r.id);
        if (cur.length !== fieldIds.length || new Set(fieldIds).size !== fieldIds.length || !fieldIds.every((x) => cur.includes(x))) throw invalid('List every column exactly once');
        for (let i = 0; i < fieldIds.length; i++) await tx.query('UPDATE field_defs SET position = $2 WHERE id = $1', [fieldIds[i], i + 1]);
      });
      return reply.code(204).send();
    },
  );

  app.delete('/v1/pipelines/:id/fields/:fieldId', { schema: { params: fieldParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, fieldId } = req.params as { id: string; fieldId: string };
    await run(ctx, async (tx) => {
      await loadForManage(tx, ctx, id);
      const f = (await tx.query<{ key: string }>('SELECT key FROM field_defs WHERE id = $1 AND pipeline_id = $2', [fieldId, id])).rows[0];
      if (!f) throw notFound('Column not found');
      // values stored on boxes go with the column
      await tx.query('UPDATE boxes SET custom = custom - $2::text WHERE pipeline_id = $1 AND custom ? $2::text', [id, f.key]);
      await tx.query('DELETE FROM field_defs WHERE id = $1', [fieldId]);
      await audit(tx, ctx, 'field_deleted', 'pipeline', id, { key: f.key });
    });
    return reply.code(204).send();
  });

  // ---- counts for the stage bar ----
  app.get(
    '/v1/pipelines/:id/summary',
    { schema: { params: { type: 'object', properties: { id: uuid } }, querystring: { type: 'object', properties: { scope: { enum: ['mine', 'below', 'all'] } } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const { scope } = req.query as { scope?: 'mine' | 'below' | 'all' };
      return run(ctx, async (tx) => {
        const p = await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id]);
        if (p.rowCount === 0) throw notFound('Pipeline not found');
        const rows = (
          await tx.query(
            `SELECT s.id AS "stageId", count(b.id)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value
               FROM stages s LEFT JOIN boxes b ON b.stage_id = s.id AND ${scopeSql(2)}
              WHERE s.pipeline_id = $1 GROUP BY s.id, s.position ORDER BY s.position`,
            [id, scope ?? 'all', ctx.nodeIds],
          )
        ).rows;
        return { stages: rows, total: rows.reduce((n, r) => n + r.count, 0) };
      });
    },
  );
}
