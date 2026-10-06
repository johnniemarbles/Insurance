import { withRequestTx, type Tx } from '@pii/db';
import { actingAs } from './effects.ts';
import { overviewNumbers } from './routes-insights.ts';
import type { AppDeps } from './app.ts';

export interface Snapshot { day: string; data: Record<string, number> }

/** The saved counts closest to a month ago (between a week and six weeks old), or null while there is not enough history. */
export async function snapshotBefore(tx: Tx, scope: 'company' | 'ho', days: number): Promise<Snapshot | null> {
  const r = await tx.query<Snapshot>(
    `SELECT day::text AS day, data FROM count_snapshots
      WHERE scope = $1 AND day <= current_date - 7 AND day >= current_date - 45
      ORDER BY abs((current_date - day) - $2::int), day DESC LIMIT 1`, [scope, days]);
  return r.rows[0] ?? null;
}

const flat = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) as Record<string, number>;

/** Once a day per company: save today's counts. Safe to run on every tick and on several servers. */
const done = new Set<string>();
export async function sweepSnapshots(deps: AppDeps): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null; ho: boolean }>(
    `SELECT n.tenant_id, n.id AS node, t.is_head_office AS ho,
            (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let n = 0;
  for (const t of tenants) {
    const key = `${t.tenant_id}:${today}`;
    if (done.has(key) || !t.admin) continue;
    try {
      const made = await withRequestTx(deps.appPool, { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true, adminNodeIds: [t.node] }, async (tx) => {
        const scope = t.ho ? 'ho' : 'company';
        if ((await tx.query('SELECT 1 FROM count_snapshots WHERE scope = $1 AND day = current_date', [scope])).rowCount) return false;
        let data: Record<string, number>;
        if (t.ho) {
          const i = (await tx.query<{ r: any }>('SELECT ho_insights($1) AS r', [Number(process.env.EO_MIN_LIMIT ?? 0)])).rows[0]!.r;
          data = { partners: i.funnel.partners, approved: i.funnel.approved, waiting: i.backlog.waiting, overdue: i.expiry.overdue, within30: i.expiry.within30, companies: i.companies.total, belowEo: i.coverage.below };
        } else {
          const o = await overviewNumbers(tx);
          data = flat({ openValue: o.pipeline.openValue, openCount: o.pipeline.openCount, won: o.pipeline.won, lost: o.pipeline.lost, stalled: o.pipeline.stalled, overdueTasks: o.tasks.overdue, renewalsExpired: o.renewals.expired, renewals30: o.renewals.d30, partners: o.partners.partners, approved: o.partners.approved, team: o.team });
        }
        await tx.query('INSERT INTO count_snapshots (tenant_id, day, scope, data) VALUES ($1, current_date, $2, $3) ON CONFLICT DO NOTHING', [t.tenant_id, scope, JSON.stringify(data)]);
        return true;
      });
      done.add(key); if (made) n++;
    } catch { /* next company, next tick */ }
  }
  if (done.size > 5000) done.clear();
  return n;
}
