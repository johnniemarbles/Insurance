// Compliance dashboard alerts (plan v6, section 9). One call, numbers plus the short lists behind them. Every row is read through
// the viewer's own visibility (row-level security), so a branch's Compliance Manager sees its branch, a broker sees its own file,
// and anyone else sees nothing. Due days are business days in Toronto, as set when the report is recorded.
import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { RECHECK_MONTHS, isSelfReportOverdue } from '@pii/domain';
import type { AppDeps } from './app.ts';

/** How far ahead an expiry counts as "soon". */
export const EXPIRY_WARNING_DAYS = 30;
const LIST_LIMIT = 50;

interface ReportRow { id: string; kind: string; dueOn: string; partnerName: string }
interface ExpiryRow { id: string; kind: 'licence' | 'eo'; label: string; expiresOn: string; status: 'expired' | 'expiring'; partnerName: string }

export function registerOnboardingDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/onboarding/dashboard', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const reports = (await tx.query<ReportRow>(
        `SELECT r.id, r.kind, r.due_on::text AS "dueOn", n.name AS "partnerName"
           FROM broker_self_reports r JOIN org_nodes n ON n.id = r.node_id
          WHERE r.acknowledged_at IS NULL
          ORDER BY r.due_on, r.recorded_at LIMIT $1`, [LIST_LIMIT * 4])).rows;
      const now = new Date();
      const openReports = reports.map((r) => ({ ...r, overdue: isSelfReportOverdue(r.dueOn, now) }));

      const expiries = (await tx.query<ExpiryRow>(
        `SELECT i.id, i.kind, i.label, i.expires_on::text AS "expiresOn", n.name AS "partnerName",
                CASE WHEN i.expires_on < current_date THEN 'expired' ELSE 'expiring' END AS status
           FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id
          WHERE i.expires_on IS NOT NULL AND i.expires_on <= current_date + make_interval(days => $1)
          ORDER BY i.expires_on, n.name LIMIT $2`, [EXPIRY_WARNING_DAYS, LIST_LIMIT * 4])).rows;

      const frozen = (await tx.query<{ n: number }>(
        `SELECT count(DISTINCT node_id)::int AS n FROM compliance_items WHERE expires_on < current_date`)).rows[0]!.n;

      const rechecks = (await tx.query<{ overdue: number; dueSoon: number }>(
        `SELECT count(*) FILTER (WHERE last_checked_at + make_interval(months => $1) < now())::int AS overdue,
                count(*) FILTER (WHERE last_checked_at + make_interval(months => $1) >= now()
                                   AND last_checked_at + make_interval(months => $1) < now() + make_interval(days => $2))::int AS "dueSoon"
           FROM onboarding_cases WHERE stage = 'active' AND last_checked_at IS NOT NULL`, [RECHECK_MONTHS, EXPIRY_WARNING_DAYS])).rows[0]!;

      return {
        selfReports: { open: openReports.length, overdue: openReports.filter((r) => r.overdue).length },
        expiry: {
          expired: expiries.filter((e) => e.status === 'expired').length,
          expiringSoon: expiries.filter((e) => e.status === 'expiring').length,
        },
        frozen,
        rechecks,
        overdueReports: openReports.filter((r) => r.overdue).slice(0, LIST_LIMIT).map(({ id, kind, dueOn, partnerName }) => ({ id, kind, dueOn, partnerName })),
        expiries: expiries.slice(0, LIST_LIMIT),
      };
    });
  });
}
