import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import type { Tx } from '@pii/db';
import { requireCrm } from './crm-helpers.ts';
import { actingAs } from './effects.ts';
import type { AppDeps } from './app.ts';

/** Every pipeline uses one field key for the policy's renewal date. The Renewals template and the insurance template both create it. */
const DATE_RE = '^\\d{4}-\\d{2}-\\d{2}$';
const THRESHOLDS = [90, 60, 30] as const;

export interface RenewalRow { id: string; name: string; pipelineId: string; pipeline: string; stage: string; renewalDate: string; daysLeft: number; policyType: string | null; ownerName: string | null; ownerUserId: string | null; hasOpenTask: boolean }

/** Records whose renewal date is within the window, nearest first. Won and lost stages are left out: those are already decided. */
export async function listRenewals(tx: Tx, o: { daysAhead: number; daysBack: number; limit: number }): Promise<{ items: RenewalRow[]; counts: { expired: number; d30: number; d60: number; d90: number } }> {
  const rows = (await tx.query<RenewalRow>(
    `SELECT b.id, b.name, b.pipeline_id AS "pipelineId", p.name AS pipeline, s.name AS stage, (b.custom->>'renewal_date') AS "renewalDate",
            ((b.custom->>'renewal_date')::date - current_date)::int AS "daysLeft", b.custom->>'policy_type' AS "policyType",
            (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = b.owner_user_id) AS "ownerName", b.owner_user_id AS "ownerUserId",
            EXISTS (SELECT 1 FROM tasks t WHERE t.box_id = b.id AND t.done_at IS NULL AND t.title LIKE 'Renewal%') AS "hasOpenTask"
       FROM boxes b JOIN pipelines p ON p.id = b.pipeline_id JOIN stages s ON s.id = b.stage_id
      WHERE b.custom->>'renewal_date' ~ '${DATE_RE}' AND NOT s.is_won AND NOT s.is_lost
        AND (b.custom->>'renewal_date')::date BETWEEN current_date - $1::int AND current_date + $2::int
      ORDER BY (b.custom->>'renewal_date')::date, b.name LIMIT $3`, [o.daysBack, o.daysAhead, o.limit])).rows;
  const c = (await tx.query<{ expired: number; d30: number; d60: number; d90: number }>(
    `SELECT count(*) FILTER (WHERE d < current_date)::int AS expired,
            count(*) FILTER (WHERE d >= current_date AND d <= current_date + 30)::int AS d30,
            count(*) FILTER (WHERE d > current_date + 30 AND d <= current_date + 60)::int AS d60,
            count(*) FILTER (WHERE d > current_date + 60 AND d <= current_date + 90)::int AS d90
       FROM (SELECT (b.custom->>'renewal_date')::date AS d FROM boxes b JOIN stages s ON s.id = b.stage_id
              WHERE b.custom->>'renewal_date' ~ '${DATE_RE}' AND NOT s.is_won AND NOT s.is_lost
                AND (b.custom->>'renewal_date')::date BETWEEN current_date - $1::int AND current_date + 90) x`, [o.daysBack])).rows[0]!;
  return { items: rows, counts: c };
}

export function registerRenewalRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/renewals', { schema: { querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, back: { type: 'integer', minimum: 0, maximum: 365 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const q = req.query as { days?: number; back?: number };
    return withRequestTx(deps.appPool, ctx, (tx) => listRenewals(tx, { daysAhead: q.days ?? 120, daysBack: q.back ?? 60, limit: 500 }));
  });
}

/** Once a day is enough, but this is safe to run often: each record gets each reminder once per renewal date.
 *  A record already inside the 60-day window gets the 60-day task only; the 90-day one is marked as passed. */
export async function sweepRenewals(deps: AppDeps): Promise<number> {
  type Cand = { id: string; tenant_id: string; name: string; node: string; owner: string; rd: string; days: number };
  // The identity role cannot read records (by design), so each company is searched as its own top-level admin, who sees everything below.
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  const cand: Cand[] = [];
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      cand.push(...(await withRequestTx(deps.appPool, { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true }, async (tx) => (await tx.query<Cand>(
        `SELECT b.id, b.tenant_id, b.name, b.owner_node_id AS node, b.owner_user_id AS owner, b.custom->>'renewal_date' AS rd,
                ((b.custom->>'renewal_date')::date - current_date)::int AS days
           FROM boxes b JOIN stages s ON s.id = b.stage_id
          WHERE b.owner_user_id IS NOT NULL AND NOT s.is_won AND NOT s.is_lost AND b.custom->>'renewal_date' ~ '${DATE_RE}'
            AND (b.custom->>'renewal_date')::date BETWEEN current_date AND current_date + 90 LIMIT 2000`)).rows)));
    } catch { /* next company */ }
  }
  let made = 0;
  for (const c of cand) {
    const current = THRESHOLDS.filter((t) => c.days <= t).at(-1); // the tightest window the record is in: 90, 60 or 30
    if (!current) continue;
    try {
      await withRequestTx(deps.appPool, actingAs(c.tenant_id, c.owner, c.node), async (tx) => {
        for (const t of THRESHOLDS) {
          if (t < current) continue;
          const ins = await tx.query(
            `INSERT INTO renewal_marks (box_id, tenant_id, threshold, renewal_date, made_task) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [c.id, c.tenant_id, t, c.rd, t === current]);
          if (t === current && ins.rowCount) {
            const title = `Renewal in ${c.days <= 0 ? 'less than a day' : `${c.days} day${c.days === 1 ? '' : 's'}`}: ${c.name}`;
            await tx.query('INSERT INTO tasks (tenant_id, box_id, owner_node_id, assignee_id, title, due_at) VALUES ($1,$2,$3,$4,$5,now())', [c.tenant_id, c.id, c.node, c.owner, title.slice(0, 300)]);
            made++;
          }
        }
      });
    } catch { /* one record failing must not stop the sweep */ }
  }
  return made;
}
