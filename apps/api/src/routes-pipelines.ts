import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { FIELD_KEY_RE, FIELD_TYPES, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, notFound, invalid } from './errors.ts';
import { managerNodeIds, requireCrm, resolveOwnerNode, uuid } from './crm-helpers.ts';
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
      const pipes = (await tx.query(`SELECT id, name, owner_node_id AS "ownerNodeId", is_shared_down AS "sharedDown", created_at AS "createdAt" FROM pipelines ORDER BY name`)).rows;
      const ids = pipes.map((p) => p.id);
      const stages = (await tx.query(`SELECT id, pipeline_id AS "pipelineId", name, position, is_won AS "isWon", is_lost AS "isLost" FROM stages WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position`, [ids])).rows;
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
    { schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, sharedDown: { type: 'boolean' } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; sharedDown?: boolean };
      await run(ctx, async (tx) => {
        await loadForManage(tx, ctx, id);
        await tx.query('UPDATE pipelines SET name = coalesce($2, name), is_shared_down = coalesce($3, is_shared_down) WHERE id = $1', [id, b.name?.trim() ?? null, b.sharedDown ?? null]);
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
}
