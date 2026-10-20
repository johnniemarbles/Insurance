// Families, Gate B (insurance): people on policies and deals by role, carrier rule profiles, family policy totals and
// the evidence-based coverage grid.
//
// Switch: FAMILIES_INSURANCE_ENABLED=1 (and, for the family screens, FAMILIES_ENABLED=1). Off, every route here answers 404.
//
// Privacy: a policy is reachable here only through policy_visible() (producing partner, its managers above, the branch,
// tenant admin), and a party row only when every client in it is visible too. Only the producing partner (or a tenant
// admin) may change who is on a policy. Nothing is ever filled in from family membership.
//
// Family totals count each policy once, whatever the number of family members on it, per currency; ended policies and
// policies where the family is only named as beneficiary are listed but never added in. A total that cannot be complete
// says so ("partial", with the reasons) instead of showing a misleading number.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { canEditRecord, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { ageOn, familiesEnabled } from './routes-families.ts';
import {
  checkPolicyParties, currencyOf, DEFAULT_PROFILE, ENDED, HOLDING_ROLES, IN_FORCE, PARTY_ROLES, roleAllowed,
  type CarrierProfile, type PartyLike, type PartyRole,
} from './family-insurance-rules.ts';
import type { AppDeps } from './app.ts';

export const familyInsuranceEnabled = (): boolean => ['1', 'true'].includes(String(process.env.FAMILIES_INSURANCE_ENABLED ?? '').toLowerCase());

const DEFAULT_LINES = [
  ['life', 'Life', 'Vie'],
  ['critical_illness', 'Critical illness', 'Maladies graves'],
  ['disability', 'Disability', 'Invalidité'],
  ['health_dental', 'Health and dental', 'Soins de santé et dentaires'],
  ['travel', 'Travel', 'Voyage'],
] as const;
const DEAL_ROLES = ['applicant', 'co_applicant', 'insured', 'payor', 'beneficiary', 'representative'] as const;
const COVERAGE_STATES = ['covered', 'potential_gap', 'unknown', 'declined'] as const;

const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const PARTY_COLS = `pp.id, pp.contact_id AS "contactId", c.full_name AS "fullName", pp.outside_name AS "outsideName", pp.role,
  pp.beneficiary_class AS "beneficiaryClass", pp.insured_contact_id AS "insuredContactId", pp.allocation_method AS "allocationMethod",
  pp.share_basis_points AS "shareBasisPoints", pp.relationship_to_insured AS "relationshipToInsured", pp.source, pp.source_note AS "sourceNote",
  pp.carrier_confirmed_at AS "carrierConfirmedAt", pp.started_at AS "startedAt", pp.ended_at AS "endedAt"`;
const POLICY_COLS = `p.id, p.carrier_id AS "carrierId", cd.display_name AS "carrierName", p.policy_number AS "policyNumber", p.plan_name AS "planName",
  p.jurisdiction, p.status, p.annual_premium_cents AS "annualPremiumCents", p.premium_frequency AS "premiumFrequency",
  p.effective_date::text AS "effectiveDate", p.expiry_date::text AS "expiryDate", p.producer_node_id AS "producerNodeId", p.branch_node_id AS "branchNodeId"`;

