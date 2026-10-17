import { randomUUID } from 'node:crypto';
// Partner (broker) onboarding. Two panels share these routes:
//  - the Compliance officer (per region, or a tenant admin) runs the flow: invite, record the checks, decide the standing, move the agreement;
//  - the partner completes its own steps (form, consents, carrier packets) and sees its own status, with the outcome only, never the checks.
// Visibility is enforced in the database (row-level security); the officer checks below use app_is_compliance_at_or_above.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  computeChecklist, CANADA_THRESHOLDS, STANDING_LABELS, STANDING_OUTCOMES, carrierPacketBlocks, coverageFrozen, keepsAccessWhile, standingWarning, nextCheckDue, recheckStatus, stageMoveBlock,
  progressSteps, suggestedStanding, REQUIREMENT_COLUMN, REQUIREMENT_DEFAULTS, REQUIREMENT_KEYS, type RequirementKey,
  BROKER_TYPES, canAddBroker, ownershipProblems, type BrokerType, type OwnershipProblem,
  type OnboardingStage, type RequestContext, type StandingOutcome,
} from '@pii/domain';
import { audit } from './audit.ts';
import { AGA_BODY, AGA_TITLE, AGA_VERSION } from './aga-agreement.ts';
import { escapeHtml } from './merge-render.ts';
import { createPartnerInvitation, sendPartnerInvitation } from './partner-invite.ts';
import { managesBranchAbove } from './routes-people.ts';
import { eoMinFor } from './routes-compliance.ts';
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
  loginCreatedAt?: Date | null; extensionInstalledAt?: Date | null;
  inviteEmail?: string | null; inviteAccepted?: Date | null; inviteOpened?: Date | null; inviteSent?: Date | null; inviteReminders?: number; inviteError?: string | null;
  /** The caller is the Compliance officer for this partner (full file), not only a Branch manager (progress). */
  full?: boolean;
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
            c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName",
            c.login_created_at AS "loginCreatedAt", c.extension_installed_at AS "extensionInstalledAt"
       FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id WHERE c.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Unknown onboarding case');
  return r;
}

/** The Compliance officer for this partner's region, or a tenant admin. */
async function isOfficer(tx: Tx, tenantId: string, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>('SELECT app_is_compliance_at_or_above($1, $2) AS ok', [tenantId, nodeId])).rows[0]?.ok === true;
}
/**
 * A Compliance Manager role held at this node or above. Unlike isOfficer, a company administrator does not count:
 * starting a broker and adding one are the Compliance Manager's alone (plan v7, decisions 1, 5 and 6).
 */
