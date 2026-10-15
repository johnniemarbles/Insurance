// Partner (broker) onboarding. Two panels share these routes:
//  - the Compliance officer (per region, or a tenant admin) runs the flow: invite, record the checks, decide the standing, move the agreement;
//  - the partner completes its own steps (form, consents, carrier packets) and sees its own status, with the outcome only, never the checks.
// Visibility is enforced in the database (row-level security); the officer checks below use app_is_compliance_at_or_above.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  CANADA_THRESHOLDS, STANDING_LABELS, STANDING_OUTCOMES, carrierPacketBlocks, keepsAccessWhile, standingWarning, nextCheckDue, recheckStatus, stageMoveBlock,
  progressSteps, suggestedStanding, REQUIREMENT_COLUMN, REQUIREMENT_DEFAULTS, REQUIREMENT_KEYS, type RequirementKey,
  type OnboardingStage, type RequestContext, type StandingOutcome,
} from '@pii/domain';
import { audit } from './audit.ts';
import { escapeHtml } from './merge-render.ts';
import { createPartnerInvitation, sendPartnerInvitation } from './partner-invite.ts';
import { isAdminAbove } from './routes-people.ts';
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

/** The company's onboarding requirements (defaults when none has been changed). */
async function requirementsOf(tx: Tx, tenantId: string): Promise<Record<RequirementKey, boolean>> {
  const row = (await tx.query<Record<string, boolean>>(
    `SELECT screening_before_decision, ownership_required, pending_approval, president_exceptions
       FROM onboarding_requirements WHERE tenant_id = $1`, [tenantId])).rows[0];
  const out = { ...REQUIREMENT_DEFAULTS };
  if (row) for (const k of REQUIREMENT_KEYS) out[k] = row[REQUIREMENT_COLUMN[k]] === true;
  return out;
}

export function registerOnboardingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

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
    const country = b.country === 'US' ? 'US' : 'CA';
    const locale: 'en' | 'fr-CA' = b.locale === 'fr-CA' ? 'fr-CA' : 'en';
    const adminEmail = b.adminEmail === undefined || b.adminEmail === null || b.adminEmail === ''
      ? null : str(b.adminEmail, 'adminEmail', 320).trim().toLowerCase();
    if (adminEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw invalid('Enter a valid email address for the partner administrator');
    const out = await run(ctx, async (tx) => {
      const n = (await tx.query<{ tenantId: string; type: string; name: string }>(
        'SELECT tenant_id AS "tenantId", type, name FROM org_nodes WHERE id = $1', [nodeId])).rows[0];
      if (!n || n.type !== 'partner') throw notFound('Unknown partner');
      const allowed = (await isOfficer(tx, n.tenantId, nodeId)) || (await isAdminAbove(tx, ctx, nodeId)) || (await isBranchManagerAbove(tx, nodeId));
      if (!allowed) throw forbidden('Only the Compliance officer for this region, an administrator of this partner, or a manager of its branch, can start it');
      const existing = (await tx.query<{ id: string }>('SELECT id FROM onboarding_cases WHERE node_id = $1', [nodeId])).rows[0];
      if (existing && adminEmail === null) throw conflict('This partner is already in onboarding');
      let id = existing?.id;
      if (!id) {
        id = (await tx.query<{ id: string }>(
          `INSERT INTO onboarding_cases (tenant_id, node_id, country) VALUES ($1, $2, $3) RETURNING id`, [n.tenantId, nodeId, country])).rows[0]!.id;
        await audit(tx, ctx, 'onboarding.invited', 'onboarding_case', id, { partner: n.name, country });
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
                app_is_compliance_at_or_above(c.tenant_id, c.node_id) AS "full"
           FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id LEFT JOIN compliance_profiles p ON p.node_id = n.id
           LEFT JOIN LATERAL (SELECT i.email::text AS email, i.accepted_at, i.link_opened_at, i.sent_at, i.reminders_sent, i.delivery_error
                                FROM invitations i WHERE i.onboarding_case_id = c.id ORDER BY i.created_at DESC LIMIT 1) inv ON true
          WHERE app_is_compliance_at_or_above(c.tenant_id, c.node_id) OR ${BRANCH_MANAGER_SQL.replace('%NODE%', 'c.node_id')}
          ORDER BY c.created_at DESC`)).rows;
      return {
        cases: rows.map((c) => (c.full
          ? {
            id: c.id, nodeId: c.nodeId, partnerName: c.partnerName, country: c.country, stage: c.stage,
            ...outcomeView(c.standing), recheck: recheckView(c.lastCheckedAt),
            loginCreated: c.loginCreatedAt != null, extensionInstalled: c.extensionInstalledAt != null,
            invite: inviteView(c),
          }
          : progressView(c))),
      };
    });
  });

  /** Full file for the officer: consents, every check (scores included), decisions, packets, and the rule's suggestion. */
  app.get('/v1/onboarding/cases/:id', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    return run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      if (!(await isOfficer(tx, c.tenantId, c.nodeId))) {
        if (await isBranchManagerAbove(tx, c.nodeId)) return progressView(c);
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
      // The screening questions are part of the file: no decision until they are recorded.
      if ((await requirementsOf(tx, c.tenantId)).screeningBeforeDecision) {
        const screened = (await tx.query<{ ok: boolean }>('SELECT EXISTS (SELECT 1 FROM onboarding_screenings WHERE case_id = $1) AS ok', [id])).rows[0]?.ok === true;
        if (!screened) throw conflict('Record the screening questions before the decision');
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
      const branchManager = (await tx.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM onboarding_cases c WHERE ${BRANCH_MANAGER_SQL.replace('%NODE%', 'c.node_id')}) AS ok`)).rows[0]?.ok === true;
      return { officer, branchManager, onboarding };
    });
  });
}
