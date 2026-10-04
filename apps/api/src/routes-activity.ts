import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden } from './errors.ts';
import type { AppDeps } from './app.ts';

/** The audit log grouped the way an administrator thinks about it. */
const AREAS: Record<string, string> = {
  invitations: `a.action LIKE 'invitation\\_%'`,
  people: `a.action IN ('role_added', 'role_removed', 'user_disabled', 'user_enabled')`,
  structure: `a.action IN ('node_created', 'node_updated', 'link_changed')`,
  settings: `a.action IN ('setting_changed', 'setting_reverted', 'ai_settings_changed')`,
  privacy: `a.action LIKE 'privacy\\_%'`,
};
const KNOWN = Object.values(AREAS);
const AREA_CASE = `CASE WHEN ${AREAS.invitations} THEN 'invitations' WHEN ${AREAS.people} THEN 'people' WHEN ${AREAS.structure} THEN 'structure' WHEN ${AREAS.settings} THEN 'settings' WHEN ${AREAS.privacy} THEN 'privacy' ELSE 'records' END`;

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function registerActivityRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/activity', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      area: { enum: ['invitations', 'people', 'structure', 'settings', 'privacy', 'records'] }, actor: { type: 'string', format: 'uuid' }, place: { type: 'string', format: 'uuid' },
      q: { type: 'string', maxLength: 100 }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, attention: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 }, before: { type: 'integer', minimum: 1 }, format: { enum: ['json', 'csv'] },
    } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin && ctx.adminNodeIds.length === 0) throw forbidden('Only administrators can read the activity log');
    const q = req.query as { area?: string; actor?: string; place?: string; q?: string; from?: string; to?: string; attention?: boolean; limit?: number; before?: number; format?: string };
    const csv = q.format === 'csv';
    const where: string[] = [];
    const args: unknown[] = [];
    const arg = (v: unknown) => { args.push(v); return `$${args.length}`; };
    if (q.area) where.push(q.area === 'records' ? `NOT (${KNOWN.join(' OR ')})` : AREAS[q.area]!);
    if (q.actor) where.push(`a.actor_user_id = ${arg(q.actor)}`);
    if (q.place) where.push(`a.owner_node_id IN (SELECT descendant_id FROM org_reach WHERE ancestor_id = ${arg(q.place)})`);
    if (q.q) where.push(`(a.detail::text ILIKE ${arg(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`)} OR a.action ILIKE ${arg(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`)} OR coalesce(u.display_name, u.email::text) ILIKE ${arg(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`)})`);
    if (q.from) where.push(`a.created_at >= ${arg(q.from)}::date`);
    if (q.to) where.push(`a.created_at < (${arg(q.to)}::date + 1)`);
    if (q.attention) where.push(`a.action = 'invitation_not_sent'`);
    if (q.before) where.push(`a.id < ${arg(q.before)}`);
    const limit = csv ? 5000 : (q.limit ?? 100);
    const rows = await withRequestTx(deps.appPool, ctx, async (tx) => {
      const r = (await tx.query(
        `SELECT a.id, a.created_at AS "createdAt", a.action, ${AREA_CASE} AS area, a.actor_user_id AS "actorId", coalesce(u.display_name, u.email::text) AS "actorName",
                a.entity_type AS "entityType", a.entity_id AS "entityId", a.detail, a.owner_node_id AS "placeId", n.name AS "placeName",
                (SELECT name FROM org_nodes WHERE id = nullif(a.detail->>'nodeId', '')::uuid) AS "detailPlaceName"
           FROM audit_log a LEFT JOIN app_users u ON u.id = a.actor_user_id LEFT JOIN org_nodes n ON n.id = a.owner_node_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}`, args)).rows as Array<Record<string, any>>;
      if (csv) await audit(tx, ctx, 'activity_export', 'audit_log', null, { rows: Math.min(r.length, limit), filters: { ...q, format: undefined } });
      return r;
    });
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    if (csv) {
      const head = ['time', 'who', 'action', 'area', 'where', 'detail'];
      const body = page.map((r) => [new Date(r.createdAt).toISOString(), r.actorName ?? '', r.action, r.area, r.placeName ?? r.detailPlaceName ?? '', JSON.stringify(r.detail)].map(csvCell).join(','));
      return { filename: 'activity.csv', csv: [head.join(','), ...body].join('\n') };
    }
    return { events: page.map((r) => ({ ...r, id: Number(r.id) })), more, next: more ? Number(page.at(-1)!.id) : null };
  });
}
