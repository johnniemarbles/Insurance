// Partner (broker) onboarding. Two panels share these routes:
//  - the Compliance officer (per region, or a tenant admin) runs the flow: invite, record the checks, decide the standing, move the agreement;
//  - the partner completes its own steps (form, consents, carrier packets) and sees its own status, with the outcome only, never the checks.
// Visibility is enforced in the database (row-level security); the officer checks below use app_is_compliance_at_or_above.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  CANADA_THRESHOLDS, STANDING_LABELS, STANDING_OUTCOMES, carrierPacketBlocks, keepsAccessWhile, standingWarning, nextCheckDue, recheckStatus, stageMoveBlock,
  suggestedStanding, type OnboardingStage, type RequestContext, type StandingOutcome,
} from '@pii/domain';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

export const ONBOARDING_WORDING_VERSION = 'onboarding-draft-1';
const CONSENT_KINDS = ['credit_check', 'background_check', 'carrier_reporting'] as const;
const REQUIRED_CONSENTS = ['credit_check', 'background_check'] as const;
const CHECK_KINDS = ['licence', 'credit', 'background'] as const;
const CHECK_STATUSES = ['requested', 'complete', 'failed'] as const;
/** Stages the Compliance officer moves by hand. checks_* move with the checks, standing_decided with the decision, the agreement stages with sending and signing (routes-onboarding-sign.ts). */
const OFFICER_STAGES = ['active'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CaseRow {
  id: string; nodeId: string; tenantId: string; country: string; stage: OnboardingStage;
  standing: StandingOutcome | null; lastCheckedAt: Date | null; partnerName: string;
}

const body = (req: FastifyRequest): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;
const str = (v: unknown, label: string, max = 200): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw invalid(`${label} is required (up to ${max} characters)`);
  return v.trim();
};
function caseId(raw: string): string {
  if (!UUID.test(raw)) throw notFound('Unknown onboarding case');
  return raw;
}

