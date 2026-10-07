import type { FastifyInstance } from 'fastify';
import { SETTINGS } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { uuid } from './crm-helpers.ts';
import { resolveSettings } from './settings.ts';
import type { AppDeps } from './app.ts';

/** The kinds this person has switched on in Settings > Notifications. */
export async function enabledKinds(tx: Tx, userId: string): Promise<string[]> {
  const keys = SETTINGS.filter((s) => s.key.startsWith('notify.')).map((s) => s.key);
  const v = await resolveSettings(tx, userId, keys);
  return keys.filter((k) => v[k]!.value === true).map((k) => k.slice('notify.'.length));
}

export async function unreadCount(tx: Tx, userId: string): Promise<number> {
  const kinds = await enabledKinds(tx, userId);
  return (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL AND kind = ANY ($1)', [kinds])).rows[0]!.n;
}

export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/me/email-reminders', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const r = (await deps.authPool.query<{ on: boolean }>('SELECT email_reminders AS on FROM app_users WHERE id = $1', [ctx.userId])).rows[0];
    return { enabled: r?.on ?? true, available: Boolean(deps.mailer) };
  });
  app.put('/v1/me/email-reminders', { schema: { body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    await deps.authPool.query('UPDATE app_users SET email_reminders = $2 WHERE id = $1', [ctx.userId, (req.body as { enabled: boolean }).enabled]);
    return reply.code(204).send();
  });
  app.get('/v1/notifications', { schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const limit = (req.query as { limit?: number }).limit ?? 50;
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const kinds = await enabledKinds(tx, ctx.userId);
      const rows = (await tx.query(
        `SELECT n.id, n.kind, n.box_id AS "boxId", n.data, n.created_at AS "createdAt", n.read_at AS "readAt", coalesce(u.display_name, u.email::text) AS "actorName",
                (SELECT b.pipeline_id FROM boxes b WHERE b.id = n.box_id) AS "pipelineId"
           FROM notifications n LEFT JOIN app_users u ON u.id = n.actor_id
          WHERE n.kind = ANY ($1) ORDER BY n.created_at DESC LIMIT $2`, [kinds, limit])).rows;
      return { notifications: rows, unread: await unreadCount(tx, ctx.userId) };
    });
  });

  app.post('/v1/notifications/read', { schema: { body: { type: 'object', additionalProperties: false, properties: { ids: { type: 'array', maxItems: 100, items: uuid }, all: { type: 'boolean' } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = (req.body ?? {}) as { ids?: string[]; all?: boolean };
    await withRequestTx(deps.appPool, ctx, async (tx) => {
      if (b.all) await tx.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL');
      else if (b.ids?.length) await tx.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL AND id = ANY ($1::uuid[])', [b.ids]);
    });
    return reply.code(204).send();
  });
}