async function holdsComplianceAbove(tx: Tx, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
                     WHERE r.user_id = app_user_id() AND r.role::text = 'compliance' AND o.descendant_id = $1) AS ok`, [nodeId])).rows[0]?.ok === true;
}
async function requireOfficer(tx: Tx, c: CaseRow): Promise<void> {
  if (!(await isOfficer(tx, c.tenantId, c.nodeId))) throw forbidden('Only the Compliance officer for this region can do this');
}

/** A Branch manager at or above the partner's node. It may start the partner's onboarding and sees its progress only. */
const BRANCH_MANAGER_SQL = `EXISTS (SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
                                    WHERE r.user_id = app_user_id() AND r.role::text = 'manager' AND o.descendant_id = %NODE%)`;
async function isBranchManagerAbove(tx: Tx, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>(`SELECT ${BRANCH_MANAGER_SQL.replace('%NODE%', '$1')} AS ok`, [nodeId])).rows[0]?.ok === true;
}

/** The signed-in person is a member of the partner itself (not an officer looking in). */
async function requirePartnerUser(tx: Tx, c: CaseRow): Promise<void> {
  const ok = (await tx.query<{ ok: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok', [c.nodeId])).rows[0]?.ok === true;
  if (!ok) throw forbidden('Only people at this partner can do this step');
}

/** Latest completed credit and background results, and the latest screening answers, as the standing rules read them. */
async function outcomesOf(tx: Tx, caseId: string) {
  const rows = (await tx.query<{ kind: string; score: number | null; adverse: boolean | null; status: string }>(
    `SELECT DISTINCT ON (kind) kind, score, adverse, status FROM onboarding_checks
      WHERE case_id = $1 AND kind IN ('credit', 'background') ORDER BY kind, requested_at DESC`, [caseId])).rows;
  const credit = rows.find((r) => r.kind === 'credit');
  const background = rows.find((r) => r.kind === 'background');
  // No screening recorded yet: the flags stay undefined and do not change the suggestion.
  const screening = (await tx.query<{ insolvencyOrJudgment: boolean; redFlag: boolean }>(
    `SELECT insolvency_or_judgment AS "insolvencyOrJudgment", red_flag AS "redFlag" FROM onboarding_screenings
      WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1`, [caseId])).rows[0];
  return {
    creditScore: credit?.status === 'complete' ? credit.score : null,
    backgroundAdverse: background?.status === 'complete' ? background.adverse : null,
    insolvencyOrJudgment: screening?.insolvencyOrJudgment,
    redFlag: screening?.redFlag,
  };
}

const outcomeView = (standing: StandingOutcome | null) => (standing
  ? { outcome: standing, label: STANDING_LABELS[standing].en, keepsAccess: keepsAccessWhile(standing), warning: standingWarning(standing) }
  : { outcome: null, label: 'Being checked', keepsAccess: true, warning: false });

/** The latest invitation for a case, in words the officer can act on. */
function inviteView(c: CaseRow) {
  if (!c.inviteEmail) return null;
  const status = c.inviteAccepted ? 'accepted' : c.inviteOpened ? 'opened'
    : c.inviteSent ? ((c.inviteReminders ?? 0) >= 3 ? 'overdue' : 'sent') : c.inviteError ? 'not_sent' : 'created';
  return { email: c.inviteEmail, status, reminders: c.inviteReminders ?? 0, error: c.inviteError ?? null };
}

function recheckView(lastCheckedAt: Date | null) {
  if (!lastCheckedAt) return null;
  const due = nextCheckDue(lastCheckedAt);
  return { lastCheckedAt: lastCheckedAt.toISOString(), dueOn: due.toISOString().slice(0, 10), status: recheckStatus(lastCheckedAt, new Date()) };
}

/** A Branch manager's view of a case: the partner's name and each step's status. Nothing about checks, scores, the standing or consents. */
function progressView(c: { id: string; partnerName: string; stage: OnboardingStage }) {
  return { id: c.id, partnerName: c.partnerName, steps: progressSteps(c.stage) };
}

/** The partner's view of one onboarding case, as the partner may see it. Never checks, scores or reasons. */
async function partnerView(tx: Tx, where: string, params: unknown[]) {
  const c = (await tx.query<CaseRow>(
    `SELECT c.id, c.node_id AS "nodeId", c.tenant_id AS "tenantId", c.country, c.stage, c.standing,
            c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName",
            c.login_created_at AS "loginCreatedAt", c.extension_installed_at AS "extensionInstalledAt"
       FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id WHERE ${where} LIMIT 1`, params)).rows[0];
  if (!c) return null;
  const consents = (await tx.query<{ kind: string }>(
    `SELECT DISTINCT kind FROM onboarding_consents WHERE case_id = $1 AND accepted`, [c.id])).rows.map((r) => r.kind);
  const packets = (await tx.query(
    `SELECT id, carrier, status, effective_date AS "effectiveDate" FROM carrier_packets WHERE node_id = $1 ORDER BY created_at DESC`, [c.nodeId])).rows;
  return {
    id: c.id, partnerName: c.partnerName, country: c.country, stage: c.stage, ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
    consentsGiven: consents, carrierPackets: packets,
    loginCreated: c.loginCreatedAt !== null, extensionInstalled: c.extensionInstalledAt !== null,
  };
}

/** The broker type, owners and recorded steps for a case, with what the ownership rule says is still missing. Officer view only. */
async function ownershipOf(tx: Tx, caseId: string) {
  const c = (await tx.query<{ brokerType: BrokerType | null; ownershipSteps: string | null }>(
    `SELECT broker_type AS "brokerType", ownership_steps AS "ownershipSteps" FROM onboarding_cases WHERE id = $1`, [caseId])).rows[0];
  const owners = (await tx.query(
    `SELECT id, full_name AS "fullName", is_director AS "isDirector", share_percent::float8 AS "sharePercent", identified,
            pep_hio_determined AS "pepHioDetermined", guarantee_signed AS "guaranteeSigned"
       FROM onboarding_owners WHERE case_id = $1 ORDER BY share_percent DESC, created_at`, [caseId])).rows as Array<{
    id: string; fullName: string; isDirector: boolean; sharePercent: number; identified: boolean; pepHioDetermined: boolean; guaranteeSigned: boolean;
  }>;
  const type = c?.brokerType ?? null;
  const problems: OwnershipProblem[] = ownershipProblems(type, owners, Boolean(c?.ownershipSteps));
  return { type, owners, steps: c?.ownershipSteps ?? null, problems };
}

/** Owner details from the request: a name, director status, share, and the checks recorded for that person. */
function ownerInput(b: Record<string, unknown>) {
  const share = b.sharePercent;
  if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 100) throw invalid('sharePercent must be a number from 0 to 100');
  for (const k of ['isDirector', 'identified', 'pepHioDetermined', 'guaranteeSigned'] as const) {
    if (typeof b[k] !== 'boolean') throw invalid(`${k} must be yes or no (true or false)`);
  }
  return {
    fullName: str(b.fullName, 'fullName', 200), isDirector: b.isDirector as boolean, sharePercent: share,
    identified: b.identified as boolean, pepHioDetermined: b.pepHioDetermined as boolean, guaranteeSigned: b.guaranteeSigned as boolean,
  };
}

/** The company's onboarding requirements (defaults when none has been changed). */
async function requirementsOf(tx: Tx, tenantId: string): Promise<Record<RequirementKey, boolean>> {
  const row = (await tx.query<Record<string, boolean>>(
    `SELECT screening_before_decision, ownership_required, pending_approval, president_exceptions
       FROM onboarding_requirements WHERE tenant_id = $1`, [tenantId])).rows[0];
  const out = { ...REQUIREMENT_DEFAULTS };
  if (row) for (const k of REQUIREMENT_KEYS) out[k] = row[REQUIREMENT_COLUMN[k]] === true;
  return out;
}

/** Is the signed-in person a staff member assigned to this broker? */
async function isAssignedStaff(tx: Tx, caseId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM onboarding_staff WHERE case_id = $1 AND user_id = app_user_id()) AS ok', [caseId])).rows[0]?.ok === true;
}

/** The staff members assigned to this broker: name only. */
async function assignedStaff(tx: Tx, caseId: string): Promise<{ userId: string; name: string }[]> {
  return (await tx.query<{ userId: string; name: string }>(
    `SELECT s.user_id AS "userId", u.display_name AS name FROM onboarding_staff s JOIN app_users u ON u.id = s.user_id
      WHERE s.case_id = $1 ORDER BY u.display_name`, [caseId])).rows;
}

/**
 * The analytics a staff member sees for a broker it manages: stage progress, the recheck date, and whether each check is
 * complete or outstanding. Never a score, a provider, the screening answers, the standing, or a decision (plan v7, section 6).
 */
async function staffView(tx: Tx, c: CaseRow) {
  const checks = (await tx.query<{ kind: string; status: string }>(
    'SELECT kind, status FROM onboarding_check_status_for_staff($1)', [c.id])).rows;
  return {
    id: c.id, partnerName: c.partnerName, steps: progressSteps(c.stage), recheck: recheckView(c.lastCheckedAt),
    checks: checks.map((r) => ({ kind: r.kind, complete: r.status === 'complete' })),
  };
}

/** The staff of the broker's branch who are not yet assigned to it: names only (the same rule as the assign route). */
async function staffCandidates(tx: Tx, c: CaseRow): Promise<{ userId: string; name: string }[]> {
  return (await tx.query<{ userId: string; name: string }>(
    `SELECT DISTINCT r.user_id AS "userId", u.display_name AS name
       FROM user_node_roles r JOIN org_nodes a ON a.id = r.node_id AND a.type = 'location'
            JOIN org_reach o ON o.ancestor_id = r.node_id JOIN app_users u ON u.id = r.user_id
      WHERE r.role::text = 'staff' AND o.descendant_id = $1
        AND NOT EXISTS (SELECT 1 FROM onboarding_staff s WHERE s.case_id = $2 AND s.user_id = r.user_id)
      ORDER BY name`, [c.nodeId, c.id])).rows;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerOnboardingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  // ---- President and CEO exception (company administrator) ---------------------------------------------------------

  /**
   * The President and CEO approves a red-flag exception on this file, with a reason. Only the company administrator can do this.
   * The approval is kept on the file and cannot be changed afterwards.
   */
  app.post('/v1/onboarding/cases/:id/exception-approval', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const reason = str(body(req).reason, 'reason', 500);
    if (reason.length < 10) throw invalid('Give a reason of at least 10 characters: the approval is kept with it');
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      if (!(await tx.query<{ ok: boolean }>('SELECT app_is_tenant_admin() AS ok')).rows[0]?.ok) {
        throw forbidden('Only the President and CEO (the company administrator) can approve an exception');
      }
      const name = (await tx.query<{ name: string }>('SELECT display_name AS name FROM app_users WHERE id = $1', [ctx.userId])).rows[0]?.name ?? 'President and CEO';
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO onboarding_exceptions (tenant_id, case_id, node_id, reason, approved_by, approver_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c.tenantId, id, c.nodeId, reason, ctx.userId, name])).rows[0]!;
      await audit(tx, ctx, 'onboarding.exception_approved', 'onboarding_case', id, { exception: row.id });
      return { id: row.id };
    });
    reply.code(201);
    return out;
  });

  // ---- Broker type and ownership (Compliance officer) --------------------------------------------------------------

  /** Record whether the broker is an individual or a corporation. Officer only, until the case is Active. */
  app.post('/v1/onboarding/cases/:id/type', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const type = body(req).type;
    if (!BROKER_TYPES.includes(type as never)) throw invalid('type must be individual or corporate');
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      if (c.stage === 'active') throw conflict('The broker is already Active');
      await tx.query('UPDATE onboarding_cases SET broker_type = $2, updated_at = now() WHERE id = $1', [id, type]);
      await audit(tx, ctx, 'onboarding.type_recorded', 'onboarding_case', id, { type });
      return { type };
    });
  });

  /** Add a director or owner to a corporate broker's file. Officer only. */
  app.post('/v1/onboarding/cases/:id/owners', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const o = ownerInput(body(req));
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO onboarding_owners (tenant_id, case_id, node_id, full_name, is_director, share_percent, identified, pep_hio_determined, guarantee_signed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.tenantId, id, c.nodeId, o.fullName, o.isDirector, o.sharePercent, o.identified, o.pepHioDetermined, o.guaranteeSigned])).rows[0]!;
      await audit(tx, ctx, 'onboarding.owner_added', 'onboarding_case', id, { owner: row.id });
      return { id: row.id };
    });
    reply.code(201);
    return out;
  });

  /** Change a director or owner's details or checks. Officer only. */
  app.put('/v1/onboarding/cases/:id/owners/:ownerId', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id: rawId, ownerId } = req.params as { id: string; ownerId: string };
    const id = caseId(rawId);
    if (!UUID.test(ownerId)) throw notFound('Unknown owner');
    const o = ownerInput(body(req));
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const n = (await tx.query(
        `UPDATE onboarding_owners SET full_name = $3, is_director = $4, share_percent = $5, identified = $6, pep_hio_determined = $7,
                guarantee_signed = $8, updated_at = now() WHERE id = $1 AND case_id = $2`,
        [ownerId, id, o.fullName, o.isDirector, o.sharePercent, o.identified, o.pepHioDetermined, o.guaranteeSigned])).rowCount;
      if (!n) throw notFound('Unknown owner');
      await audit(tx, ctx, 'onboarding.owner_changed', 'onboarding_case', id, { owner: ownerId });
      return { ok: true };
    });
  });

  /** Remove a director or owner from the file. Officer only. */
  app.delete('/v1/onboarding/cases/:id/owners/:ownerId', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id: rawId, ownerId } = req.params as { id: string; ownerId: string };
    const id = caseId(rawId);
    if (!UUID.test(ownerId)) throw notFound('Unknown owner');
    await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const n = (await tx.query('DELETE FROM onboarding_owners WHERE id = $1 AND case_id = $2', [ownerId, id])).rowCount;
      if (!n) throw notFound('Unknown owner');
      await audit(tx, ctx, 'onboarding.owner_removed', 'onboarding_case', id, { owner: ownerId });
    });
    reply.code(204);
    return null;
  });

  /** The steps taken to reach a conclusion when nobody holds 25% or more. At least 10 characters. Officer only. */
  app.put('/v1/onboarding/cases/:id/ownership-steps', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const steps = str(body(req).steps, 'steps', 1000);
    if (steps.length < 10) throw invalid('Describe the steps taken, at least 10 characters');
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      await tx.query('UPDATE onboarding_cases SET ownership_steps = $2, updated_at = now() WHERE id = $1', [id, steps]);
      await audit(tx, ctx, 'onboarding.ownership_steps_recorded', 'onboarding_case', id, {});
      return { ok: true };
    });
  });

  // ---- Onboarding requirements (Compliance Manager switches) -------------------------------------------------------

  /** The company's requirements, who may change them, and the history of changes (newest first). Visible to everyone in the company. */
  app.get('/v1/onboarding/requirements', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const requirements = await requirementsOf(tx, ctx.tenantId);
      const canChange = (await tx.query<{ ok: boolean }>('SELECT app_is_compliance_role() AS ok')).rows[0]?.ok === true;
      const history = (await tx.query<{ requirement: string; from: boolean; to: boolean; reason: string; changedBy: string; at: Date }>(
        `SELECT c.requirement, c.from_value AS "from", c.to_value AS "to", c.reason, u.display_name AS "changedBy", c.created_at AS at
           FROM onboarding_requirement_changes c JOIN app_users u ON u.id = c.changed_by
          ORDER BY c.created_at DESC LIMIT 50`)).rows;
      const keyOf = (col: string) => REQUIREMENT_KEYS.find((k) => REQUIREMENT_COLUMN[k] === col) ?? col;
      return {
        requirements, canChange,
        history: history.map((h) => ({ requirement: keyOf(h.requirement), from: h.from, to: h.to, reason: h.reason, changedBy: h.changedBy, at: h.at.toISOString() })),
      };
    });
  });

  /**
   * Switch one requirement on or off. Compliance Managers only. The reason (at least 10 characters) is kept with the change.
   * A change that leaves the value as it was is accepted and recorded as nothing.
   */
  app.put('/v1/onboarding/requirements', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const b = body(req);
    if (!REQUIREMENT_KEYS.includes(b.requirement as never)) throw invalid('requirement must be one of: ' + REQUIREMENT_KEYS.join(', '));
    if (typeof b.value !== 'boolean') throw invalid('value must be on (true) or off (false)');
    const reason = str(b.reason, 'reason', 500);
    if (reason.length < 10) throw invalid('Give a reason of at least 10 characters: the change is kept with it');
    const key = b.requirement as RequirementKey;
    const col = REQUIREMENT_COLUMN[key];
    return run(ctx, async (tx) => {
      if (!(await tx.query<{ ok: boolean }>('SELECT app_is_compliance_role() AS ok')).rows[0]?.ok) {
        throw forbidden('Only a Compliance Manager can change onboarding requirements');
      }
      const before = (await requirementsOf(tx, ctx.tenantId))[key];
      if (before !== b.value) {
        await tx.query(
          `INSERT INTO onboarding_requirements (tenant_id, ${col}, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id) DO UPDATE SET ${col} = $2, updated_by = $3, updated_at = now()`,
          [ctx.tenantId, b.value, ctx.userId]);
        await tx.query(
          `INSERT INTO onboarding_requirement_changes (tenant_id, requirement, from_value, to_value, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [ctx.tenantId, col, before, b.value, reason, ctx.userId]);
        await audit(tx, ctx, 'onboarding.requirement_changed', 'tenant', ctx.tenantId, { requirement: key, from: before, to: b.value, reason });
      }
      return { requirements: await requirementsOf(tx, ctx.tenantId) };
    });
  });

  /** The company's saved wording, plus the AGA agreement supplied by Punjab Insurance for a company that has not saved one yet. */
  app.get('/v1/onboarding/agreement-template', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const row = (await tx.query<{ title: string; version: string; body: string; updatedAt: Date }>(
        `SELECT title, version, body, updated_at AS "updatedAt" FROM onboarding_agreement_templates WHERE tenant_id = $1`,
        [ctx.tenantId])).rows[0];
      const canChange = (await tx.query<{ ok: boolean }>(
        'SELECT app_is_compliance_role() OR app_is_tenant_admin() AS ok')).rows[0]?.ok === true;
      return {
        canChange,
        starter: { title: AGA_TITLE, version: AGA_VERSION, body: AGA_BODY },
        template: row ? { title: row.title, version: row.version, body: row.body, updatedAt: row.updatedAt.toISOString() } : null,
      };
    });
  });

  /** Save the company wording. A Compliance Manager or the company administrator. The previous wording stays in the revision table. */
  app.put('/v1/onboarding/agreement-template', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const b = body(req);
    const title = str(b.title, 'title', 200);
    const version = str(b.version, 'version', 60);
    const agreementBody = str(b.body, 'body', 60_000);
    return run(ctx, async (tx) => {
      if (!(await tx.query<{ ok: boolean }>('SELECT app_is_compliance_role() OR app_is_tenant_admin() AS ok')).rows[0]?.ok) {
        throw forbidden('Only a Compliance Manager or the company administrator can save the agency agreement wording');
      }
      await tx.query(
        `INSERT INTO onboarding_agreement_templates (tenant_id, title, version, body, updated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id) DO UPDATE SET title = $2, version = $3, body = $4, updated_by = $5, updated_at = now()`,
        [ctx.tenantId, title, version, agreementBody, ctx.userId]);
      await tx.query(
        `INSERT INTO onboarding_agreement_revisions (tenant_id, title, version, body, saved_by) VALUES ($1,$2,$3,$4,$5)`,
        [ctx.tenantId, title, version, agreementBody, ctx.userId]);
      await audit(tx, ctx, 'onboarding.agreement_template_saved', 'tenant', ctx.tenantId, { title, version });
      return { template: { title, version, body: agreementBody } };
    });
  });

  // ---- Compliance officer ------------------------------------------------------------------------------------------

  /**
   * Invite a partner into onboarding. With `adminEmail`, the partner's administrator gets one email with a link to create
   * a PII login and the extension install step. Asking again for the same partner sends a fresh link (the older one stops).
   * Without `adminEmail`, the email goes to people who already have a login on that partner (the older behaviour).
   * Allowed for the Compliance officer of the region and for an administrator of the partner.
   */
  app.post('/v1/onboarding/cases', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = body(req);
    const nodeId = caseId(str(b.nodeId, 'nodeId', 60));
    // The country is the company's (each country is its own company and database). A country sent in the body is ignored.
    const locale: 'en' | 'fr-CA' = b.locale === 'fr-CA' ? 'fr-CA' : 'en';
    const adminEmail = b.adminEmail === undefined || b.adminEmail === null || b.adminEmail === ''
      ? null : str(b.adminEmail, 'adminEmail', 320).trim().toLowerCase();
    if (adminEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw invalid('Enter a valid email address for the partner administrator');
    const out = await run(ctx, async (tx) => {
      const n = (await tx.query<{ tenantId: string; type: string; name: string; country: string }>(
        `SELECT n.tenant_id AS "tenantId", n.type, n.name, t.country_code::text AS country
           FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.id = $1`, [nodeId])).rows[0];
      if (!n || n.type !== 'partner') throw notFound('Unknown partner');
      // Plan v7: only the Compliance Manager starts a partner's file. Branch managers and the company administrator do not.
      if (!(await holdsComplianceAbove(tx, nodeId))) throw forbidden('Only the Compliance Manager for this branch can start this file');
      const existing = (await tx.query<{ id: string }>('SELECT id FROM onboarding_cases WHERE node_id = $1', [nodeId])).rows[0];
      if (existing && adminEmail === null) throw conflict('This partner is already in onboarding');
      let id = existing?.id;
      if (!id) {
        id = (await tx.query<{ id: string }>(
          `INSERT INTO onboarding_cases (tenant_id, node_id, country) VALUES ($1, $2, $3) RETURNING id`, [n.tenantId, nodeId, n.country])).rows[0]!.id;
        await audit(tx, ctx, 'onboarding.invited', 'onboarding_case', id, { partner: n.name, country: n.country });
      }
      const invitation = adminEmail === null ? null : {
        ...(await createPartnerInvitation(tx, ctx, { caseId: id, nodeId, email: adminEmail, locale })),
        email: adminEmail, locale, tenantId: n.tenantId,
      };
      return { id, stage: 'invited' as const, tenantId: n.tenantId, invitation, partnerName: n.name };
    });
    const { tenantId, invitation, partnerName: _name, ...view } = out;
    if (invitation) {
      const sent = await sendPartnerInvitation(deps, ctx, invitation);
      reply.code(201);
      return { ...view, invitation: { id: invitation.id, email: invitation.email, status: sent.status, error: sent.error ?? null, mailConfigured: Boolean(deps.mailer) } };
    }
    // Legacy path: tell the people who already have a login on this partner.
    let recipients = 0; let emailedTo = 0;
    const to = (await deps.authPool.query<{ email: string }>(
      `SELECT DISTINCT u.email::text AS email FROM app_users u JOIN user_node_roles r ON r.user_id = u.id
        WHERE r.node_id = $1 AND u.status::text <> 'disabled'`, [nodeId])).rows.map((r) => r.email);
    recipients = to.length;
    if (deps.mailer) {
      const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]?.name ?? 'PII';
      const url = `${deps.config.appOrigin}/app`;
      const text = `${firm} has started your partner onboarding.\n\nSign in to PII and open Compliance. There you can complete your business profile, give consent to the credit and background checks, and sign your agency agreement once it is sent.\n\n${url}`;
      const html = `<p>${escapeHtml(firm)} has started your partner onboarding.</p><p>Sign in to PII and open <b>Compliance</b>. There you can complete your business profile, give consent to the credit and background checks, and sign your agency agreement once it is sent.</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
      for (const email of to) {
        try { await deps.mailer.send({ to: email, subject: `Partner onboarding with ${firm}`, text, html }); emailedTo += 1; } catch (e) {
          req.log.warn({ err: (e as Error).message }, 'onboarding invite email refused');
        }
      }
    }
    reply.code(201);
    return { ...view, mailConfigured: Boolean(deps.mailer), recipients, emailedTo };
  });

  /**
   * Add a broker under a branch (plan v7, section 5). One action creates the broker and its file together, and invites its
   * administrator straight away. Only the Compliance Manager of that branch may add one. The name is required and is never
   * an email. A broker with the same name (case-insensitive) that this officer can see is refused, so it is found and started instead.
   */
  app.post('/v1/onboarding/brokers', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = body(req);
    const name = str(b.name, 'name', 200).trim();
    if (!name) throw invalid('Enter the broker\'s business name');
    if (name.includes('@')) throw invalid('Enter the broker\'s business name, not an email address');
    const parentId = caseId(str(b.parentId, 'parentId', 60));
    if (!BROKER_TYPES.includes(b.type as never)) throw invalid('type must be individual or corporate');
    const type = b.type as BrokerType;
    const adminEmail = str(b.adminEmail, 'adminEmail', 320).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw invalid('Enter a valid email address for the broker administrator');
    const locale: 'en' | 'fr-CA' = b.locale === 'fr-CA' ? 'fr-CA' : 'en';
    const out = await run(ctx, async (tx) => {
      const branch = (await tx.query<{ tenantId: string; type: string; country: string }>(
        `SELECT n.tenant_id AS "tenantId", n.type, t.country_code::text AS country
           FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.id = $1`, [parentId])).rows[0];
      if (!branch || branch.type !== 'location') throw notFound('Unknown branch');
      const complianceHere = await holdsComplianceAbove(tx, parentId);
      if (!canAddBroker({ isTenantAdmin: ctx.isTenantAdmin, isComplianceForBranch: complianceHere }, 'location', false)) {
        throw forbidden('Only the Compliance Manager for this branch adds brokers');
      }
      const dup = (await tx.query<{ id: string }>(
        `SELECT id FROM org_nodes WHERE type = 'partner' AND lower(name) = lower($1) LIMIT 1`, [name])).rows[0];
      if (dup) throw conflict('A broker with this name is already in the company. Search for it and start its file instead.');
      const nodeId = randomUUID();
      await tx.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'partner', $3)`, [nodeId, branch.tenantId, name]);
      await tx.query(
        `INSERT INTO org_links (tenant_id, parent_id, child_id, kind, created_by) VALUES ($1, $2, $3, 'location_link', $4)`,
        [branch.tenantId, parentId, nodeId, ctx.userId]);
      await audit(tx, ctx, 'node_created', 'org_node', nodeId, { type: 'partner', name, parentId, kind: 'location_link' }, nodeId);
      const caseRow = (await tx.query<{ id: string }>(
        `INSERT INTO onboarding_cases (tenant_id, node_id, country, broker_type) VALUES ($1, $2, $3, $4) RETURNING id`,
        [branch.tenantId, nodeId, branch.country, type])).rows[0]!;
      await audit(tx, ctx, 'onboarding.invited', 'onboarding_case', caseRow.id, { partner: name, country: branch.country, type });
      const inv = await createPartnerInvitation(tx, ctx, { caseId: caseRow.id, nodeId, email: adminEmail, locale });
      return {
        id: caseRow.id, nodeId, stage: 'invited' as const, partnerName: name, tenantId: branch.tenantId,
        invitation: { ...inv, email: adminEmail, locale, tenantId: branch.tenantId },
      };
    });
    const { tenantId: _t, invitation, partnerName: _n, ...view } = out;
    const sent = await sendPartnerInvitation(deps, ctx, invitation);
    reply.code(201);
    return { ...view, invitation: { id: invitation.id, email: invitation.email, status: sent.status, error: sent.error ?? null, mailConfigured: Boolean(deps.mailer) } };
  });

  /** Search brokers the caller can see, by name or administrator email, for the duplicate check before Add broker. */
  app.get('/v1/onboarding/brokers/search', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const q = String((req.query as { q?: unknown }).q ?? '').trim();
    if (q.length < 2) return { brokers: [] };
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT n.id, n.name, c.id AS "caseId", c.stage,
                (SELECT l.parent_id FROM org_links l WHERE l.child_id = n.id AND l.kind = 'location_link' LIMIT 1) AS "branchId"
           FROM org_nodes n
           LEFT JOIN onboarding_cases c ON c.node_id = n.id
          WHERE n.type = 'partner'
            AND (n.name ILIKE '%' || $1 || '%'
                 OR EXISTS (SELECT 1 FROM user_node_roles r JOIN app_users u ON u.id = r.user_id
                             WHERE r.node_id = n.id AND r.role::text = 'admin' AND u.email::text ILIKE '%' || $1 || '%'))
          ORDER BY n.name LIMIT 10`, [q]);
      return { brokers: rows };
    });
  });

  /** The cases this officer can see (their region, or all for a tenant admin). */
  app.get('/v1/onboarding/cases', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<CaseRow>(
        `SELECT c.id, c.node_id AS "nodeId", c.tenant_id AS "tenantId", c.country, c.stage, c.standing,
                c.last_checked_at AS "lastCheckedAt", COALESCE(NULLIF(p.legal_name, ''), n.name) AS "partnerName",
                c.login_created_at AS "loginCreatedAt", c.extension_installed_at AS "extensionInstalledAt",
                inv.email AS "inviteEmail", inv.accepted_at AS "inviteAccepted", inv.link_opened_at AS "inviteOpened",
                inv.sent_at AS "inviteSent", inv.reminders_sent AS "inviteReminders", inv.delivery_error AS "inviteError",
                app_is_compliance_at_or_above(c.tenant_id, c.node_id) AS "full",
                EXISTS (SELECT 1 FROM onboarding_staff s WHERE s.case_id = c.id AND s.user_id = app_user_id()) AS "assigned"
           FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id
           LEFT JOIN LATERAL (SELECT i.email::text AS email, i.accepted_at, i.link_opened_at, i.sent_at, i.reminders_sent, i.delivery_error
                                FROM invitations i WHERE i.onboarding_case_id = c.id ORDER BY i.created_at DESC LIMIT 1) inv ON true
          WHERE app_is_compliance_at_or_above(c.tenant_id, c.node_id) OR ${BRANCH_MANAGER_SQL.replace('%NODE%', 'c.node_id')}
             OR EXISTS (SELECT 1 FROM onboarding_staff s WHERE s.case_id = c.id AND s.user_id = app_user_id())
          ORDER BY c.created_at DESC`)).rows as Array<CaseRow & { full: boolean; assigned: boolean; inviteEmail: string | null; inviteAccepted: Date | null; inviteOpened: Date | null; inviteSent: Date | null; inviteReminders: number; inviteError: string | null }>;
      const profiles = await profileChecklists(tx, ctx, [...new Set(rows.map((r) => r.nodeId))]);
      const cases = await Promise.all(rows.map(async (c) => {
        if (c.full) {
          return {
            id: c.id, nodeId: c.nodeId, partnerName: c.partnerName, country: c.country, stage: c.stage,
            ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
            loginCreated: c.loginCreatedAt != null, extensionInstalled: c.extensionInstalledAt != null,
            invite: inviteView(c),
          };
        }
        if (c.assigned) return staffView(tx, c);
        const view = progressView(c);
        // A branch manager sees who is on the broker and who of its branch can still be assigned (names only).
        if (await managesBranchAbove(tx, ctx.userId, c.nodeId)) return { ...view, staff: await assignedStaff(tx, c.id), candidates: await staffCandidates(tx, c) };
        return view;
      }));
      return { cases: cases.map((v, i) => rows[i]!.full ? { ...v, profile: profiles.get(rows[i]!.nodeId) ?? null } : v) };
    });
  });

  /** Full file for the officer: consents, every check (scores included), decisions, packets, and the rule's suggestion. */
  app.get('/v1/onboarding/cases/:id', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      if (!(await isOfficer(tx, c.tenantId, c.nodeId))) {
        if (await isBranchManagerAbove(tx, c.nodeId)) return { ...progressView(c), staff: await assignedStaff(tx, id) };
        if (await isAssignedStaff(tx, id)) return staffView(tx, c);
        throw forbidden('Only the Compliance officer for this region can do this');
      }
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
      const latest = (await tx.query<CaseRow>(
        `SELECT i.email::text AS "inviteEmail", i.accepted_at AS "inviteAccepted", i.link_opened_at AS "inviteOpened", i.sent_at AS "inviteSent",
                i.reminders_sent AS "inviteReminders", i.delivery_error AS "inviteError"
           FROM invitations i WHERE i.onboarding_case_id = $1 ORDER BY i.created_at DESC LIMIT 1`, [id])).rows[0];
      return {
        id, nodeId: c.nodeId, partnerName: c.partnerName, country: c.country, stage: c.stage, ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
        loginCreated: c.loginCreatedAt != null, extensionInstalled: c.extensionInstalledAt != null, invite: latest ? inviteView({ ...c, ...latest }) : null,
        suggested: suggestedStanding(await outcomesOf(tx, id)), thresholds: CANADA_THRESHOLDS,
        screening: (await tx.query(
          `SELECT insolvency_or_judgment AS "insolvencyOrJudgment", red_flag AS "redFlag", answers, created_at AS "recordedAt"
             FROM onboarding_screenings WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] ?? null,
        consents, checks, decisions, carrierPackets: packets,
        ownership: await ownershipOf(tx, id),
        exceptions: (await tx.query(
          `SELECT reason, approver_name AS "approverName", created_at AS "approvedAt" FROM onboarding_exceptions WHERE case_id = $1 ORDER BY created_at`, [id])).rows,
        canApproveException: (await tx.query<{ ok: boolean }>('SELECT app_is_tenant_admin() AS ok')).rows[0]?.ok === true,
        awaitingApproval: c.stage === 'checks_complete' && (await requirementsOf(tx, c.tenantId)).pendingApproval,
      };
    });
  });

  /**
   * Record the screening questionnaire for a broker: insolvency or judgment (yes/no) and red flags (yes/no), with the answers.
   * Officer only. The latest recording counts; each recording is kept.
   */
  app.post('/v1/onboarding/cases/:id/screening', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    if (typeof b.insolvencyOrJudgment !== 'boolean') throw invalid('insolvencyOrJudgment must be yes or no (true or false)');
    if (typeof b.redFlag !== 'boolean') throw invalid('redFlag must be yes or no (true or false)');
    const answers = b.answers === undefined ? {} : b.answers;
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw invalid('answers must be an object');
    await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      await tx.query(
        `INSERT INTO onboarding_screenings (tenant_id, case_id, node_id, insolvency_or_judgment, red_flag, answers, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.tenantId, id, c.nodeId, b.insolvencyOrJudgment, b.redFlag, JSON.stringify(answers), ctx.userId]);
      await audit(tx, ctx, 'onboarding.screening_recorded', 'onboarding_case', id, { insolvencyOrJudgment: b.insolvencyOrJudgment, redFlag: b.redFlag });
    });
    reply.code(201);
    return { recorded: true };
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
      await audit(tx, ctx, 'onboarding.check_recorded', 'onboarding_case', id, { kind, provider, status, source: 'manual' });
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
      const pendingRule = (await requirementsOf(tx, c.tenantId)).pendingApproval;
      if (pendingRule && !(await tx.query<{ ok: boolean }>('SELECT app_is_compliance_role() AS ok')).rows[0]?.ok) {
        throw forbidden('While pending compliance approval applies, only a Compliance Manager records the decision');
      }
      if (c.stage !== 'checks_complete') throw conflict('The decision waits until both checks are complete');
      // The screening questions are part of the file: no decision until they are recorded.
      const requirements = await requirementsOf(tx, c.tenantId);
      if (requirements.ownershipRequired) {
        const problems = (await ownershipOf(tx, id)).problems;
        if (problems.length) throw conflict(`Complete the ownership file before the decision: ${problems.join(', ')}`);
      }
      if (requirements.screeningBeforeDecision) {
        const screened = (await tx.query<{ ok: boolean }>('SELECT EXISTS (SELECT 1 FROM onboarding_screenings WHERE case_id = $1) AS ok', [id])).rows[0]?.ok === true;
        if (!screened) throw conflict('Record the screening questions before the decision');
      }
      // A red flag, judgment, insolvency or adverse background report can be decided as good standing only with the President and CEO's approval.
      if (requirements.presidentExceptions && outcome === 'good_standing') {
        const o = await outcomesOf(tx, id);
        const flagged = o.insolvencyOrJudgment === true || o.redFlag === true || o.backgroundAdverse === true;
        if (flagged) {
          const approved = (await tx.query<{ ok: boolean }>('SELECT EXISTS (SELECT 1 FROM onboarding_exceptions WHERE case_id = $1) AS ok', [id])).rows[0]?.ok === true;
          if (!approved) throw conflict('This file has a red flag. The President and CEO must approve the exception before it can be decided as good standing');
        }
      }
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
    const out = await run(ctx, async (tx): Promise<{ blocked: string[] } | { id: string; status: 'draft' }> => {
      const c = await loadCase(tx, id);
      await requirePartnerUser(tx, c);
      // A licence or E&O policy that has expired freezes submissions (plan v6, section 2). The freeze is recorded, and it
      // lifts on renewal: the same counts the clearance list reads.
      const cov = (await tx.query<{ licences: number; validLicences: number; eoPolicies: number; validEo: number }>(
        `SELECT (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = $1 AND i.kind = 'licence') AS licences,
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = $1 AND i.kind = 'licence' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "validLicences",
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = $1 AND i.kind = 'eo') AS "eoPolicies",
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = $1 AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "validEo"`,
        [c.nodeId])).rows[0]!;
      const blocks = carrierPacketBlocks({
        agencyAgreementSigned: ['agency_agreement_signed', 'active'].includes(c.stage), stage: c.stage, standing: c.standing ?? 'pending',
        lastChecked: c.lastCheckedAt, now: new Date(), frozenForExpiry: coverageFrozen(cov),
      });
      if (blocks.includes('licence_or_eo_expired')) await audit(tx, ctx, 'onboarding.packet_frozen', 'onboarding_case', id, { blocks });
      // Returned, not thrown, so the freeze record above is kept.
      if (blocks.length) return { blocked: blocks };
      const packetId = (await tx.query<{ id: string }>(
        `INSERT INTO carrier_packets (tenant_id, node_id, carrier, template_version) VALUES ($1,$2,$3,$4) RETURNING id`,
        [c.tenantId, c.nodeId, carrier, templateVersion])).rows[0]!.id;
      await audit(tx, ctx, 'onboarding.carrier_packet_created', 'carrier_packet', packetId, { carrier });
      return { id: packetId, status: 'draft' as const };
    });
    if ('blocked' in out) throw conflict(`Carrier packet not yet allowed: ${out.blocked.join(', ')}`);
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
      const branchManager = (await tx.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM onboarding_cases c WHERE ${BRANCH_MANAGER_SQL.replace('%NODE%', 'c.node_id')}) AS ok`)).rows[0]?.ok === true;
      const staff = (await tx.query<{ ok: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM onboarding_staff WHERE user_id = app_user_id()) AS ok')).rows[0]?.ok === true;
      // The broker's own licence and E&O dates (plan v6, section 9). Only people at the partner see them: the query is scoped to their own nodes.
      const expiries = onboarding ? (await tx.query(
        `SELECT i.id, i.kind, i.label, i.expires_on::text AS "expiresOn",
                CASE WHEN i.expires_on < current_date THEN 'expired' WHEN i.expires_on <= current_date + 30 THEN 'expiring' ELSE 'valid' END AS status
           FROM compliance_items i
          WHERE i.expires_on IS NOT NULL AND i.node_id IN (SELECT node_id FROM user_node_roles WHERE user_id = app_user_id())
          ORDER BY i.expires_on, i.label`)).rows : [];
      return { officer, branchManager, staff, onboarding: onboarding ? { ...onboarding, expiries } : null };
    });
  });

  /**
   * A branch manager assigns a staff member of its branch to a broker in its branch (plan v7, section 6).
   * The staff member must hold the staff role at that branch. Assigning is the only way a staff member sees a broker.
   */
  app.post('/v1/onboarding/cases/:id/staff', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const userId = str(body(req).userId, 'userId', 60);
    if (!UUID_RE.test(userId)) throw invalid('Choose a person to assign');
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      if (!(await managesBranchAbove(tx, ctx.userId, c.nodeId))) throw forbidden('Only the branch manager of this broker\'s branch can assign staff to it');
      const member = (await tx.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM user_node_roles r JOIN org_nodes a ON a.id = r.node_id AND a.type = 'location'
                          JOIN org_reach o ON o.ancestor_id = r.node_id
                         WHERE r.user_id = $1 AND r.role::text = 'staff' AND o.descendant_id = $2) AS ok`, [userId, c.nodeId])).rows[0]?.ok === true;
      if (!member) throw invalid('Only a staff member of this branch can be assigned to its brokers');
      await tx.query(
        `INSERT INTO onboarding_staff (tenant_id, case_id, node_id, user_id, assigned_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [c.tenantId, id, c.nodeId, userId, ctx.userId]);
      await audit(tx, ctx, 'onboarding.staff_assigned', 'onboarding_case', id, { user: userId });
      return { userId };
    });
    reply.code(201);
    return out;
  });

  /** A branch manager removes a staff member from a broker in its branch. */
  app.delete('/v1/onboarding/cases/:id/staff/:userId', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const params = req.params as { id: string; userId: string };
    const id = caseId(params.id);
    if (!UUID_RE.test(params.userId)) throw invalid('Choose a person to remove');
    await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      if (!(await managesBranchAbove(tx, ctx.userId, c.nodeId))) throw forbidden('Only the branch manager of this broker\'s branch can remove staff from it');
      const r = await tx.query('DELETE FROM onboarding_staff WHERE case_id = $1 AND user_id = $2', [id, params.userId]);
      if (!r.rowCount) throw notFound('That person is not assigned to this broker');
      await audit(tx, ctx, 'onboarding.staff_removed', 'onboarding_case', id, { user: params.userId });
    });
    return reply.code(204).send();
  });
}