async function loadCase(tx: Tx, id: string): Promise<CaseRow> {
  const r = (await tx.query<CaseRow>(
    `SELECT c.id, c.node_id AS "nodeId", c.tenant_id AS "tenantId", c.country, c.stage, c.standing,
            c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName"
       FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id WHERE c.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Unknown onboarding case');
  return r;
}

/** The Compliance officer for this partner's region, or a tenant admin. */
async function isOfficer(tx: Tx, tenantId: string, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>('SELECT app_is_compliance_at_or_above($1, $2) AS ok', [tenantId, nodeId])).rows[0]?.ok === true;
}
async function requireOfficer(tx: Tx, c: CaseRow): Promise<void> {
  if (!(await isOfficer(tx, c.tenantId, c.nodeId))) throw forbidden('Only the Compliance officer for this region can do this');
}

/** The signed-in person is a member of the partner itself (not an officer looking in). */
async function requirePartnerUser(tx: Tx, c: CaseRow): Promise<void> {
  const ok = (await tx.query<{ ok: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok', [c.nodeId])).rows[0]?.ok === true;
  if (!ok) throw forbidden('Only people at this partner can do this step');
}

/** Latest completed credit and background results, as the standing rules read them. */
async function outcomesOf(tx: Tx, caseId: string) {
  const rows = (await tx.query<{ kind: string; score: number | null; adverse: boolean | null; status: string }>(
    `SELECT DISTINCT ON (kind) kind, score, adverse, status FROM onboarding_checks
      WHERE case_id = $1 AND kind IN ('credit', 'background') ORDER BY kind, requested_at DESC`, [caseId])).rows;
  const credit = rows.find((r) => r.kind === 'credit');
  const background = rows.find((r) => r.kind === 'background');
  return {
    creditScore: credit?.status === 'complete' ? credit.score : null,
    backgroundAdverse: background?.status === 'complete' ? background.adverse : null,
  };
}

const outcomeView = (standing: StandingOutcome | null) => (standing
  ? { outcome: standing, label: STANDING_LABELS[standing].en, keepsAccess: keepsAccessWhile(standing), warning: standingWarning(standing) }
  : { outcome: null, label: 'Being checked', keepsAccess: true, warning: false });

function recheckView(lastCheckedAt: Date | null) {
  if (!lastCheckedAt) return null;
  const due = nextCheckDue(lastCheckedAt);
  return { lastCheckedAt: lastCheckedAt.toISOString(), dueOn: due.toISOString().slice(0, 10), status: recheckStatus(lastCheckedAt, new Date()) };
}

/** The partner's view of one onboarding case, as the partner may see it. Never checks, scores or reasons. */
async function partnerView(tx: Tx, where: string, params: unknown[]) {
  const c = (await tx.query<CaseRow>(
    `SELECT c.id, c.node_id AS "nodeId", c.tenant_id AS "tenantId", c.country, c.stage, c.standing,
            c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName"
       FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id WHERE ${where} LIMIT 1`, params)).rows[0];
  if (!c) return null;
  const consents = (await tx.query<{ kind: string }>(
    `SELECT DISTINCT kind FROM onboarding_consents WHERE case_id = $1 AND accepted`, [c.id])).rows.map((r) => r.kind);
  const packets = (await tx.query(
    `SELECT id, carrier, status, effective_date AS "effectiveDate" FROM carrier_packets WHERE node_id = $1 ORDER BY created_at DESC`, [c.nodeId])).rows;
  return {
    id: c.id, partnerName: c.partnerName, country: c.country, stage: c.stage, ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
    consentsGiven: consents, carrierPackets: packets,
  };
}

export function registerOnboardingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  // ---- Compliance officer ------------------------------------------------------------------------------------------

  /** Invite a partner into onboarding. Creates the case at the invited stage. */
  app.post('/v1/onboarding/cases', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = body(req);
    const nodeId = caseId(str(b.nodeId, 'nodeId', 60));
    const country = b.country === 'US' ? 'US' : 'CA';
    const out = await run(ctx, async (tx) => {
      const n = (await tx.query<{ tenantId: string; type: string; name: string }>(
        'SELECT tenant_id AS "tenantId", type, name FROM org_nodes WHERE id = $1', [nodeId])).rows[0];
      if (!n || n.type !== 'partner') throw notFound('Unknown partner');
      if (!(await isOfficer(tx, n.tenantId, nodeId))) throw forbidden('Only the Compliance officer for this region can invite a partner');
      const dup = (await tx.query('SELECT 1 FROM onboarding_cases WHERE node_id = $1', [nodeId])).rowCount;
      if (dup) throw conflict('This partner is already in onboarding');
      const id = (await tx.query<{ id: string }>(
        `INSERT INTO onboarding_cases (tenant_id, node_id, country) VALUES ($1, $2, $3) RETURNING id`, [n.tenantId, nodeId, country])).rows[0]!.id;
      await audit(tx, ctx, 'onboarding.invited', 'onboarding_case', id, { partner: n.name, country });
      return { id, stage: 'invited' as const };
    });
    reply.code(201);
    return out;
  });

  /** The cases this officer can see (their region, or all for a tenant admin). */
  app.get('/v1/onboarding/cases', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<CaseRow>(
        `SELECT c.id, c.node_id AS "nodeId", c.tenant_id AS "tenantId", c.country, c.stage, c.standing,
                c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName"
           FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id
          WHERE app_is_compliance_at_or_above(c.tenant_id, c.node_id)
          ORDER BY c.created_at DESC`)).rows;
      return {
        cases: rows.map((c) => ({
          id: c.id, nodeId: c.nodeId, partnerName: c.partnerName, country: c.country, stage: c.stage,
          ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
        })),
      };
    });
  });

  /** Full file for the officer: consents, every check (scores included), decisions, packets, and the rule's suggestion. */
  app.get('/v1/onboarding/cases/:id', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const consents = (await tx.query(
        `SELECT kind, wording_version AS "wordingVersion", accepted, created_at AS "createdAt" FROM onboarding_consents WHERE case_id = $1 ORDER BY created_at`, [id])).rows;
      const checks = (await tx.query(
        `SELECT id, kind, provider, reference, status, score, adverse, requested_at AS "requestedAt", completed_at AS "completedAt"
           FROM onboarding_checks WHERE case_id = $1 ORDER BY requested_at DESC`, [id])).rows;
      const decisions = (await tx.query(
        `SELECT suggested, outcome, reason, decided_at AS "decidedAt" FROM onboarding_decisions WHERE case_id = $1 ORDER BY decided_at DESC`, [id])).rows;
      const packets = (await tx.query(
        `SELECT id, carrier, template_version AS "templateVersion", status, effective_date AS "effectiveDate", created_at AS "createdAt"
           FROM carrier_packets WHERE node_id = $1 ORDER BY created_at DESC`, [c.nodeId])).rows;
      await audit(tx, ctx, 'onboarding.viewed', 'onboarding_case', id, {});
      return {
        id, partnerName: c.partnerName, country: c.country, stage: c.stage, ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
        suggested: suggestedStanding(await outcomesOf(tx, id)), thresholds: CANADA_THRESHOLDS,
        consents, checks, decisions, carrierPackets: packets,
      };
    });
  });

  /** Record a check result (Equifax credit, Sterling background, or a licence check). Moves the case to checks_requested / checks_complete. */
  app.post('/v1/onboarding/cases/:id/checks', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    if (!CHECK_KINDS.includes(b.kind as never)) throw invalid('kind must be licence, credit or background');
    if (!CHECK_STATUSES.includes(b.status as never)) throw invalid('status must be requested, complete or failed');
    const kind = b.kind as (typeof CHECK_KINDS)[number];
    const status = b.status as (typeof CHECK_STATUSES)[number];
    const provider = str(b.provider, 'provider', 80);
    const reference = typeof b.reference === 'string' ? b.reference.slice(0, 120) : null;
    let score: number | null = null;
    if (kind === 'credit' && status === 'complete') {
      if (!Number.isInteger(b.score) || (b.score as number) < 300 || (b.score as number) > 900) throw invalid('A completed credit check needs its score (300 to 900)');
      score = b.score as number;
    }
    let adverse: boolean | null = null;
    if (kind === 'background' && status === 'complete') {
      if (typeof b.adverse !== 'boolean') throw invalid('A completed background check needs adverse: true or false');
      adverse = b.adverse;
    }
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      if (!['consents_recorded', 'checks_requested', 'checks_complete'].includes(c.stage)) {
        throw conflict('Checks can be recorded only after the partner has given consent');
      }
      await tx.query(
        `INSERT INTO onboarding_checks (tenant_id, case_id, node_id, kind, provider, reference, status, score, adverse, completed_at, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $7 = 'requested' THEN NULL ELSE now() END, $10)`,
        [c.tenantId, id, c.nodeId, kind, provider, reference, status, score, adverse, ctx.userId]);
      // Stage follows the checks: the first check moves the file to checks_requested; both credit and background complete move it to checks_complete.
      let stage = c.stage;
      if (stage === 'consents_recorded') stage = 'checks_requested';
      const o = await outcomesOf(tx, id);
      if (o.creditScore !== null && o.backgroundAdverse !== null && stage === 'checks_requested') stage = 'checks_complete';
      if (status === 'complete' && kind !== 'licence') {
        await tx.query('UPDATE onboarding_cases SET last_checked_at = now() WHERE id = $1', [id]);
      }
      if (stage !== c.stage) await tx.query('UPDATE onboarding_cases SET stage = $2, updated_at = now() WHERE id = $1', [id, stage]);
      await audit(tx, ctx, 'onboarding.check_recorded', 'onboarding_case', id, { kind, provider, status });
      return { stage, suggested: suggestedStanding(o) };
    });
    reply.code(201);
    return out;
  });

  /** The officer's decision. Records the outcome, the reason and the rule's suggestion. A check that is still running blocks the decision. */
  app.post('/v1/onboarding/cases/:id/decision', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    if (!STANDING_OUTCOMES.includes(b.outcome as never)) throw invalid('outcome must be good_standing, needs_review or not_in_good_standing');
    const outcome = b.outcome as StandingOutcome;
    const reason = str(b.reason, 'reason', 1000);
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      if (c.stage !== 'checks_complete') throw conflict('The decision waits until both checks are complete');
      const suggested = suggestedStanding(await outcomesOf(tx, id));
      if (suggested === 'pending') throw conflict('A check result is still missing');
      await tx.query(
        `INSERT INTO onboarding_decisions (tenant_id, case_id, node_id, suggested, outcome, reason, thresholds, decided_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.tenantId, id, c.nodeId, suggested, outcome, reason, JSON.stringify(CANADA_THRESHOLDS), ctx.userId]);
      await tx.query(`UPDATE onboarding_cases SET standing = $2, stage = 'standing_decided', updated_at = now() WHERE id = $1`, [id, outcome]);
      await audit(tx, ctx, 'onboarding.decided', 'onboarding_case', id, { outcome, suggested });
      return { stage: 'standing_decided' as const, ...outcomeView(outcome) };
    });
  });

  /** Officer moves the agency agreement forward: sent, signed, active. Standing must be good before the agreement is sent (see stageMoveBlock). */
  app.post('/v1/onboarding/cases/:id/stage', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const to = body(req).to as OnboardingStage;
    if (!OFFICER_STAGES.includes(to as never)) throw invalid('Only activation is set by hand; the agreement stages move when the agreement is sent and signed');
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const block = stageMoveBlock(c.stage, to, c.standing ?? 'pending');
      if (block) throw conflict(block === 'standing_not_good' ? 'The agency agreement waits for a good-standing decision' : 'Stages move one step at a time');
      await tx.query('UPDATE onboarding_cases SET stage = $2, updated_at = now() WHERE id = $1', [id, to]);
      await audit(tx, ctx, 'onboarding.stage', 'onboarding_case', id, { to });
      return { stage: to };
    });
  });

  // ---- Partner -----------------------------------------------------------------------------------------------------

  /** Partner's own step: the compliance profile is submitted, so the form is done. */
  app.post('/v1/onboarding/cases/:id/form', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requirePartnerUser(tx, c);
      if (c.stage !== 'invited') throw conflict('The form is already submitted');
      const submitted = (await tx.query<{ ok: boolean }>(
        'SELECT coalesce(bool_or(submitted_at IS NOT NULL), false) AS ok FROM compliance_profiles WHERE node_id = $1', [c.nodeId])).rows[0]?.ok === true;
      if (!submitted) throw conflict('Submit the partner profile first');
      await tx.query(`UPDATE onboarding_cases SET stage = 'form_submitted', updated_at = now() WHERE id = $1`, [id]);
      await audit(tx, ctx, 'onboarding.form_submitted', 'onboarding_case', id, {});
      return { stage: 'form_submitted' as const };
    });
    reply.code(201);
    return out;
  });

  /** Partner gives consent to the credit check, the background check and carrier reporting. Credit and background are required. */
  app.post('/v1/onboarding/cases/:id/consents', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const list = Array.isArray(body(req).consents) ? (body(req).consents as { kind: unknown; accepted: unknown }[]) : null;
    if (!list) throw invalid('consents is required');
    for (const x of list) if (!CONSENT_KINDS.includes(x.kind as never) || typeof x.accepted !== 'boolean') throw invalid('Each consent needs a kind and accepted true or false');
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requirePartnerUser(tx, c);
      if (!['form_submitted', 'consents_recorded'].includes(c.stage)) throw conflict('Consent comes after the form');
      for (const need of REQUIRED_CONSENTS) {
        if (!list.some((x) => x.kind === need && x.accepted === true)) throw invalid(`${need.replace('_', ' ')} consent is required`);
      }
      for (const x of list) {
        await tx.query(
          `INSERT INTO onboarding_consents (tenant_id, case_id, node_id, kind, wording_version, accepted, ip_addr) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [c.tenantId, id, c.nodeId, x.kind, ONBOARDING_WORDING_VERSION, x.accepted, req.ip ?? null]);
      }
      if (c.stage === 'form_submitted') await tx.query(`UPDATE onboarding_cases SET stage = 'consents_recorded', updated_at = now() WHERE id = $1`, [id]);
      await audit(tx, ctx, 'onboarding.consents_recorded', 'onboarding_case', id, { kinds: list.map((x) => x.kind) });
      return { stage: 'consents_recorded' as const };
    });
    reply.code(201);
    return out;
  });

  /** Partner's carrier packet (stage 2). Gated by carrierPacketBlocks: agreement signed, active, good standing, check current. */
  app.post('/v1/onboarding/cases/:id/carrier-packets', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    const carrier = str(b.carrier, 'carrier', 120);
    const templateVersion = str(b.templateVersion, 'templateVersion', 60);
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requirePartnerUser(tx, c);
      const blocks = carrierPacketBlocks({
        agencyAgreementSigned: ['agency_agreement_signed', 'active'].includes(c.stage), stage: c.stage, standing: c.standing ?? 'pending',
        lastChecked: c.lastCheckedAt, now: new Date(),
      });
      if (blocks.length) throw conflict(`Carrier packet not yet allowed: ${blocks.join(', ')}`);
      const packetId = (await tx.query<{ id: string }>(
        `INSERT INTO carrier_packets (tenant_id, node_id, carrier, template_version) VALUES ($1,$2,$3,$4) RETURNING id`,
        [c.tenantId, c.nodeId, carrier, templateVersion])).rows[0]!.id;
      await audit(tx, ctx, 'onboarding.carrier_packet_created', 'carrier_packet', packetId, { carrier });
      return { id: packetId, status: 'draft' as const };
    });
    reply.code(201);
    return out;
  });

  /** The partner's view of its own onboarding: stage, the outcome label, the recheck date and its packets. Never the checks, scores or reasons. */
  app.get('/v1/onboarding/partners/:nodeId', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const nodeId = caseId((req.params as { nodeId: string }).nodeId);
    return run(ctx, async (tx) => {
      const v = await partnerView(tx, `c.node_id = $1`, [nodeId]);
      if (!v) throw notFound('No onboarding for this partner');
      return v;
    });
  });

  /** Who the signed-in person is for onboarding: an officer (Compliance role or tenant admin), and/or a partner with a case. The screen picks its view from this. */
  app.get('/v1/onboarding/mine', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const officer = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_tenant_admin() OR EXISTS (SELECT 1 FROM user_node_roles WHERE user_id = app_user_id() AND role::text = 'compliance') AS ok`)).rows[0]?.ok === true;
      const onboarding = await partnerView(tx, `c.node_id IN (SELECT node_id FROM user_node_roles WHERE user_id = app_user_id())`, []);
      return { officer, onboarding };
    });
  });
}
