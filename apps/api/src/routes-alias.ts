import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound, HttpError } from './errors.ts';
import { managerNodeIds, requireCrm, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const COLS = `r.id, r.alias, r.pipeline_id AS "pipelineId", r.stage_id AS "stageId", (SELECT p.name FROM pipelines p WHERE p.id = r.pipeline_id) AS "pipelineName"`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Alias rules: which pipeline mail sent to an address belongs in. Managers of the pipeline's branch define them; everyone who can see the pipeline reads them. */
export function registerAliasRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const pid = { type: 'object', properties: { id: uuid } } as const;

  async function manage(tx: Tx, ctx: RequestContext, pipelineId: string) {
    const p = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM pipelines WHERE id = $1', [pipelineId])).rows[0];
    if (!p) throw notFound('Pipeline not found');
    if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(p.owner_node_id)) throw forbidden('Only a manager of the owning branch can change this pipeline');
  }

  // Everything the extension needs to match a conversation: small, and only for pipelines the person can see.
  app.get('/v1/alias-rules', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => ({ rules: (await tx.query(`SELECT ${COLS} FROM alias_rules r ORDER BY r.alias`)).rows }));
  });

  app.get('/v1/pipelines/:id/aliases', { schema: { params: pid } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id])).rowCount === 0) throw notFound('Pipeline not found');
      return { rules: (await tx.query(`SELECT ${COLS} FROM alias_rules r WHERE r.pipeline_id = $1 ORDER BY r.alias`, [id])).rows };
    });
  });

  app.post('/v1/pipelines/:id/aliases', { schema: { params: pid, body: { type: 'object', required: ['alias'], additionalProperties: false, properties: { alias: { type: 'string', minLength: 3, maxLength: 254 }, stageId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { alias: string; stageId?: string };
    const alias = b.alias.trim().toLowerCase();
    if (!EMAIL.test(alias)) throw invalid('Enter a full email address, like travel@yourcompany.com');
    const out = await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      if (b.stageId && (await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.stageId, id])).rowCount === 0) throw invalid('That stage is not in this pipeline');
      const taken = (await tx.query<{ pipeline: string }>('SELECT (SELECT p.name FROM pipelines p WHERE p.id = r.pipeline_id) AS pipeline FROM alias_rules r WHERE r.alias = $1', [alias])).rows[0];
      if (taken) throw new HttpError(409, 'alias_taken', `${alias} already sends mail to ${taken.pipeline ?? 'another pipeline'}`);
      const r = await tx.query<{ id: string }>('INSERT INTO alias_rules (tenant_id, pipeline_id, stage_id, alias, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [ctx.tenantId, id, b.stageId ?? null, alias, ctx.userId]);
      await audit(tx, ctx, 'alias_rule_created', 'pipeline', id, { aliasRuleId: r.rows[0]!.id, alias });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  app.delete('/v1/pipelines/:id/aliases/:ruleId', { schema: { params: { type: 'object', properties: { id: uuid, ruleId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, ruleId } = req.params as { id: string; ruleId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      const r = await tx.query('DELETE FROM alias_rules WHERE id = $1 AND pipeline_id = $2', [ruleId, id]);
      if (r.rowCount === 0) throw notFound('Alias rule not found');
      await audit(tx, ctx, 'alias_rule_deleted', 'pipeline', id, { aliasRuleId: ruleId });
    });
    return reply.code(204).send();
  });
}
