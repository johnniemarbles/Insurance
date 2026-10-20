import { withRequestTx } from '@pii/db';
import { actingAs } from './effects.ts';
import { tell, countryOf } from './routes-compliance.ts';
import { firstWeekFor } from './routes-firstweek.ts';
import type { AppDeps } from './app.ts';

/**
 * Tells each company's administrators and compliance people about items that will not clear on their own: a large cash receipt with no
 * report reference 15 days on, a screening hit nobody has reviewed after 2 days, and signed paperwork that has waited more than a day to
 * reach the archive vault, and a partner company that is past its first week with steps still open. Each item is told once per person (vault warnings once a week while the problem lasts).
 */
export async function sweepComplianceAlerts(deps: AppDeps): Promise<number> {
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const ctx = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      const people = (await deps.authPool.query<{ user_id: string }>(
        `SELECT DISTINCT r.user_id FROM user_node_roles r JOIN app_users u ON u.id = r.user_id
          WHERE r.tenant_id = $1 AND r.role::text IN ('admin', 'compliance') AND u.status::text <> 'disabled'`, [t.tenant_id])).rows.map((x) => x.user_id);
      if (people.length === 0) continue;
      const items = await withRequestTx(deps.appPool, ctx, async (tx) => {
        const out: { key: string; kind: 'aml_alert' | 'vault_alert' | 'first_week_late' | 'advice_reviews_waiting' | 'needs_review_due'; data: Record<string, unknown>; to?: string[] }[] = [];
        const cash = (await tx.query<{ id: string; box_id: string; name: string; amount: string; currency: string; occurred_on: string }>(
          `SELECT c.id, c.box_id, b.name, c.amount::text AS amount, c.currency, c.occurred_on::text AS occurred_on
             FROM cash_transactions c JOIN boxes b ON b.id = c.box_id
            WHERE c.report_required AND c.reported_at IS NULL AND c.occurred_on < current_date - 15 ORDER BY c.occurred_on LIMIT 100`)).rows;
        for (const c of cash) out.push({ key: `aml:cash:${c.id}`, kind: 'aml_alert', data: { issue: 'cash_overdue', boxId: c.box_id, name: c.name, detail: `${c.amount} ${c.currency}`, since: c.occurred_on } });
        const hits = (await tx.query<{ id: string; box_id: string; name: string; list: string; screened_on: string }>(
          `SELECT s.id, s.box_id, b.name, s.list, s.screened_on::text AS screened_on
             FROM (SELECT DISTINCT ON (box_id, list) id, box_id, list, result, screened_on FROM screening_results ORDER BY box_id, list, created_at DESC) s
             JOIN boxes b ON b.id = s.box_id
            WHERE s.result = 'hit' AND s.screened_on < current_date - 2 ORDER BY s.screened_on LIMIT 100`)).rows;
        for (const h of hits) out.push({ key: `aml:hit:${h.id}`, kind: 'aml_alert', data: { issue: 'screening_hit', boxId: h.box_id, name: h.name, detail: h.list, since: h.screened_on } });
        if (deps.vault) {
          const v = (await tx.query<{ n: number; week: string }>(
            `SELECT count(*)::int AS n, to_char(date_trunc('week', now()), 'YYYY-MM-DD') AS week FROM advice_records a
              WHERE a.status = 'signed' AND a.document_id IS NOT NULL AND a.signed_at < now() - interval '1 day'
                AND EXISTS (SELECT 1 FROM box_documents d WHERE d.id = a.document_id)
                AND NOT EXISTS (SELECT 1 FROM vault_objects o WHERE o.document_id = a.document_id)`)).rows[0]!;
          if (v.n > 0) out.push({ key: `vault:${v.week}`, kind: 'vault_alert', data: { pending: v.n } });
        }
        // Signed advice waiting for a compliance review: once a week while any is waiting.
        const waiting = (await tx.query<{ n: number; flagged: number; week: string }>(
          `SELECT count(*)::int AS n, count(*) FILTER (WHERE reason = 'flagged')::int AS flagged, to_char(date_trunc('week', now()), 'YYYY-MM-DD') AS week FROM advice_reviews WHERE status = 'pending'`)).rows[0]!;
        if (waiting.n > 0) out.push({ key: `advice-reviews:${waiting.week}`, kind: 'advice_reviews_waiting', data: { pending: waiting.n, flagged: waiting.flagged } });
        // A client's needs analysis expiring within 30 days (or already expired in the last 30): tell the record's owner, once per analysis.
        const due = (await tx.query<{ id: string; box_id: string; name: string; valid_until: string; to: string | null }>(
          `SELECT x.id, x.box_id, b.name, x.valid_until::text AS valid_until, coalesce(b.owner_user_id, x.created_by) AS to
             FROM (SELECT DISTINCT ON (box_id) id, box_id, valid_until, created_by FROM advice_records WHERE kind = 'needs_analysis' AND status = 'signed' ORDER BY box_id, signed_at DESC) x
             JOIN boxes b ON b.id = x.box_id JOIN stages s ON s.id = b.stage_id
            WHERE NOT s.is_lost AND x.valid_until BETWEEN current_date - 30 AND current_date + 30 ORDER BY x.valid_until LIMIT 300`)).rows;
        for (const d of due) if (d.to) out.push({ key: `na-due:${d.id}`, kind: 'needs_review_due', data: { boxId: d.box_id, name: d.name, validUntil: d.valid_until }, to: [d.to] });
        // A partner company created more than a week ago (but not long ago) that still has first-week steps open.
        const young = (await tx.query<{ id: string }>(
          `SELECT id FROM org_nodes WHERE type = 'partner' AND is_active AND created_at::date <= current_date - 7 AND created_at::date > current_date - 60 ORDER BY created_at LIMIT 100`)).rows;
        for (const p of young) {
          const w = await firstWeekFor(tx, ctx, p.id, countryOf(deps.config.region));
          if (!w.complete) out.push({ key: `firstweek:${p.id}`, kind: 'first_week_late', data: { nodeId: p.id, name: w.node.name, done: w.done, total: w.total, next: w.next } });
        }
        return out;
      });
      for (const it of items) {
        const fresh: string[] = [];
        await withRequestTx(deps.appPool, ctx, async (tx) => {
          for (const uid of it.to ?? people) {
            const r = await tx.query('INSERT INTO reminder_marks (tenant_id, user_id, key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.tenant_id, uid, it.key]);
            if (r.rowCount) fresh.push(uid);
          }
        });
        if (fresh.length) { await tell(deps, t.tenant_id, fresh, it.kind, null, it.data); made++; }
      }
    } catch (e) { if (process.env.ALERT_DEBUG) console.error('alerts', e); }
  }
  return made;
}