export function registerFamilyInsuranceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const begin = async (req: Parameters<AppDeps['authenticate']>[0], needsFamilies = false) => {
    if (!familyInsuranceEnabled() || (needsFamilies && !familiesEnabled())) throw notFound();
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return ctx;
  };

  async function policyHeader(tx: Tx, id: string) {
    const p = (await tx.query(`SELECT ${POLICY_COLS} FROM policy_records p JOIN carrier_directory cd ON cd.id = p.carrier_id WHERE p.id = $1 AND policy_visible(p.id)`, [id])).rows[0];
    if (!p) throw notFound('Policy not found');
    return { ...p, currency: currencyOf(p.jurisdiction) };
  }
  async function profileFor(tx: Tx, carrierId: string): Promise<CarrierProfile & { source: 'carrier' | 'tenant' | 'built_in' }> {
    const r = (await tx.query(
      `SELECT carrier_id, requires_owner, requires_insured, allows_joint_owner, allows_joint_insured, allows_estate_beneficiary,
              allows_outside_beneficiary, allows_equal_shares, allows_trustee, confirmed_with_carrier
         FROM carrier_party_profiles WHERE carrier_id = $1 OR carrier_id IS NULL ORDER BY carrier_id NULLS LAST LIMIT 1`, [carrierId])).rows[0];
    if (!r) return { ...DEFAULT_PROFILE, source: 'built_in' };
    return {
      requiresOwner: r.requires_owner, requiresInsured: r.requires_insured, allowsJointOwner: r.allows_joint_owner, allowsJointInsured: r.allows_joint_insured,
      allowsEstateBeneficiary: r.allows_estate_beneficiary, allowsOutsideBeneficiary: r.allows_outside_beneficiary, allowsEqualShares: r.allows_equal_shares,
      allowsTrustee: r.allows_trustee, confirmedWithCarrier: r.confirmed_with_carrier, source: r.carrier_id ? 'carrier' : 'tenant',
    };
  }
  const openParties = async (tx: Tx, policyId: string): Promise<(PartyLike & { id: string; fullName: string | null })[]> =>
    (await tx.query(`SELECT ${PARTY_COLS} FROM policy_parties pp LEFT JOIN contacts c ON c.id = pp.contact_id WHERE pp.policy_id = $1 AND pp.ended_at IS NULL ORDER BY pp.started_at`, [policyId])).rows;
  /** Changing who is on a policy: the producing partner or a tenant admin. */
  function requirePolicyEdit(ctx: RequestContext, policy: { producerNodeId: string }) {
    if (!canEditRecord(ctx, policy.producerNodeId)) throw forbidden('Only the producing partner can change who is on this policy');
  }

  // ---- policies: search, people, check, fix-up queue ----
  app.get('/v1/policies/search', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 } } } } }, async (req) => {
    const ctx = await begin(req);
    const q = ((req.query as { q?: string }).q ?? '').trim();
    return run(ctx, async (tx) => ({
      policies: (await tx.query(
        `SELECT ${POLICY_COLS} FROM policy_records p JOIN carrier_directory cd ON cd.id = p.carrier_id
          WHERE policy_visible(p.id) AND ($1 = '' OR p.policy_number ILIKE '%' || $1 || '%' OR p.plan_name ILIKE '%' || $1 || '%' OR cd.display_name ILIKE '%' || $1 || '%')
          ORDER BY p.effective_date DESC, p.id LIMIT 20`, [q])).rows.map((p: any) => ({ ...p, currency: currencyOf(p.jurisdiction) })),
    }));
  });

  app.get('/v1/policies/:id/parties', { schema: { params: idParams, querystring: { type: 'object', additionalProperties: false, properties: { history: { type: 'boolean' } } } } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { history } = req.query as { history?: boolean };
    return run(ctx, async (tx) => {
      const policy = await policyHeader(tx, id);
      const profile = await profileFor(tx, policy.carrierId);
      const parties = (await tx.query(`SELECT ${PARTY_COLS} FROM policy_parties pp LEFT JOIN contacts c ON c.id = pp.contact_id
         WHERE pp.policy_id = $1 AND ($2 OR pp.ended_at IS NULL) ORDER BY (pp.ended_at IS NOT NULL), pp.started_at`, [id, history ?? false])).rows;
      return { policy, profile, parties, check: checkPolicyParties(await openParties(tx, id), profile), canEdit: canEditRecord(ctx, policy.producerNodeId) };
    });
  });

  app.post('/v1/policies/:id/parties', {
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['role'],
        properties: {
          contactId: uuid, outsideName: { type: 'string', minLength: 1, maxLength: 200 }, role: { type: 'string', enum: [...PARTY_ROLES] },
          beneficiaryClass: { type: 'string', enum: ['primary', 'contingent'] }, insuredContactId: uuid,
          allocationMethod: { type: 'string', enum: ['percentage', 'equal', 'estate'] }, sharePercent: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
          relationshipToInsured: { type: 'string', maxLength: 60 }, source: { type: 'string', enum: ['entered', 'carrier_document', 'import'] }, sourceNote: { type: 'string', maxLength: 300 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { contactId?: string; outsideName?: string; role: PartyRole; beneficiaryClass?: 'primary' | 'contingent'; insuredContactId?: string; allocationMethod?: 'percentage' | 'equal' | 'estate'; sharePercent?: number; relationshipToInsured?: string; source?: string; sourceNote?: string };
    const isBen = b.role === 'beneficiary';
    const estate = isBen && b.allocationMethod === 'estate';
    if (estate ? Boolean(b.contactId || b.outsideName) : Boolean(b.contactId) === Boolean(b.outsideName)) throw invalid(estate ? 'The estate is named on its own, with no person' : 'Choose a client, or give an outside person\'s name');
    if (b.outsideName && !['beneficiary', 'trustee'].includes(b.role)) throw invalid('Owners, insured people and payors must be clients on file');
    if (isBen && (!b.beneficiaryClass || !b.allocationMethod)) throw invalid('A beneficiary needs a class (primary or contingent) and a split');
    if (!isBen && (b.beneficiaryClass || b.allocationMethod || b.insuredContactId || b.sharePercent != null)) throw invalid('Class, split and share apply to beneficiaries only');
    if ((b.allocationMethod === 'percentage') !== (b.sharePercent != null)) throw invalid(b.allocationMethod === 'percentage' ? 'Give the share in percent' : 'A share applies only when the split is by percentage');
    const bp = b.sharePercent != null ? Math.round(b.sharePercent * 100) : null;
    if (bp != null && Math.abs(bp - b.sharePercent! * 100) > 1e-6) throw invalid('Give the share to at most two decimals');
    const out = await run(ctx, async (tx) => {
      const policy = await policyHeader(tx, id);
      requirePolicyEdit(ctx, policy);
      const profile = await profileFor(tx, policy.carrierId);
      const banned = roleAllowed(profile, { role: b.role, outsideName: b.outsideName ?? null, allocationMethod: b.allocationMethod ?? null });
      if (banned) throw invalid(banned.message);
      if (b.contactId) {
        const c = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM contacts WHERE id = $1', [b.contactId])).rows[0];
        if (!c) throw notFound('Client not found');
        requireEdit(ctx, c.owner_node_id);
      }
      const pid = randomUUID();
      await tx.query(
        `INSERT INTO policy_parties (id, tenant_id, policy_id, contact_id, outside_name, role, beneficiary_class, insured_contact_id, allocation_method,
           share_basis_points, relationship_to_insured, source, source_note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [pid, ctx.tenantId, id, b.contactId ?? null, b.outsideName?.trim() ?? null, b.role, b.beneficiaryClass ?? null, b.insuredContactId ?? null,
          b.allocationMethod ?? null, bp, b.relationshipToInsured?.trim() || null, b.source ?? 'entered', b.sourceNote?.trim() || null, ctx.userId]);
      // The audit records who and what role; never the outside person's name.
      await audit(tx, ctx, 'policy_party_added', 'policy', id, { partyId: pid, role: b.role, contactId: b.contactId ?? null, outside: Boolean(b.outsideName), beneficiaryClass: b.beneficiaryClass ?? null, allocationMethod: b.allocationMethod ?? null, shareBasisPoints: bp }, policy.producerNodeId);
      return { id: pid, check: checkPolicyParties(await openParties(tx, id), profile) };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/policies/:id/parties/:partyId/end', { schema: { params: { type: 'object', required: ['id', 'partyId'], properties: { id: uuid, partyId: uuid } } } }, async (req) => {
    const ctx = await begin(req);
    const { id, partyId } = req.params as { id: string; partyId: string };
    return run(ctx, async (tx) => {
      const policy = await policyHeader(tx, id);
      requirePolicyEdit(ctx, policy);
      const r = await tx.query<{ ended_at: Date | null; role: string }>('SELECT ended_at, role FROM policy_parties WHERE id = $1 AND policy_id = $2', [partyId, id]);
      if (!r.rows[0]) throw notFound('Not found on this policy');
      if (r.rows[0].ended_at) throw invalid('That role has already ended');
      await tx.query('UPDATE policy_parties SET ended_at = now(), ended_by = $2 WHERE id = $1', [partyId, ctx.userId]);
      await audit(tx, ctx, 'policy_party_ended', 'policy', id, { partyId, role: r.rows[0].role }, policy.producerNodeId);
      return { check: checkPolicyParties(await openParties(tx, id), await profileFor(tx, policy.carrierId)) };
    });
  });

  app.get('/v1/policies/:id/check', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const policy = await policyHeader(tx, id);
      return checkPolicyParties(await openParties(tx, id), await profileFor(tx, policy.carrierId));
    });
  });

  // Fix-up queue: policies in force or pending that the caller may see and that lack an owner or an insured.
  // People are never guessed from family membership: the queue lists what is missing and someone fills it in.
  app.get('/v1/policy-parties/missing', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT ${POLICY_COLS},
                EXISTS (SELECT 1 FROM policy_parties x WHERE x.policy_id = p.id AND x.ended_at IS NULL AND x.role IN ('owner', 'joint_owner')) AS has_owner,
                EXISTS (SELECT 1 FROM policy_parties x WHERE x.policy_id = p.id AND x.ended_at IS NULL AND x.role IN ('insured', 'joint_insured')) AS has_insured
           FROM policy_records p JOIN carrier_directory cd ON cd.id = p.carrier_id
          WHERE policy_visible(p.id) AND p.status IN ('active', 'reinstated', 'pending')
          ORDER BY p.effective_date DESC, p.id LIMIT 500`)).rows as any[];
      const out = [];
      for (const r of rows) {
        const prof = await profileFor(tx, r.carrierId);
        const missing = [...(prof.requiresOwner && !r.has_owner ? ['owner'] : []), ...(prof.requiresInsured && !r.has_insured ? ['insured'] : [])];
        if (missing.length) { const { has_owner: _o, has_insured: _i, ...p } = r; out.push({ ...p, currency: currencyOf(p.jurisdiction), missing }); }
      }
      return { asOf: new Date().toISOString(), policies: out, truncated: rows.length === 500 };
    });
  });

  // ---- deals: people by role ----
  app.get('/v1/boxes/:id/parties', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const box = (await tx.query('SELECT id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!box) throw notFound('Deal not found');
      return { parties: (await tx.query(
        `SELECT d.id, d.contact_id AS "contactId", c.full_name AS "fullName", d.role, d.started_at AS "startedAt"
           FROM deal_parties d JOIN contacts c ON c.id = d.contact_id WHERE d.box_id = $1 AND d.ended_at IS NULL ORDER BY d.started_at`, [id])).rows };
    });
  });
  app.post('/v1/boxes/:id/parties', { schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['contactId', 'role'], properties: { contactId: uuid, role: { type: 'string', enum: [...DEAL_ROLES] } } } } }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { contactId: string; role: string };
    const out = await run(ctx, async (tx) => {
      const box = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!box) throw notFound('Deal not found');
      requireEdit(ctx, box.owner_node_id);
      const c = (await tx.query('SELECT 1 FROM contacts WHERE id = $1', [b.contactId])).rows[0];
      if (!c) throw notFound('Client not found');
      const did = randomUUID();
      await tx.query('INSERT INTO deal_parties (id, tenant_id, box_id, contact_id, role, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [did, ctx.tenantId, id, b.contactId, b.role, ctx.userId]);
      await audit(tx, ctx, 'deal_party_added', 'box', id, { partyId: did, contactId: b.contactId, role: b.role }, box.owner_node_id);
      return { id: did };
    });
    return reply.code(201).send(out);
  });
  app.post('/v1/boxes/:id/parties/:partyId/end', { schema: { params: { type: 'object', required: ['id', 'partyId'], properties: { id: uuid, partyId: uuid } } } }, async (req, reply) => {
    const ctx = await begin(req);
    const { id, partyId } = req.params as { id: string; partyId: string };
    await run(ctx, async (tx) => {
      const box = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!box) throw notFound('Deal not found');
      requireEdit(ctx, box.owner_node_id);
      const r = await tx.query('UPDATE deal_parties SET ended_at = now(), ended_by = $3 WHERE id = $1 AND box_id = $2 AND ended_at IS NULL', [partyId, id, ctx.userId]);
      if (!r.rowCount) throw notFound('Not found on this deal');
      await audit(tx, ctx, 'deal_party_ended', 'box', id, { partyId }, box.owner_node_id);
    });
    return reply.code(204).send();
  });

  // ---- family policies: each policy once ----
  async function familyMembers(tx: Tx, familyId: string) {
    const f = (await tx.query('SELECT id FROM families WHERE id = $1', [familyId])).rows[0];
    if (!f) throw notFound('Family not found');
    return (await tx.query<{ contact_id: string; full_name: string | null; role: string; date_of_birth: string | null }>(
      `SELECT m.contact_id, c.full_name, m.role, c.date_of_birth::text AS date_of_birth FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
        WHERE m.family_id = $1 AND m.ended_at IS NULL ORDER BY CASE m.role WHEN 'head' THEN 0 WHEN 'spouse_partner' THEN 1 WHEN 'child' THEN 2 WHEN 'dependent' THEN 3 ELSE 4 END, c.full_name`, [familyId])).rows;
  }

  app.get('/v1/families/:id/policies', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req, true);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const members = await familyMembers(tx, id);
      const ids = members.map((m) => m.contact_id);
      const parties = ids.length === 0 ? [] : (await tx.query<{ policy_id: string; contact_id: string; full_name: string | null; role: PartyRole; beneficiary_class: string | null }>(
        `SELECT pp.policy_id, pp.contact_id, c.full_name, pp.role, pp.beneficiary_class
           FROM policy_parties pp JOIN contacts c ON c.id = pp.contact_id
          WHERE pp.contact_id = ANY ($1::uuid[]) AND pp.ended_at IS NULL`, [ids])).rows;
      const policyIds = [...new Set(parties.map((p) => p.policy_id))];
      const policies = policyIds.length === 0 ? [] : (await tx.query(
        `SELECT ${POLICY_COLS} FROM policy_records p JOIN carrier_directory cd ON cd.id = p.carrier_id WHERE p.id = ANY ($1::uuid[]) AND policy_visible(p.id)`, [policyIds])).rows as any[];
      const warnings: { code: string; message: string; policyId?: string }[] = [];
      const held: any[] = [];
      const beneficiaryOf: any[] = [];
      const totals = new Map<string, { currency: string; annualPremiumCents: number; policies: number }>();
      const today = new Date().toISOString().slice(0, 10);
      let nextRenewal: string | null = null;
      for (const p of policies) {
        const mine = parties.filter((x) => x.policy_id === p.id);
        const people = [...new Map(mine.map((x) => [x.contact_id, { contactId: x.contact_id, fullName: x.full_name, roles: mine.filter((y) => y.contact_id === x.contact_id).map((y) => y.role) }])).values()];
        const currency = currencyOf(p.jurisdiction);
        const entry = { ...p, currency, people };
        if (!mine.some((x) => HOLDING_ROLES.includes(x.role))) { beneficiaryOf.push(entry); continue; }
        held.push(entry);
        if (!(IN_FORCE as readonly string[]).includes(p.status)) continue;
        // Counted once, whatever the number of family members on it.
        if (!currency) { warnings.push({ code: 'unknown_currency', message: `The currency of policy ${p.policyNumber} is unknown; it is left out of the totals`, policyId: p.id }); continue; }
        const t = totals.get(currency) ?? { currency, annualPremiumCents: 0, policies: 0 };
        t.annualPremiumCents += Number(p.annualPremiumCents); t.policies += 1; totals.set(currency, t);
        const prof = await profileFor(tx, p.carrierId);
        const all = await openParties(tx, p.id);
        if ((prof.requiresOwner && !all.some((x) => x.role === 'owner' || x.role === 'joint_owner')) || (prof.requiresInsured && !all.some((x) => x.role === 'insured' || x.role === 'joint_insured'))) {
          warnings.push({ code: 'missing_people', message: `Policy ${p.policyNumber} is missing its owner or insured`, policyId: p.id });
        }
        if (p.expiryDate && p.expiryDate >= today && (!nextRenewal || p.expiryDate < nextRenewal)) nextRenewal = p.expiryDate;
      }
      const order = (s: string) => ((IN_FORCE as readonly string[]).includes(s) ? 0 : s === 'pending' ? 1 : (ENDED as readonly string[]).includes(s) ? 2 : 3);
      held.sort((a, b) => order(a.status) - order(b.status) || String(a.expiryDate ?? '9').localeCompare(String(b.expiryDate ?? '9')));
      return {
        asOf: new Date().toISOString(),
        completeness: warnings.length ? 'partial' : 'complete',
        warnings,
        totals: [...totals.values()],
        inForceCount: held.filter((p) => (IN_FORCE as readonly string[]).includes(p.status)).length,
        nextRenewal,
        policies: held,
        beneficiaryOf,
      };
    });
  });

  // ---- coverage ----
  async function lines(tx: Tx, ctx: RequestContext) {
    let rows = (await tx.query('SELECT id, key, label_en AS "labelEn", label_fr AS "labelFr", position FROM coverage_lines WHERE active ORDER BY position, key')).rows;
    const have = (await tx.query('SELECT 1 FROM coverage_lines LIMIT 1')).rowCount;
    if (!have) {
      // First use: the five default lines (decision 7). Tenant admins can rename, reorder or retire them later.
      for (const [i, [key, en, fr]] of DEFAULT_LINES.entries()) {
        await tx.query('INSERT INTO coverage_lines (tenant_id, key, label_en, label_fr, position) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [ctx.tenantId, key, en, fr, i]);
      }
      rows = (await tx.query('SELECT id, key, label_en AS "labelEn", label_fr AS "labelFr", position FROM coverage_lines WHERE active ORDER BY position, key')).rows;
    }
    return rows as { id: string; key: string; labelEn: string; labelFr: string }[];
  }
  app.get('/v1/coverage-lines', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => ({ lines: await lines(tx, ctx) }));
  });

  app.get('/v1/families/:id/coverage', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req, true);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const members = await familyMembers(tx, id);
      const ls = await lines(tx, ctx);
      const ids = members.map((m) => m.contact_id);
      const current = ids.length === 0 ? [] : (await tx.query(
        `SELECT a.id, a.contact_id, a.line_id, a.state, a.policy_id, p.plan_name, a.outside_coverage, a.needs_analysis_id, ar.title AS na_title,
                a.note, a.review_due_on::text AS review_due_on, a.assessed_at
           FROM coverage_assessments a
           LEFT JOIN policy_records p ON p.id = a.policy_id
           LEFT JOIN advice_records ar ON ar.id = a.needs_analysis_id
          WHERE a.contact_id = ANY ($1::uuid[]) AND a.superseded_at IS NULL`, [ids])).rows as any[];
      const today = new Date().toISOString().slice(0, 10);
      return {
        asOf: new Date().toISOString(),
        lines: ls,
        people: members.map((m) => ({
          contactId: m.contact_id, fullName: m.full_name, role: m.role, age: ageOn(m.date_of_birth),
          cells: ls.map((l) => {
            const a = current.find((x) => x.contact_id === m.contact_id && x.line_id === l.id);
            // No assessment is "unknown": missing data is never shown as a gap or a sales opportunity.
            if (!a) return { lineKey: l.key, state: 'unknown', evidence: null };
            return {
              lineKey: l.key, state: a.state, assessmentId: a.id, assessedAt: a.assessed_at, reviewDueOn: a.review_due_on,
              reviewOverdue: Boolean(a.review_due_on && a.review_due_on < today), note: a.note,
              evidence: a.policy_id ? { kind: 'policy', policyId: a.policy_id, label: a.plan_name } : a.needs_analysis_id ? { kind: 'needs_analysis', id: a.needs_analysis_id, label: a.na_title } : a.outside_coverage ? { kind: 'outside', label: a.outside_coverage } : null,
            };
          }),
        })),
      };
    });
  });

  // Evidence a person's coverage cell can point to: policies they own or are insured on, and signed needs analyses on their deals.
  app.get('/v1/people/:id/coverage-evidence', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM contacts WHERE id = $1', [id])).rowCount) throw notFound('Client not found');
      const policies = (await tx.query(
        `SELECT DISTINCT p.id, p.plan_name AS "planName", p.policy_number AS "policyNumber", p.status
           FROM policy_parties pp JOIN policy_records p ON p.id = pp.policy_id
          WHERE pp.contact_id = $1 AND pp.ended_at IS NULL AND pp.role IN ('owner', 'joint_owner', 'insured', 'joint_insured') AND policy_visible(p.id)`, [id])).rows;
      const analyses = (await tx.query(
        `SELECT DISTINCT a.id, a.title, a.signed_at AS "signedAt"
           FROM advice_records a
          WHERE a.kind = 'needs_analysis' AND a.status = 'signed'
            AND (EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = a.box_id AND bc.contact_id = $1)
                 OR EXISTS (SELECT 1 FROM deal_parties d WHERE d.box_id = a.box_id AND d.contact_id = $1 AND d.ended_at IS NULL))
          ORDER BY a.signed_at DESC`, [id])).rows;
      return { policies, analyses };
    });
  });

  app.post('/v1/people/:id/coverage', {
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['lineKey', 'state'],
        properties: {
          lineKey: { type: 'string', maxLength: 40 }, state: { type: 'string', enum: [...COVERAGE_STATES] }, policyId: uuid,
          outsideCoverage: { type: 'string', minLength: 1, maxLength: 300 }, needsAnalysisId: uuid, note: { type: 'string', maxLength: 500 },
          reviewDueOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { lineKey: string; state: string; policyId?: string; outsideCoverage?: string; needsAnalysisId?: string; note?: string; reviewDueOn?: string };
    if (b.state === 'covered' && !b.policyId && !b.outsideCoverage) throw invalid('"Covered" needs a policy on file or a description of the outside coverage');
    if (b.state === 'potential_gap' && !b.needsAnalysisId) throw invalid('A potential gap needs a signed needs analysis behind it');
    if (b.state !== 'covered' && (b.policyId || b.outsideCoverage)) throw invalid('A policy or outside coverage is evidence for "covered" only');
    if (b.state !== 'potential_gap' && b.needsAnalysisId) throw invalid('A needs analysis is evidence for a potential gap only');
    const out = await run(ctx, async (tx) => {
      const c = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM contacts WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Client not found');
      requireEdit(ctx, c.owner_node_id);
      const line = (await lines(tx, ctx)).find((l) => l.key === b.lineKey);
      if (!line) throw invalid('Unknown coverage line');
      if (b.policyId && !(await tx.query('SELECT 1 FROM policy_records p WHERE p.id = $1 AND policy_visible(p.id)', [b.policyId])).rowCount) throw notFound('Policy not found');
      await tx.query('UPDATE coverage_assessments SET superseded_at = now() WHERE contact_id = $1 AND line_id = $2 AND superseded_at IS NULL', [id, line.id]);
      const aid = randomUUID();
      await tx.query(
        `INSERT INTO coverage_assessments (id, tenant_id, contact_id, line_id, state, policy_id, outside_coverage, needs_analysis_id, note, review_due_on, assessed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [aid, ctx.tenantId, id, line.id, b.state, b.policyId ?? null, b.outsideCoverage?.trim() ?? null, b.needsAnalysisId ?? null, b.note?.trim() || null, b.reviewDueOn ?? null, ctx.userId]);
      // State and line only: coverage notes can describe health and stay out of the audit log.
      await audit(tx, ctx, 'coverage_assessed', 'contact', id, { line: b.lineKey, state: b.state, evidence: b.policyId ? 'policy' : b.needsAnalysisId ? 'needs_analysis' : b.outsideCoverage ? 'outside' : null }, c.owner_node_id);
      return { id: aid };
    });
    return reply.code(201).send(out);
  });

  // ---- carrier rule profiles (tenant admin) ----
  app.get('/v1/carrier-party-profiles', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => ({
      builtIn: DEFAULT_PROFILE,
      profiles: (await tx.query(
        `SELECT pr.carrier_id AS "carrierId", cd.display_name AS "carrierName", pr.requires_owner AS "requiresOwner", pr.requires_insured AS "requiresInsured",
                pr.allows_joint_owner AS "allowsJointOwner", pr.allows_joint_insured AS "allowsJointInsured", pr.allows_estate_beneficiary AS "allowsEstateBeneficiary",
                pr.allows_outside_beneficiary AS "allowsOutsideBeneficiary", pr.allows_equal_shares AS "allowsEqualShares", pr.allows_trustee AS "allowsTrustee",
                pr.confirmed_with_carrier AS "confirmedWithCarrier", pr.notes, pr.updated_at AS "updatedAt"
           FROM carrier_party_profiles pr LEFT JOIN carrier_directory cd ON cd.id = pr.carrier_id ORDER BY pr.carrier_id NULLS FIRST`)).rows,
    }));
  });
  const flag = { type: 'boolean' } as const;
  app.put('/v1/carrier-party-profiles/:carrierId', {
    schema: {
      params: { type: 'object', required: ['carrierId'], properties: { carrierId: { type: 'string', minLength: 1, maxLength: 80 } } },
      body: {
        type: 'object', additionalProperties: false,
        required: ['requiresOwner', 'requiresInsured', 'allowsJointOwner', 'allowsJointInsured', 'allowsEstateBeneficiary', 'allowsOutsideBeneficiary', 'allowsEqualShares', 'allowsTrustee', 'confirmedWithCarrier'],
        properties: { requiresOwner: flag, requiresInsured: flag, allowsJointOwner: flag, allowsJointInsured: flag, allowsEstateBeneficiary: flag, allowsOutsideBeneficiary: flag, allowsEqualShares: flag, allowsTrustee: flag, confirmedWithCarrier: flag, notes: { type: 'string', maxLength: 1000 } },
      },
    },
  }, async (req) => {
    const ctx = await begin(req);
    if (!ctx.isTenantAdmin) throw forbidden('Only a company administrator can change carrier rules');
    const { carrierId } = req.params as { carrierId: string };
    const b = req.body as CarrierProfile & { notes?: string };
    return run(ctx, async (tx) => {
      const cid = carrierId === 'default' ? null : carrierId;
      if (cid && !(await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [cid])).rowCount) throw notFound('Unknown carrier');
      await tx.query('DELETE FROM carrier_party_profiles WHERE coalesce(carrier_id, \'\') = coalesce($1, \'\')', [cid]);
      await tx.query(
        `INSERT INTO carrier_party_profiles (tenant_id, carrier_id, requires_owner, requires_insured, allows_joint_owner, allows_joint_insured, allows_estate_beneficiary,
           allows_outside_beneficiary, allows_equal_shares, allows_trustee, confirmed_with_carrier, notes, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ctx.tenantId, cid, b.requiresOwner, b.requiresInsured, b.allowsJointOwner, b.allowsJointInsured, b.allowsEstateBeneficiary, b.allowsOutsideBeneficiary, b.allowsEqualShares, b.allowsTrustee, b.confirmedWithCarrier, b.notes?.trim() || null, ctx.userId]);
      await audit(tx, ctx, 'carrier_party_profile_set', 'carrier', null, { carrierId: cid, ...b });
      return { ok: true };
    });
  });
}