/** Each partner's business-profile checklist (5 steps), so the profile completion counts can be shown for every partner. */
async function profileChecklists(tx: Tx, ctx: RequestContext, nodeIds: string[]) {
  const out = new Map<string, { done: number; total: number }>();
  if (nodeIds.length === 0) return out;
  const eoMin = await eoMinFor(tx, ctx);
  const rows = (await tx.query<{ nodeId: string; entityType: string | null; legalName: string | null; businessNumber: string | null; agreement: string | null; attested: boolean; licences: number; eoCount: number; eoMax: number | null }>(
    `SELECT n.id AS "nodeId", p.entity_type AS "entityType", p.legal_name AS "legalName", p.business_number AS "businessNumber",
            p.agreement_status AS agreement, (p.attested_at IS NOT NULL) AS attested,
            (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence') AS licences,
            (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo') AS "eoCount",
            (SELECT max(i.limit_amount)::float FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "eoMax"
       FROM org_nodes n LEFT JOIN compliance_profiles p ON p.node_id = n.id
      WHERE n.id = ANY($1::uuid[])`, [nodeIds])).rows;
  for (const r of rows) {
    const cl = computeChecklist({ profile: { entityType: r.entityType, legalName: r.legalName, businessNumber: r.businessNumber, attestedAt: r.attested ? 'x' : null, agreementStatus: r.agreement }, licences: r.licences, eoCount: r.eoCount, eoMaxLimit: r.eoMax, eoMin });
    out.set(r.nodeId, { done: cl.steps.filter((x) => x.done).length, total: cl.steps.length });
  }
  return out;
}
