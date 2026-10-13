// The 6-month check for each partner in onboarding. Tells the Compliance officers for the partner's region (and the company's
// administrators) when a check falls due within 30 days or is overdue. Once per due date, so a daily sweep never repeats itself.
import { withRequestTx, type Tx } from '@pii/db';
import { actingAs } from './effects.ts';
import { tell } from './routes-compliance.ts';
import type { AppDeps } from './app.ts';

interface Due { case_id: string; tenant_id: string; node_id: string; partner: string; due_on: string; overdue: boolean }

export async function sweepOnboardingRechecks(deps: AppDeps): Promise<number> {
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const admin = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      const due = await withRequestTx(deps.appPool, admin, async (tx) => (await tx.query<Due>(
        `SELECT c.id AS case_id, c.tenant_id, c.node_id, n.name AS partner,
                (c.last_checked_at + interval '6 months')::date::text AS due_on,
                (c.last_checked_at + interval '6 months') <= now() AS overdue
           FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id AND n.is_active
          WHERE c.last_checked_at IS NOT NULL AND c.last_checked_at + interval '6 months' <= now() + interval '30 days'
            AND (c.recheck_notified_for IS NULL OR c.recheck_notified_for <> (c.last_checked_at + interval '6 months')::date)
          LIMIT 2000`)).rows);
      for (const r of due) {
        const people = await withRequestTx(deps.appPool, admin, (tx) => officersFor(tx, r.tenant_id, r.node_id));
        if (people.length === 0) continue;
        await tell(deps, r.tenant_id, people, 'onboarding_recheck', null, { caseId: r.case_id, partner: r.partner, dueOn: r.due_on, overdue: r.overdue });
        await withRequestTx(deps.appPool, admin, (tx) => tx.query('UPDATE onboarding_cases SET recheck_notified_for = $2::date WHERE id = $1', [r.case_id, r.due_on]));
        made++;
      }
    } catch { /* next company */ }
  }
  return made;
}

/** The Compliance officers whose node sits at or above the partner, and the company's administrators. */
async function officersFor(tx: Tx, tenantId: string, nodeId: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM app_users u JOIN user_node_roles r ON r.user_id = u.id
      WHERE u.tenant_id = $1 AND u.status::text <> 'disabled' AND (
        (r.role::text = 'compliance' AND EXISTS (SELECT 1 FROM org_reach o WHERE o.tenant_id = $1 AND o.descendant_id = $2 AND o.ancestor_id = r.node_id))
        OR (r.role::text = 'admin' AND r.node_id IN (SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant')))`,
    [tenantId, nodeId]);
  return rows.rows.map((x) => x.id);
}
