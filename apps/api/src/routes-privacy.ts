import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { uuid } from './crm-helpers.ts';
import { audit } from './audit.ts';
import { forbidden, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const REQ_COLS = `r.id, r.kind, r.note, r.status, r.resolution, r.created_at AS "createdAt", r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
                  r.user_id AS "userId", coalesce(u.display_name, u.email::text) AS "personName"`;

export function registerPrivacyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = deps.appPool;

  /** What is held about me, where it lives, and my requests. Admins also get everyone's open requests. */
  app.get('/v1/privacy', async (req) => {
    const { ctx, user } = await deps.authenticate(req);
    return withRequestTx(run, ctx, async (tx) => {
      const n = async (sql: string) => (await tx.query<{ n: number }>(sql, [ctx.userId])).rows[0]!.n;
      const consents = (await tx.query(`SELECT kind, notice_version AS "noticeVersion", locale, region::text AS region, accepted_at AS "acceptedAt" FROM consent_records WHERE user_id = $1 ORDER BY accepted_at DESC`, [ctx.userId])).rows;
      const mine = (await tx.query(`SELECT ${REQ_COLS} FROM privacy_requests r JOIN app_users u ON u.id = r.user_id WHERE r.user_id = $1 ORDER BY r.created_at DESC`, [ctx.userId])).rows;
      const queue = ctx.isTenantAdmin
        ? (await tx.query(`SELECT ${REQ_COLS} FROM privacy_requests r JOIN app_users u ON u.id = r.user_id WHERE r.status = 'open' ORDER BY r.due_at`)).rows
        : [];
      const ai = (await tx.query<{ enabled: boolean }>('SELECT enabled FROM tenant_ai LIMIT 1')).rows[0]?.enabled ?? false;
      return {
        region: deps.config.region,
        email: user.email,
        held: {
          notes: await n('SELECT count(*)::int AS n FROM notes WHERE author_id = $1'),
          tasks: await n('SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1'),
          notifications: await n('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1'),
          settings: await n(`SELECT count(*)::int AS n FROM setting_values WHERE scope_type = 'user' AND scope_id = $1`),
          consents: consents.length,
        },
        consents,
        aiEnabled: ai,
        requests: mine,
        queue,
      };
    });
  });

  /** Everything personal to me, as one JSON document. Gmail tokens and other people's data are never included. */
  app.get('/v1/privacy/export', async (req, reply) => {
    const { ctx, user } = await deps.authenticate(req);
    const doc = await withRequestTx(run, ctx, async (tx) => {
      const q = async (sql: string) => (await tx.query(sql, [ctx.userId])).rows;
      await audit(tx, ctx, 'privacy_export', 'user', ctx.userId);
      return {
        exportedAt: new Date().toISOString(),
        region: deps.config.region,
        profile: { id: user.userId, email: user.email, displayName: user.displayName, locale: user.locale, tenant: user.tenantName },
        consents: await q(`SELECT kind, notice_version AS "noticeVersion", locale, region::text AS region, accepted_at AS "acceptedAt" FROM consent_records WHERE user_id = $1 ORDER BY accepted_at`),
        settings: await q(`SELECT key, value, updated_at AS "updatedAt" FROM setting_values WHERE scope_type = 'user' AND scope_id = $1 ORDER BY key`),
        notes: await q(`SELECT id, box_id AS "boxId", body, created_at AS "createdAt" FROM notes WHERE author_id = $1 ORDER BY created_at`),
        tasks: await q(`SELECT id, box_id AS "boxId", title, due_at AS "dueAt", done_at AS "doneAt", created_at AS "createdAt" FROM tasks WHERE assignee_id = $1 ORDER BY created_at`),
        notifications: await q(`SELECT kind, data, created_at AS "createdAt", read_at AS "readAt" FROM notifications WHERE user_id = $1 ORDER BY created_at`),
        requests: await q(`SELECT kind, note, status, resolution, created_at AS "createdAt", resolved_at AS "resolvedAt" FROM privacy_requests WHERE user_id = $1 ORDER BY created_at`),
        activity: await q(`SELECT action, entity_type AS "entityType", created_at AS "createdAt" FROM audit_log WHERE actor_user_id = $1 ORDER BY created_at DESC LIMIT 1000`),
      };
    });
    return reply.header('content-disposition', 'attachment; filename="my-data.json"').send(doc);
  });

  app.post('/v1/privacy/requests', {
    schema: { body: { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { enum: ['access', 'withdraw', 'erase'] }, note: { type: 'string', maxLength: 2000 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { kind: string; note?: string };
    const row = await withRequestTx(run, ctx, async (tx) => {
      // One open request of each kind at a time.
      const open = (await tx.query('SELECT id FROM privacy_requests WHERE user_id = $1 AND kind = $2 AND status = $3', [ctx.userId, b.kind, 'open'])).rows[0];
      if (open) return { id: (open as { id: string }).id, duplicate: true };
      const id = (await tx.query<{ id: string }>(
        'INSERT INTO privacy_requests (tenant_id, user_id, kind, note) VALUES ($1, $2, $3, $4) RETURNING id', [ctx.tenantId, ctx.userId, b.kind, b.note ?? null])).rows[0]!.id;
      await audit(tx, ctx, 'privacy_request', 'privacy_request', id, { kind: b.kind });
      return { id, duplicate: false };
    });
    return reply.code(row.duplicate ? 200 : 201).send(row);
  });

  app.patch('/v1/privacy/requests/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { enum: ['done', 'declined'] }, resolution: { type: 'string', maxLength: 2000 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin) throw forbidden('Only a company administrator can resolve privacy requests');
    const { id } = req.params as { id: string };
    const b = req.body as { status: string; resolution?: string };
    await withRequestTx(run, ctx, async (tx) => {
      const r = await tx.query(`UPDATE privacy_requests SET status = $2, resolution = $3, resolved_at = now(), resolved_by = $4 WHERE id = $1 AND status = 'open'`, [id, b.status, b.resolution ?? null, ctx.userId]);
      if (!r.rowCount) throw notFound('No open request with that id');
      await audit(tx, ctx, 'privacy_resolved', 'privacy_request', id, { status: b.status });
    });
    return reply.code(204).send();
  });
}
