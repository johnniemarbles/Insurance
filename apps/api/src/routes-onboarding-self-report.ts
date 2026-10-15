// Broker self-report (plan v6, section 7). The broker records one of five events in its portal. The clock starts then: the report
// goes to the Compliance Manager's queue with its due day. Only the Compliance Manager of the branch acknowledges it.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { SELF_REPORT_KINDS, isSelfReportOverdue, reportDueOn, type RequestContext, type SelfReportKind } from '@pii/domain';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = (req: FastifyRequest): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;

interface CaseRow { id: string; tenantId: string; nodeId: string }

async function loadCase(tx: Tx, id: string): Promise<CaseRow> {
  if (!UUID.test(id)) throw notFound('Unknown onboarding case');
  const r = (await tx.query<CaseRow>(
    'SELECT id, tenant_id AS "tenantId", node_id AS "nodeId" FROM onboarding_cases WHERE id = $1', [id])).rows[0];
  if (!r) throw notFound('Unknown onboarding case');
  return r;
}

/** Anyone at the broker records a report about it (the same rule as the other partner steps). */
async function requirePartnerUser(tx: Tx, c: CaseRow): Promise<void> {
  const ok = (await tx.query<{ ok: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok', [c.nodeId])).rows[0]?.ok === true;
  if (!ok) throw forbidden('Only people at this partner can do this step');
}

/** A Compliance Manager role held at this node or above. A company administrator does not count (plan v7, decision 5). */
async function holdsComplianceAbove(tx: Tx, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
                     WHERE r.user_id = app_user_id() AND r.role::text = 'compliance' AND o.descendant_id = $1) AS ok`, [nodeId])).rows[0]?.ok === true;
}

export function registerOnboardingSelfReportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  /** The broker records one of the five events. The clock starts now. */
  app.post('/v1/onboarding/cases/:id/self-reports', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    const kind = body(req).kind;
    if (typeof kind !== 'string' || !(SELF_REPORT_KINDS as readonly string[]).includes(kind)) throw invalid('Choose one of the five events');
    const description = typeof body(req).description === 'string' ? (body(req).description as string).trim() : '';
    if (description.length < 10 || description.length > 1000) throw invalid('Describe the event in 10 to 1000 characters');
    const now = new Date();
    const dueOn = reportDueOn(now);
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requirePartnerUser(tx, c);
      const r = (await tx.query<{ id: string }>(
        `INSERT INTO broker_self_reports (tenant_id, case_id, node_id, kind, description, recorded_by, recorded_at, due_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [c.tenantId, c.id, c.nodeId, kind as SelfReportKind, description, ctx.userId, now, dueOn])).rows[0]!;
      await audit(tx, ctx, 'onboarding.self_report_recorded', 'onboarding_case', c.id, { kind, dueOn }, c.nodeId);
      return r;
    });
    reply.code(201);
    return { id: out.id, kind, recordedAt: now.toISOString(), dueOn };
  });

  /** The reports this person may see: the branch's Compliance Manager (the queue), or the broker's own people. */
  app.get('/v1/onboarding/self-reports', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ id: string; caseId: string; partnerName: string; kind: string; description: string; recordedAt: Date; dueOn: string; acknowledgedAt: Date | null }>(
        `SELECT r.id, r.case_id AS "caseId", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName", r.kind::text AS kind,
                r.description, r.recorded_at AS "recordedAt", r.due_on::text AS "dueOn", r.acknowledged_at AS "acknowledgedAt"
           FROM broker_self_reports r JOIN org_nodes n ON n.id = r.node_id LEFT JOIN compliance_profiles p ON p.node_id = r.node_id
          ORDER BY r.recorded_at DESC`)).rows;
      const now = new Date();
      return {
        reports: rows.map((r) => ({
          ...r,
          // Overdue: not acknowledged once the due day has ended in Toronto.
          overdue: r.acknowledgedAt == null && isSelfReportOverdue(r.dueOn, now),
        })),
      };
    });
  });

  /** The branch's Compliance Manager acknowledges a report. Kept once; a second acknowledgement is refused. */
  app.post('/v1/onboarding/self-reports/:rid/acknowledge', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const rid = (req.params as { rid: string }).rid;
    if (!UUID.test(rid)) throw notFound('Unknown self-report');
    await run(ctx, async (tx) => {
      const rep = (await tx.query<{ nodeId: string; acknowledgedAt: Date | null }>(
        'SELECT node_id AS "nodeId", acknowledged_at AS "acknowledgedAt" FROM broker_self_reports WHERE id = $1', [rid])).rows[0];
      if (!rep) throw notFound('Unknown self-report');
      if (!(await holdsComplianceAbove(tx, rep.nodeId))) throw forbidden('Only the Compliance Manager for this branch can acknowledge a self-report');
      if (rep.acknowledgedAt) throw conflict('This self-report is already acknowledged');
      await tx.query('UPDATE broker_self_reports SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1', [rid, ctx.userId]);
      await audit(tx, ctx, 'onboarding.self_report_acknowledged', 'broker_self_report', rid, {}, rep.nodeId);
    });
    return reply.code(204).send();
  });
}
