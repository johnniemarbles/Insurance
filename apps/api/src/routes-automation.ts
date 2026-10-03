import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { managerNodeIds, requireCrm, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const COLS = `a.id, a.pipeline_id AS "pipelineId", a.stage_id AS "stageId", a.trigger, a.stale_days AS "staleDays", a.action, a.title, a.due_in_days AS "dueInDays", a.body,
  a.assignee_user_id AS "assigneeUserId", a.target_stage_id AS "targetStageId", a.target_pipeline_id AS "targetPipelineId", a.merge_id AS "mergeId", (SELECT m.name FROM mail_merges m WHERE m.id = a.merge_id) AS "mergeName", a.active,
  (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = a.assignee_user_id) AS "assigneeName",
  (SELECT st.name FROM stages st WHERE st.id = a.target_stage_id) AS "targetStageName",
  (SELECT pl.name FROM pipelines pl WHERE pl.id = a.target_pipeline_id) AS "targetPipelineName"`;

/** Automations and shared views. Managers of the pipeline's branch define automations; anyone can keep their own views. */
export function registerAutomationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const pid = { type: 'object', properties: { id: uuid } } as const;

  async function manage(tx: Tx, ctx: RequestContext, pipelineId: string) {
    const p = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM pipelines WHERE id = $1', [pipelineId])).rows[0];
    if (!p) throw notFound('Pipeline not found');
    if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(p.owner_node_id)) throw forbidden('Only a manager of the owning branch can change this pipeline');
    return p;
  }

  app.get('/v1/pipelines/:id/automations', { schema: { params: pid } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id])).rowCount === 0) throw notFound('Pipeline not found');
      return { automations: (await tx.query(`SELECT ${COLS} FROM automations a WHERE a.pipeline_id = $1 ORDER BY a.created_at`, [id])).rows };
    });
  });

  app.post(
    '/v1/pipelines/:id/automations',
    {
      schema: {
        params: pid,
        body: {
          type: 'object', required: ['stageId', 'action'], additionalProperties: false,
          properties: {
            stageId: uuid, trigger: { enum: ['enter', 'stale', 'email'] }, staleDays: { type: 'integer', minimum: 1, maximum: 3650 },
            action: { enum: ['create_task', 'assign_owner', 'add_note', 'move_stage', 'copy_to_pipeline', 'add_to_merge'] },
            title: { type: 'string', minLength: 1, maxLength: 300 }, dueInDays: { type: 'integer', minimum: 0, maximum: 3650 }, assigneeUserId: uuid,
            body: { type: 'string', minLength: 1, maxLength: 1000 }, targetStageId: uuid, targetPipelineId: uuid, mergeId: uuid,
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { stageId: string; trigger?: 'enter' | 'stale' | 'email'; staleDays?: number; action: string; title?: string; dueInDays?: number; assigneeUserId?: string; body?: string; targetStageId?: string; targetPipelineId?: string; mergeId?: string };
      const trigger = b.trigger ?? 'enter';
      if (trigger === 'stale' && !b.staleDays) throw invalid('Say how many days a record may sit in the stage');
      if (b.action === 'create_task' && !b.title?.trim()) throw invalid('A task automation needs a title');
      if (b.action === 'assign_owner' && !b.assigneeUserId) throw invalid('Choose who the record is assigned to');
      if (b.action === 'add_note' && !b.body?.trim()) throw invalid('Write the note to add');
      if (b.action === 'move_stage' && !b.targetStageId) throw invalid('Choose the stage to move the record to');
      if (b.action === 'move_stage' && b.targetStageId === b.stageId) throw invalid('Choose a different stage to move to');
      if (b.action === 'copy_to_pipeline' && (!b.targetPipelineId || b.targetPipelineId === id)) throw invalid('Choose a different pipeline to copy to');
      if (b.action === 'add_to_merge' && !b.mergeId) throw invalid('Choose the mail merge to add contacts to');
      const out = await run(ctx, async (tx) => {
        await manage(tx, ctx, id);
        if (b.action === 'add_to_merge' && (await tx.query(`SELECT 1 FROM mail_merges WHERE id = $1 AND user_id = $2 AND status <> 'cancelled'`, [b.mergeId, ctx.userId])).rowCount === 0) throw invalid('Choose one of your own mail merges');
        if ((await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.stageId, id])).rowCount === 0) throw invalid('That stage is not in this pipeline');
        if (b.assigneeUserId && (await tx.query('SELECT 1 FROM app_users WHERE id = $1', [b.assigneeUserId])).rowCount === 0) throw invalid('That person is not visible to you');
        if (b.action === 'move_stage' && (await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.targetStageId, id])).rowCount === 0) throw invalid('The target stage is not in this pipeline');
        if (b.action === 'copy_to_pipeline') {
          if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [b.targetPipelineId])).rowCount === 0) throw invalid('That pipeline is not available to you');
          if (b.targetStageId && (await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.targetStageId, b.targetPipelineId])).rowCount === 0) throw invalid('That stage is not in the target pipeline');
        }
        const r = await tx.query<{ id: string }>(
          `INSERT INTO automations (tenant_id, pipeline_id, stage_id, trigger, stale_days, action, title, due_in_days, assignee_user_id, body, target_stage_id, target_pipeline_id, merge_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [ctx.tenantId, id, b.stageId, trigger, trigger === 'stale' ? b.staleDays : null, b.action,
            b.action === 'create_task' ? b.title!.trim() : null, b.action === 'create_task' ? (b.dueInDays ?? null) : null,
            b.action === 'assign_owner' ? b.assigneeUserId : null, b.action === 'add_note' ? b.body!.trim() : null,
            b.action === 'move_stage' || b.action === 'copy_to_pipeline' ? (b.targetStageId ?? null) : null, b.action === 'copy_to_pipeline' ? b.targetPipelineId : null, b.action === 'add_to_merge' ? b.mergeId : null, ctx.userId],
        );
        await audit(tx, ctx, 'automation_created', 'pipeline', id, { automationId: r.rows[0]!.id });
        return { id: r.rows[0]!.id };
      });
      return reply.code(201).send(out);
    },
  );

  const aid = { type: 'object', properties: { id: uuid, autoId: uuid } } as const;
  app.patch('/v1/pipelines/:id/automations/:autoId', { schema: { params: aid, body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, autoId } = req.params as { id: string; autoId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      const r = await tx.query('UPDATE automations SET active = $3 WHERE id = $1 AND pipeline_id = $2', [autoId, id, (req.body as { active: boolean }).active]);
      if (r.rowCount === 0) throw notFound('Automation not found');
    });
    return reply.code(204).send();
  });
  app.delete('/v1/pipelines/:id/automations/:autoId', { schema: { params: aid } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, autoId } = req.params as { id: string; autoId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      const r = await tx.query('DELETE FROM automations WHERE id = $1 AND pipeline_id = $2', [autoId, id]);
      if (r.rowCount === 0) throw notFound('Automation not found');
      await audit(tx, ctx, 'automation_deleted', 'pipeline', id, { automationId: autoId });
    });
    return reply.code(204).send();
  });

  // ---- saved views (own, or shared with whoever can see the pipeline) ----
  app.get('/v1/pipelines/:id/views', { schema: { params: pid } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => ({
      views: (await tx.query(
        `SELECT v.id, v.name, v.config, v.is_shared AS "shared", (v.user_id = $2) AS "mine", coalesce(u.display_name, u.email::text) AS "author"
           FROM saved_views v LEFT JOIN app_users u ON u.id = v.user_id WHERE v.pipeline_id = $1 ORDER BY v.name`, [id, ctx.userId],
      )).rows,
    }));
  });
  app.post(
    '/v1/pipelines/:id/views',
    { schema: { params: pid, body: { type: 'object', required: ['name', 'config'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, config: { type: 'object' }, shared: { type: 'boolean' } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { name: string; config: object; shared?: boolean };
      if (JSON.stringify(b.config).length > 8000) throw invalid('That view is too large');
      const out = await run(ctx, async (tx) => {
        if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id])).rowCount === 0) throw notFound('Pipeline not found');
        const r = await tx.query<{ id: string }>(
          `INSERT INTO saved_views (tenant_id, pipeline_id, user_id, name, config, is_shared) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (pipeline_id, user_id, name) DO UPDATE SET config = EXCLUDED.config, is_shared = EXCLUDED.is_shared RETURNING id`,
          [ctx.tenantId, id, ctx.userId, b.name.trim(), JSON.stringify(b.config), b.shared ?? false],
        );
        return { id: r.rows[0]!.id };
      });
      return reply.code(201).send(out);
    },
  );
  app.delete('/v1/views/:id', { schema: { params: pid } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await tx.query('DELETE FROM saved_views WHERE id = $1 AND user_id = $2', [id, ctx.userId]);
      if (r.rowCount === 0) throw notFound('View not found');
    });
    return reply.code(204).send();
  });
}
