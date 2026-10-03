import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validateCustomValues, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { invalid, notFound } from './errors.ts';
import { allowedContexts, fieldDefsFor, page, pageQuery, requireCrm, requireEdit, resolveOwnerAndContext, scopeSql, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const BOX_COLS = `b.id, b.pipeline_id AS "pipelineId", b.stage_id AS "stageId", b.owner_node_id AS "ownerNodeId",
  b.context_node_id AS "contextNodeId", b.owner_user_id AS "ownerUserId", b.name, b.value_amount AS "valueAmount",
  b.currency, b.close_date::text AS "closeDate", b.custom, b.created_at AS "createdAt", b.updated_at AS "updatedAt",
  b.stage_entered_at AS "stageEnteredAt", b.position,
  (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = b.owner_user_id) AS "ownerName",
  (SELECT m.sent_at FROM linked_thread_messages m JOIN box_threads bt ON bt.thread_id = m.thread_id WHERE bt.box_id = b.id ORDER BY m.sent_at DESC NULLS LAST LIMIT 1) AS "lastEmailAt",
  (SELECT m.from_addr FROM linked_thread_messages m JOIN box_threads bt ON bt.thread_id = m.thread_id WHERE bt.box_id = b.id ORDER BY m.sent_at DESC NULLS LAST LIMIT 1) AS "lastEmailFrom",
  GREATEST(0, floor(extract(epoch FROM (now() - b.stage_entered_at)) / 86400))::int AS "daysInStage"`;

const idParams = { type: 'object', properties: { id: uuid } } as const;

export function registerBoxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  /** A pipeline can be used by a record owner if the owner's branch owns it, or it is shared down from an ancestor. */
  async function pipelineUsable(tx: Tx, pipelineId: string, ownerNodeId: string): Promise<void> {
    const { rows } = await tx.query(
      `SELECT 1 FROM pipelines p WHERE p.id = $1 AND (p.owner_node_id = $2 OR (p.is_shared_down AND EXISTS
         (SELECT 1 FROM org_reach r WHERE r.ancestor_id = p.owner_node_id AND r.descendant_id = $2)))`,
      [pipelineId, ownerNodeId],
    );
    if (rows.length === 0) throw invalid('That pipeline is not available to the record owner');
  }

  async function stageIn(tx: Tx, pipelineId: string, stageId: string): Promise<void> {
    const r = await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [stageId, pipelineId]);
    if (r.rowCount === 0) throw invalid('That stage does not belong to the pipeline');
  }

  async function ownerUserOk(tx: Tx, userId: string, ownerNodeId: string): Promise<void> {
    const r = await tx.query('SELECT 1 FROM user_node_roles WHERE user_id = $1 AND node_id = $2', [userId, ownerNodeId]);
    if (r.rowCount === 0) throw invalid('That person does not belong to the owning branch');
  }

  async function loadBox(tx: Tx, id: string) {
    const { rows } = await tx.query(`SELECT ${BOX_COLS} FROM boxes b WHERE b.id = $1`, [id]);
    if (!rows[0]) throw notFound('Box not found');
    return rows[0] as { id: string; pipelineId: string; stageId: string; ownerNodeId: string; custom: Record<string, unknown> };
  }

  app.get('/v1/org/contexts', { schema: { querystring: { type: 'object', properties: { ownerNodeId: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const owner = (req.query as { ownerNodeId?: string }).ownerNodeId ?? ctx.nodeIds[0]!;
    return { ownerNodeId: owner, locations: await run(ctx, (tx) => allowedContexts(tx, owner)) };
  });

  app.post(
    '/v1/boxes',
    {
      schema: {
        body: {
          type: 'object', required: ['pipelineId', 'name'], additionalProperties: false,
          properties: {
            pipelineId: uuid, stageId: uuid, name: { type: 'string', minLength: 1, maxLength: 200 },
            ownerNodeId: uuid, contextNodeId: uuid, ownerUserId: uuid,
            valueAmount: { type: 'number', minimum: 0, maximum: 999999999999 },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            closeDate: { type: 'string', format: 'date' },
            custom: { type: 'object' },
            contactIds: { type: 'array', items: uuid, maxItems: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const b = req.body as {
        pipelineId: string; stageId?: string; name: string; ownerNodeId?: string; contextNodeId?: string; ownerUserId?: string;
        valueAmount?: number; currency?: string; closeDate?: string; custom?: Record<string, unknown>; contactIds?: string[];
      };
      const out = await run(ctx, async (tx) => {
        const { ownerNodeId, contextNodeId } = await resolveOwnerAndContext(tx, ctx, b);
        await pipelineUsable(tx, b.pipelineId, ownerNodeId);
        let stageId = b.stageId;
        if (stageId) await stageIn(tx, b.pipelineId, stageId);
        else {
          const s = await tx.query<{ id: string }>('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1', [b.pipelineId]);
          if (!s.rows[0]) throw invalid('The pipeline has no stages');
          stageId = s.rows[0].id;
        }
        const v = validateCustomValues(await fieldDefsFor(tx, b.pipelineId), b.custom ?? {});
        if (!v.ok) throw invalid(v.errors.join('; '));
        const ownerUserId = b.ownerUserId ?? (ctx.nodeIds.includes(ownerNodeId) ? ctx.userId : null);
        if (b.ownerUserId) await ownerUserOk(tx, b.ownerUserId, ownerNodeId);
        const id = randomUUID();
        await tx.query(
          `INSERT INTO boxes (id, tenant_id, pipeline_id, stage_id, owner_node_id, context_node_id, owner_user_id, name, value_amount, currency, close_date, custom, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,'CAD'),$11,$12,$13)`,
          [id, ctx.tenantId, b.pipelineId, stageId, ownerNodeId, contextNodeId, ownerUserId, b.name.trim(), b.valueAmount ?? null, b.currency ?? null, b.closeDate ?? null, JSON.stringify(v.value), ctx.userId],
        );
        await tx.query(
          `INSERT INTO box_events (tenant_id, box_id, kind, to_stage_id, actor_id) VALUES ($1,$2,'created',$3,$4)`,
          [ctx.tenantId, id, stageId, ctx.userId],
        );
        for (const cid of b.contactIds ?? []) {
          const c = await tx.query('SELECT 1 FROM contacts WHERE id = $1', [cid]);
          if (c.rowCount === 0) throw invalid('A contact does not exist');
          await tx.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, cid, ctx.tenantId]);
        }
        await audit(tx, ctx, 'box_created', 'box', id, { pipelineId: b.pipelineId, ownerNodeId });
        return { id, ownerNodeId, contextNodeId };
      });
      return reply.code(201).send(out);
    },
  );

  app.get(
    '/v1/boxes',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            pipelineId: uuid, stageId: uuid, q: { type: 'string', maxLength: 100 },
            scope: { type: 'string', enum: ['all', 'mine', 'below'] },
            assignee: uuid, minDaysInStage: { type: 'integer', minimum: 0, maximum: 3650 },
            sort: { type: 'string', enum: ['updated', 'created', 'name', 'value', 'closeDate', 'daysInStage', 'position', 'lastEmail'] },
            dir: { type: 'string', enum: ['asc', 'desc'] },
            ...pageQuery,
          },
        },
      },
    },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const q = req.query as {
        pipelineId?: string; stageId?: string; q?: string; scope?: string; assignee?: string; minDaysInStage?: number;
        sort?: string; dir?: string; limit?: number; offset?: number;
      };
      const { limit, offset } = page(q);
      const sortCol: Record<string, string> = {
        updated: 'b.updated_at', created: 'b.created_at', name: 'lower(b.name)', value: 'b.value_amount',
        closeDate: 'b.close_date', lastEmail: '"lastEmailAt"', daysInStage: 'b.stage_entered_at', position: 'b.position',
      };
      // daysInStage ascending means entered most recently, so flip the direction for that column
      const sortKey = q.sort ?? 'updated';
      let dir = q.dir === 'asc' ? 'ASC' : 'DESC';
      if (sortKey === 'daysInStage') dir = dir === 'ASC' ? 'DESC' : 'ASC';
      if (sortKey === 'position' && !q.dir) dir = 'ASC';
      return run(ctx, async (tx) => {
        const rows = (
          await tx.query(
            `SELECT ${BOX_COLS}, count(*) OVER ()::int AS "total" FROM boxes b
              WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND ($2::uuid IS NULL OR b.stage_id = $2)
                AND ($3::text IS NULL OR b.name ILIKE '%' || $3 || '%')
                AND ${scopeSql(4)}
                AND ($6::uuid IS NULL OR b.owner_user_id = $6)
                AND ($7::int IS NULL OR b.stage_entered_at <= now() - ($7::int * interval '1 day'))
              ORDER BY ${sortCol[sortKey]} ${dir} NULLS LAST, b.id LIMIT $8 OFFSET $9`,
            [q.pipelineId ?? null, q.stageId ?? null, q.q ?? null, q.scope ?? 'all', ctx.nodeIds, q.assignee ?? null, q.minDaysInStage ?? null, limit, offset],
          )
        ).rows as Array<{ total: number }>;
        const total = rows[0]?.total ?? 0;
        return { boxes: rows.map(({ total: _t, ...r }) => r), total, limit, offset };
      });
    },
  );

  app.get('/v1/boxes/:id/events', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await loadBox(tx, id);
      const events = (
        await tx.query(
          `SELECT e.id, e.kind, e.from_stage_id AS "fromStageId", fs.name AS "fromStage", e.to_stage_id AS "toStageId", ts.name AS "toStage",
                  e.actor_id AS "actorId", e.created_at AS "createdAt"
             FROM box_events e LEFT JOIN stages fs ON fs.id = e.from_stage_id LEFT JOIN stages ts ON ts.id = e.to_stage_id
            WHERE e.box_id = $1 ORDER BY e.created_at DESC, e.id LIMIT 200`,
          [id],
        )
      ).rows;
      return { events };
    });
  });

  app.get('/v1/boxes/:id', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const box = await loadBox(tx, id);
      const contacts = (
        await tx.query(
          `SELECT c.id, c.full_name AS "fullName", c.email FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 ORDER BY c.full_name`,
          [id],
        )
      ).rows;
      return { ...box, contacts, canEdit: ctx.isTenantAdmin || ctx.nodeIds.includes(box.ownerNodeId) };
    });
  });

  app.patch(
    '/v1/boxes/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 }, stageId: uuid, ownerUserId: { anyOf: [uuid, { type: 'null' }] },
            valueAmount: { type: ['number', 'null'], minimum: 0, maximum: 999999999999 },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' }, closeDate: { type: ['string', 'null'], format: 'date' }, custom: { type: 'object' }, position: { type: 'number' },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { position?: number; name?: string; stageId?: string; ownerUserId?: string | null; valueAmount?: number | null; currency?: string; closeDate?: string | null; custom?: Record<string, unknown> };
      await run(ctx, async (tx) => {
        const box = await loadBox(tx, id);
        requireEdit(ctx, box.ownerNodeId);
        if (b.stageId) await stageIn(tx, box.pipelineId, b.stageId);
        if (b.ownerUserId) await ownerUserOk(tx, b.ownerUserId, box.ownerNodeId);
        let custom: Record<string, unknown> | null = null;
        if (b.custom) {
          const v = validateCustomValues(await fieldDefsFor(tx, box.pipelineId), b.custom, { partial: true });
          if (!v.ok) throw invalid(v.errors.join('; '));
          custom = { ...box.custom };
          for (const k of Object.keys(b.custom)) {
            if (k in v.value) custom[k] = v.value[k];
            else delete custom[k];
          }
        }
        const has = (k: string) => k in b;
        await tx.query(
          `UPDATE boxes SET name = coalesce($2, name), stage_id = coalesce($3, stage_id),
             owner_user_id = CASE WHEN $4 THEN $5::uuid ELSE owner_user_id END,
             value_amount = CASE WHEN $6 THEN $7::numeric ELSE value_amount END,
             stage_entered_at = CASE WHEN $12::uuid IS NOT NULL AND $12 <> stage_id THEN now() ELSE stage_entered_at END,
             position = coalesce($13::double precision, position),
             currency = coalesce($8, currency),
             close_date = CASE WHEN $9 THEN $10::date ELSE close_date END,
             custom = coalesce($11::jsonb, custom), updated_at = now() WHERE id = $1`,
          [id, b.name?.trim() ?? null, b.stageId ?? null, has('ownerUserId'), b.ownerUserId ?? null, has('valueAmount'), b.valueAmount ?? null, b.currency ?? null, has('closeDate'), b.closeDate ?? null, custom ? JSON.stringify(custom) : null, b.stageId ?? null, b.position ?? null],
        );
        if (b.stageId && b.stageId !== box.stageId) {
          await tx.query(
            `INSERT INTO box_events (tenant_id, box_id, kind, from_stage_id, to_stage_id, actor_id) VALUES ($1,$2,'stage_changed',$3,$4,$5)`,
            [ctx.tenantId, id, box.stageId, b.stageId, ctx.userId],
          );
        }
        await audit(tx, ctx, b.stageId && b.stageId !== box.stageId ? 'box_stage_moved' : 'box_updated', 'box', id, { fields: Object.keys(b) });
      });
      return reply.code(204).send();
    },
  );

  app.delete('/v1/boxes/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const box = await loadBox(tx, id);
      requireEdit(ctx, box.ownerNodeId);
      await tx.query('DELETE FROM boxes WHERE id = $1', [id]);
      await audit(tx, ctx, 'box_deleted', 'box', id);
    });
    return reply.code(204).send();
  });

  const linkParams = { type: 'object', properties: { id: uuid, contactId: uuid } } as const;
  app.put('/v1/boxes/:id/contacts/:contactId', { schema: { params: linkParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, contactId } = req.params as { id: string; contactId: string };
    await run(ctx, async (tx) => {
      const box = await loadBox(tx, id);
      requireEdit(ctx, box.ownerNodeId);
      const c = await tx.query('SELECT 1 FROM contacts WHERE id = $1', [contactId]);
      if (c.rowCount === 0) throw notFound('Contact not found');
      await tx.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, contactId, ctx.tenantId]);
    });
    return reply.code(204).send();
  });
  app.delete('/v1/boxes/:id/contacts/:contactId', { schema: { params: linkParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, contactId } = req.params as { id: string; contactId: string };
    await run(ctx, async (tx) => {
      const box = await loadBox(tx, id);
      requireEdit(ctx, box.ownerNodeId);
      await tx.query('DELETE FROM box_contacts WHERE box_id = $1 AND contact_id = $2', [id, contactId]);
    });
    return reply.code(204).send();
  });
}
