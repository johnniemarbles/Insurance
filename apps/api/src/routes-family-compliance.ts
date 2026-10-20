// Families, Gate C (regulated compliance): the per-person consent ledger and its reuse across deals, legal authority
// with independent verification, person-level ID references and rules, dated capacity rules, life events, and the
// review queue (coming of age, life events, withdrawals, authorities ending).
//
// Switch: FAMILIES_COMPLIANCE_ENABLED=1, and only together with FAMILIES_ENABLED=1. Off, every route here answers 404 and
// deal paperwork gates behave exactly as before. Decision 8: written Canadian legal and compliance sign-off is needed
// before this is switched on anywhere; the capacity ages are seeded unconfirmed and say so.
//
// Nothing here changes a policy, a beneficiary, an authority or a payout on its own. Reviews list what a person should
// look at; people decide. Audit entries carry purposes, kinds and outcomes, never notes or document details.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WORDING_VERSION, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { ageOn, familiesEnabled } from './routes-families.ts';
import { actingAs } from './effects.ts';
import {
  AUTHORITY_END_REASONS, AUTHORITY_KINDS, AUTHORITY_PURPOSES, CA_AGE_OF_MAJORITY, CAPACITY_ACTIVITIES, CHANNELS, DEAL_ROLES,
  ID_DOCUMENTS, ID_METHODS, ID_RESULTS, LIFE_EVENT_KINDS, PURPOSES, SEED_AUTHOR, STOPS_EMAIL,
  addDays, guardianAllowed, idStatus, lifeEventDueDays, looksLikeIdNumber, reachesAgeOn, reuseCheck, todayIso, underAge,
} from './family-compliance-rules.ts';
import type { AppDeps } from './app.ts';

export const familyComplianceEnabled = (): boolean =>
  familiesEnabled() && ['1', 'true'].includes(String(process.env.FAMILIES_COMPLIANCE_ENABLED ?? '').toLowerCase());

const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const jurisdiction = { type: 'string', pattern: '^(CA|US)-[A-Z]{2}$' } as const;
type Item = { type: 'family' | 'policy' | 'deal' | 'authority' | 'note'; id: string | null; label: string };

async function nameOf(tx: Tx, ctx: RequestContext): Promise<string> {
  return (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
}
async function person(tx: Tx, id: string) {
  const c = (await tx.query<{ id: string; full_name: string | null; owner_node_id: string; context_node_id: string | null; dob: string | null; deceased_on: string | null; jur: string | null }>(
    `SELECT id, full_name, owner_node_id, context_node_id, date_of_birth::text AS dob, deceased_on::text AS deceased_on, residence_jurisdiction AS jur
       FROM contacts WHERE id = $1`, [id])).rows[0];
  if (!c) throw notFound('Client not found');
  return c;
}

/** Statute ages of majority for a Canadian company, added once and marked unconfirmed. US companies get none. */
export async function ensureCapacityDefaults(tx: Tx, ctx: RequestContext): Promise<void> {
  if (!ctx.canWrite) return;
  const t = (await tx.query<{ country_code: string }>('SELECT country_code FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0];
  if (t?.country_code !== 'CA') return;
  const have = new Set((await tx.query<{ j: string }>(`SELECT DISTINCT jurisdiction AS j FROM capacity_rules WHERE activity = 'age_of_majority'`)).rows.map((r) => r.j));
  for (const [j, age] of Object.entries(CA_AGE_OF_MAJORITY)) {
    if (have.has(j)) continue;
    await tx.query(
      `INSERT INTO capacity_rules (tenant_id, jurisdiction, activity, min_age, effective_from, source_note, created_by_name)
       VALUES ($1, $2, 'age_of_majority', $3, DATE '1900-01-01', $4, $5) ON CONFLICT DO NOTHING`,
      [ctx.tenantId, j, age, `Age of majority statute, ${j.slice(3)}. Not yet confirmed by counsel.`, SEED_AUTHOR]);
  }
}

async function capacityFor(tx: Tx, jur: string | null, dob: string | null, today: string) {
  if (!jur) return { jurisdiction: null, rule: null, minor: null as boolean | null, reachesOn: null as string | null, leapDay: false };
  const r = (await tx.query<{ id: string | null; min_age: number | null; confirmed: boolean; source_note: string | null }>(
    `SELECT (x).id, (x).min_age, (x).counsel_confirmed_at IS NOT NULL AS confirmed, (x).source_note
       FROM (SELECT capacity_rule_on($1, 'age_of_majority', $2::date) AS x) s`, [jur, today])).rows[0];
  if (!r?.id) return { jurisdiction: jur, rule: null, minor: null, reachesOn: null, leapDay: false };
  const reach = dob ? reachesAgeOn(dob, r.min_age!) : null;
  return {
    jurisdiction: jur,
    rule: { id: r.id, minAge: r.min_age, counselConfirmed: r.confirmed, sourceNote: r.source_note },
    minor: underAge(dob, r.min_age, today), reachesOn: reach?.on ?? null, leapDay: reach?.leapDay ?? false,
  };
}

/** The records someone should look at when something changes for a person. Only what the caller can see is listed. */
async function affectedItems(tx: Tx, contactId: string): Promise<Item[]> {
  const items: Item[] = [];
  for (const r of (await tx.query<{ id: string; label: string }>(
    `SELECT f.id, f.display_name AS label FROM family_memberships m JOIN families f ON f.id = m.family_id
      WHERE m.contact_id = $1 AND m.ended_at IS NULL`, [contactId])).rows) items.push({ type: 'family', id: r.id, label: r.label });
  for (const r of (await tx.query<{ id: string; label: string }>(
    `SELECT p.id, concat_ws(' · ', p.carrier_id, p.plan_name, string_agg(DISTINCT pp.role, ', ')) AS label
       FROM policy_parties pp JOIN policy_records p ON p.id = pp.policy_id
      WHERE (pp.contact_id = $1 OR pp.insured_contact_id = $1) AND pp.ended_at IS NULL AND policy_visible(p.id)
      GROUP BY p.id, p.carrier_id, p.plan_name ORDER BY p.plan_name`, [contactId])).rows) items.push({ type: 'policy', id: r.id, label: r.label });
  for (const r of (await tx.query<{ id: string; label: string }>(
    `SELECT b.id, b.name AS label FROM boxes b JOIN stages s ON s.id = b.stage_id
      WHERE NOT s.is_won AND NOT s.is_lost
        AND (EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = b.id AND bc.contact_id = $1)
             OR EXISTS (SELECT 1 FROM deal_parties dp WHERE dp.box_id = b.id AND dp.contact_id = $1 AND dp.ended_at IS NULL))
      ORDER BY b.name LIMIT 50`, [contactId])).rows) items.push({ type: 'deal', id: r.id, label: r.label });
  for (const r of (await tx.query<{ id: string; label: string }>(
    `SELECT a.id, concat(replace(a.kind, '_', ' '), ': ', coalesce(h.full_name, a.holder_name), ' for ', s.full_name) AS label
       FROM legal_authorities a JOIN contacts s ON s.id = a.subject_contact_id LEFT JOIN contacts h ON h.id = a.holder_contact_id
      WHERE (a.subject_contact_id = $1 OR a.holder_contact_id = $1) AND a.ended_at IS NULL AND a.status <> 'rejected'`, [contactId])).rows)
    items.push({ type: 'authority', id: r.id, label: r.label });
  return items;
}

async function openReview(tx: Tx, ctx: RequestContext, c: { id: string; owner_node_id: string; context_node_id: string | null }, kind: string,
  link: { lifeEventId?: string; consentId?: string; authorityId?: string; ruleId?: string; milestoneOn?: string }, items: Item[], dueOn: string): Promise<string | null> {
  const id = randomUUID();
  const r = await tx.query(
    `INSERT INTO compliance_reviews (id, tenant_id, owner_node_id, context_node_id, contact_id, kind, life_event_id, consent_id, authority_id, rule_id, milestone_on, items, due_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
    [id, ctx.tenantId, c.owner_node_id, c.context_node_id, c.id, kind, link.lifeEventId ?? null, link.consentId ?? null, link.authorityId ?? null,
      link.ruleId ?? null, link.milestoneOn ?? null, JSON.stringify(items), dueOn]);
  return r.rowCount ? id : null;
}

const CONSENT_COLS = `pc.id, pc.contact_id AS "contactId", pc.purpose, pc.scope, pc.box_id AS "boxId", b.name AS "boxName",
  pc.notice_version AS "noticeVersion", pc.channel, pc.granted_on::text AS "grantedOn", pc.given_by AS "givenBy", pc.authority_id AS "authorityId",
  (pc.authority_id IS NULL OR authority_in_effect(pc.authority_id, pc.purpose, current_date)) AS "authorityInEffect",
  coalesce(ah.full_name, a.holder_name) AS "authorityHolder", a.kind AS "authorityKind",
  pc.capacity_reviewed_note IS NOT NULL AS "capacityReviewed", pc.recorded_by_name AS "recordedBy", pc.created_at AS "createdAt",
  pc.withdrawn_at AS "withdrawnAt", pc.withdrawn_on::text AS "withdrawnOn", pc.withdrawn_by_name AS "withdrawnBy", pc.withdrawal_channel AS "withdrawalChannel"`;
const CONSENT_FROM = `person_consents pc LEFT JOIN boxes b ON b.id = pc.box_id
  LEFT JOIN legal_authorities a ON a.id = pc.authority_id LEFT JOIN contacts ah ON ah.id = a.holder_contact_id`;
const AUTH_COLS = `a.id, a.subject_contact_id AS "subjectId", s.full_name AS "subjectName", a.holder_contact_id AS "holderContactId",
  coalesce(h.full_name, a.holder_name) AS "holderName", a.kind, a.purposes, a.starts_on::text AS "startsOn", a.ends_on::text AS "endsOn",
  a.evidence_description AS "evidenceDescription", a.evidence_document_id AS "evidenceDocumentId", a.status,
  a.recorded_by AS "recordedById", a.recorded_by_name AS "recordedBy", a.recorded_at AS "recordedAt", a.decided_by_name AS "decidedBy", a.decided_at AS "decidedAt",
  a.decision_note AS "decisionNote", a.ended_at AS "endedAt", a.end_reason AS "endReason", a.owner_node_id AS "ownerNodeId",
  (a.status = 'verified' AND a.ended_at IS NULL AND a.starts_on <= current_date AND (a.ends_on IS NULL OR a.ends_on >= current_date)) AS "inEffect"`;
const AUTH_FROM = `legal_authorities a JOIN contacts s ON s.id = a.subject_contact_id LEFT JOIN contacts h ON h.id = a.holder_contact_id`;

export function registerFamilyComplianceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!familyComplianceEnabled()) throw notFound();
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return ctx;
  };
  /** Compliance at or above the client's partner, or a tenant admin (the database checks the same). */
  const canVerify = async (tx: Tx, ctx: RequestContext, ownerNode: string) =>
    ctx.isTenantAdmin || (canWaive(ctx) && !!(await tx.query<{ ok: boolean }>('SELECT app_is_compliance_at_or_above($1, $2) AS ok', [ctx.tenantId, ownerNode])).rows[0]?.ok);

  // ---------------------------------------------------------------- the person's compliance view
  app.get('/v1/people/:id/compliance', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await ensureCapacityDefaults(tx, ctx);
      const c = await person(tx, id);
      const today = todayIso();
      const consents = (await tx.query(`SELECT ${CONSENT_COLS},
          (SELECT coalesce(json_agg(json_build_object('boxId', u.box_id, 'boxName', ub.name) ORDER BY u.used_at), '[]')
             FROM consent_uses u JOIN boxes ub ON ub.id = u.box_id WHERE u.consent_id = pc.id) AS uses
        FROM ${CONSENT_FROM} WHERE pc.contact_id = $1 ORDER BY pc.withdrawn_at IS NOT NULL, pc.purpose, pc.created_at DESC`, [id])).rows;
      const about = (await tx.query(`SELECT ${AUTH_COLS} FROM ${AUTH_FROM} WHERE a.subject_contact_id = $1 ORDER BY a.ended_at IS NOT NULL, a.recorded_at DESC`, [id])).rows;
      const held = (await tx.query(`SELECT ${AUTH_COLS} FROM ${AUTH_FROM} WHERE a.holder_contact_id = $1 ORDER BY a.ended_at IS NOT NULL, a.recorded_at DESC`, [id])).rows;
      const ids = (await tx.query(
        `SELECT id, method, documents_seen AS "documentsSeen", result, checked_on::text AS "checkedOn", checked_by_name AS "checkedBy", note, created_at AS "createdAt"
           FROM identity_references WHERE contact_id = $1 ORDER BY checked_on DESC, created_at DESC LIMIT 50`, [id])).rows;
      // Older ID checks recorded on a deal, before person-level references. Shown as they are; never copied or relabelled.
      const dealIds = (await tx.query(
        `SELECT r.id, r.method, r.result, r.verified_on::text AS "checkedOn", r.verifier_name AS "checkedBy", b.id AS "boxId", b.name AS "boxName"
           FROM client_id_records r JOIN boxes b ON b.id = r.box_id
          WHERE EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = r.box_id AND bc.contact_id = $1)
          ORDER BY r.verified_on DESC LIMIT 20`, [id])).rows;
      const events = (await tx.query(
        `SELECT id, kind, occurred_on::text AS "occurredOn", note, recorded_by_name AS "recordedBy", created_at AS "createdAt"
           FROM life_events WHERE contact_id = $1 ORDER BY occurred_on DESC, created_at DESC LIMIT 50`, [id])).rows;
      const reviews = (await tx.query(
        `SELECT id, kind, items, due_on::text AS "dueOn", milestone_on::text AS "milestoneOn", opened_at AS "openedAt",
                resolved_at AS "resolvedAt", resolved_by_name AS "resolvedBy", resolution_note AS "resolutionNote"
           FROM compliance_reviews WHERE contact_id = $1 ORDER BY resolved_at IS NOT NULL, due_on LIMIT 50`, [id])).rows;
      return {
        person: { id: c.id, fullName: c.full_name, dateOfBirth: c.dob, age: ageOn(c.dob), deceasedOn: c.deceased_on, residenceJurisdiction: c.jur },
        capacity: await capacityFor(tx, c.jur, c.dob, today),
        noticeVersion: WORDING_VERSION,
        consents, authorities: { about, held }, idReferences: ids, dealIdRecords: dealIds, lifeEvents: events, reviews,
        canEdit: ctx.isTenantAdmin || ctx.nodeIds.includes(c.owner_node_id),
        canVerify: await canVerify(tx, ctx, c.owner_node_id),
      };
    });
  });

  app.patch('/v1/people/:id/residence', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['jurisdiction'], properties: { jurisdiction: { anyOf: [jurisdiction, { type: 'null' }] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { jurisdiction: j } = req.body as { jurisdiction: string | null };
    return run(ctx, async (tx) => {
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      await tx.query('UPDATE contacts SET residence_jurisdiction = $2 WHERE id = $1', [id, j]);
      await audit(tx, ctx, 'person_residence_set', 'contact', id, { jurisdiction: j }, c.owner_node_id);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- consents
  app.post('/v1/people/:id/consents', {
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['purpose', 'scope', 'channel', 'grantedOn', 'givenBy'],
        properties: {
          purpose: { type: 'string', enum: [...PURPOSES] }, scope: { type: 'string', enum: ['all_dealings', 'deal'] }, boxId: uuid,
          channel: { type: 'string', enum: [...CHANNELS] }, grantedOn: date, givenBy: { type: 'string', enum: ['self', 'authority'] }, authorityId: uuid,
          capacityReviewedNote: { type: 'string', minLength: 10, maxLength: 500 }, evidenceDocumentId: uuid, note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { purpose: string; scope: 'all_dealings' | 'deal'; boxId?: string; channel: string; grantedOn: string; givenBy: 'self' | 'authority';
      authorityId?: string; capacityReviewedNote?: string; evidenceDocumentId?: string; note?: string };
    if ((b.scope === 'deal') !== !!b.boxId) throw invalid('A consent for one deal names that deal; a consent for all dealings does not');
    if ((b.givenBy === 'authority') !== !!b.authorityId) throw invalid('A consent given by someone else names the authority they acted under');
    const today = todayIso();
    if (b.grantedOn > today) throw invalid('A consent cannot be dated in the future');
    const out = await run(ctx, async (tx) => {
      await ensureCapacityDefaults(tx, ctx);
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      if (c.deceased_on) throw invalid('This client has a date of death recorded; consent cannot be recorded for them');
      if (b.boxId && !(await tx.query('SELECT 1 FROM boxes WHERE id = $1', [b.boxId])).rowCount) throw notFound('Deal not found');
      if (b.givenBy === 'self') {
        const cap = await capacityFor(tx, c.jur, c.dob, b.grantedOn);
        if (cap.minor === true && !b.capacityReviewedNote) {
          throw invalid(`${c.full_name ?? 'This client'} is under ${cap.rule!.minAge}, the age of majority in ${cap.jurisdiction} (${cap.rule!.counselConfirmed ? 'confirmed by counsel' : 'not yet confirmed by counsel'}). Record the consent from a verified guardian, or record why their own consent was accepted after review.`);
        }
        if (b.capacityReviewedNote && cap.minor !== true) throw invalid('A capacity review note is only for someone under the age of majority');
      } else if (b.capacityReviewedNote) {
        throw invalid('A capacity review note is only for someone consenting themselves');
      }
      const cid = randomUUID();
      await tx.query(
        `INSERT INTO person_consents (id, tenant_id, owner_node_id, context_node_id, contact_id, purpose, scope, box_id, notice_version, channel, granted_on,
           given_by, authority_id, capacity_reviewed_note, evidence_document_id, note, recorded_by, recorded_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [cid, ctx.tenantId, c.owner_node_id, c.context_node_id, id, b.purpose, b.scope, b.boxId ?? null, WORDING_VERSION, b.channel, b.grantedOn,
          b.givenBy, b.authorityId ?? null, b.capacityReviewedNote?.trim() ?? null, b.evidenceDocumentId ?? null, b.note?.trim() || null, ctx.userId, await nameOf(tx, ctx)]);
      // A one-deal consent is used by that deal straight away.
      if (b.boxId) await tx.query('INSERT INTO consent_uses (tenant_id, consent_id, box_id, used_by) VALUES ($1,$2,$3,$4)', [ctx.tenantId, cid, b.boxId, ctx.userId]);
      await audit(tx, ctx, 'person_consent_given', 'contact', id,
        { purpose: b.purpose, scope: b.scope, givenBy: b.givenBy, noticeVersion: WORDING_VERSION, capacityReviewed: !!b.capacityReviewedNote }, c.owner_node_id);
      return { id: cid };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/people/:id/consents/:consentId/withdraw', {
    schema: {
      params: { type: 'object', required: ['id', 'consentId'], properties: { id: uuid, consentId: uuid } },
      body: { type: 'object', additionalProperties: false, required: ['withdrawnOn', 'channel'], properties: {
        withdrawnOn: date, channel: { type: 'string', enum: [...CHANNELS, 'letter'] }, note: { type: 'string', maxLength: 500 } } },
    },
  }, async (req) => {
    const ctx = await begin(req);
    const { id, consentId } = req.params as { id: string; consentId: string };
    const b = req.body as { withdrawnOn: string; channel: string; note?: string };
    if (b.withdrawnOn > todayIso()) throw invalid('A withdrawal cannot be dated in the future');
    return run(ctx, async (tx) => {
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      const pc = (await tx.query<{ purpose: string; granted_on: string }>('SELECT purpose, granted_on::text FROM person_consents WHERE id = $1 AND contact_id = $2', [consentId, id])).rows[0];
      if (!pc) throw notFound('Consent not found');
      if (b.withdrawnOn < pc.granted_on) throw invalid('A withdrawal cannot be dated before the consent was given');
      const done = await tx.query(
        `UPDATE person_consents SET withdrawn_at = now(), withdrawn_on = $2, withdrawn_by_name = $3, withdrawal_channel = $4, withdrawn_note = $5
          WHERE id = $1 AND withdrawn_at IS NULL`, [consentId, b.withdrawnOn, await nameOf(tx, ctx), b.channel, b.note?.trim() || null]);
      if (!done.rowCount) throw invalid('This consent has already been withdrawn');
      // Stop what depended on it: email for marketing and electronic messages, and every deal that relied on it gets a task.
      let emailStopped = false;
      if ((STOPS_EMAIL as readonly string[]).includes(pc.purpose)) {
        emailStopped = !!(await tx.query('UPDATE contacts SET email_opt_out_at = now() WHERE id = $1 AND email_opt_out_at IS NULL', [id])).rowCount;
      }
      const deals = (await tx.query<{ id: string; name: string; owner_node_id: string; context_node_id: string | null; owner_user_id: string | null }>(
        `SELECT b.id, b.name, b.owner_node_id, b.context_node_id, b.owner_user_id FROM consent_uses u JOIN boxes b ON b.id = u.box_id WHERE u.consent_id = $1`, [consentId])).rows;
      for (const d of deals) {
        await tx.query('INSERT INTO tasks (tenant_id, box_id, owner_node_id, context_node_id, assignee_id, title, due_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
          [ctx.tenantId, d.id, d.owner_node_id, d.context_node_id, d.owner_user_id, `Consent withdrawn by ${c.full_name ?? 'a client'} (${pc.purpose.replace(/_/g, ' ')}): review this deal`.slice(0, 300)]);
      }
      const reviewId = await openReview(tx, ctx, c, 'consent_withdrawn', { consentId },
        deals.map((d) => ({ type: 'deal' as const, id: d.id, label: d.name })), addDays(todayIso(), 7));
      await audit(tx, ctx, 'person_consent_withdrawn', 'contact', id, { purpose: pc.purpose, deals: deals.length, emailStopped }, c.owner_node_id);
      return { ok: true, dealsFlagged: deals.length, emailStopped, reviewId };
    });
  });

  // ---------------------------------------------------------------- consent on a deal: who is covered, what can be reused
  app.get('/v1/boxes/:id/person-compliance', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const box = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!box) throw notFound('Deal not found');
      const today = todayIso();
      const people = (await tx.query<{ id: string; fullName: string | null; roles: string[] }>(
        `SELECT c.id, c.full_name AS "fullName",
                coalesce(array_agg(DISTINCT dp.role) FILTER (WHERE dp.role IS NOT NULL), '{}') AS roles
           FROM contacts c
           LEFT JOIN deal_parties dp ON dp.contact_id = c.id AND dp.box_id = $1 AND dp.ended_at IS NULL
          WHERE EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = $1 AND bc.contact_id = c.id)
             OR EXISTS (SELECT 1 FROM deal_parties d2 WHERE d2.box_id = $1 AND d2.contact_id = c.id AND d2.ended_at IS NULL)
          GROUP BY c.id, c.full_name ORDER BY c.full_name`, [id])).rows;
      const rules = (await tx.query<{ dealRole: string; required: boolean; validMonths: number | null }>(
        'SELECT deal_role AS "dealRole", required, valid_months AS "validMonths" FROM id_check_rules')).rows;
      const out = [];
      for (const p of people) {
        const roles = p.roles.length ? p.roles : ['applicant']; // a client on the deal with no role recorded is treated as an applicant
        const all = (await tx.query<{ id: string; purpose: string; scope: 'all_dealings' | 'deal'; boxId: string | null; noticeVersion: string; withdrawnAt: string | null;
          givenBy: 'self' | 'authority'; authorityInEffect: boolean; grantedOn: string; used: boolean; authorityHolder: string | null }>(
          `SELECT ${CONSENT_COLS}, EXISTS (SELECT 1 FROM consent_uses u WHERE u.consent_id = pc.id AND u.box_id = $2) AS used
             FROM ${CONSENT_FROM} WHERE pc.contact_id = $1 ORDER BY pc.created_at DESC`, [p.id, id])).rows;
        const purposes = PURPOSES.map((purpose) => {
          const mine = all.filter((x) => x.purpose === purpose);
          const used = mine.find((x) => x.used && !x.withdrawnAt && x.authorityInEffect && (x.scope === 'all_dealings' || x.boxId === id));
          const candidates = mine.filter((x) => !x.used).map((x) => ({ id: x.id, grantedOn: x.grantedOn, scope: x.scope, givenBy: x.givenBy, authorityHolder: x.authorityHolder,
            ...reuseCheck(x, { purpose, boxId: id, noticeVersion: WORDING_VERSION }) }))
            .filter((x) => x.ok || !x.reasons.includes('withdrawn'));
          return { purpose, inForce: used ? { id: used.id, grantedOn: used.grantedOn, givenBy: used.givenBy, authorityHolder: used.authorityHolder } : null, candidates };
        });
        const latest = (await tx.query<{ result: string; checkedOn: string }>(
          'SELECT result, checked_on::text AS "checkedOn" FROM identity_references WHERE contact_id = $1 ORDER BY checked_on DESC, created_at DESC LIMIT 1', [p.id])).rows[0] ?? null;
        const lastOk = (await tx.query<{ d: string | null }>("SELECT max(checked_on)::text AS d FROM identity_references WHERE contact_id = $1 AND result = 'verified'", [p.id])).rows[0]!.d;
        out.push({ contactId: p.id, fullName: p.fullName, roles, purposes, id: { ...idStatus(roles, rules, latest, lastOk, today), lastVerifiedOn: lastOk } });
      }
      const legacy = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM client_consents WHERE box_id = $1', [id])).rows[0]!.n;
      return { noticeVersion: WORDING_VERSION, people: out, dealLevelConsents: legacy, idRulesSet: rules.length > 0, canEdit: ctx.isTenantAdmin || ctx.nodeIds.includes(box.owner_node_id) };
    });
  });

  app.post('/v1/boxes/:id/consent-uses', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['consentId'], properties: { consentId: uuid } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { consentId } = req.body as { consentId: string };
    const out = await run(ctx, async (tx) => {
      const box = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!box) throw notFound('Deal not found');
      requireEdit(ctx, box.owner_node_id);
      const c = (await tx.query<{ purpose: string; scope: 'all_dealings' | 'deal'; boxId: string | null; noticeVersion: string; withdrawnAt: string | null;
        givenBy: 'self' | 'authority'; authorityInEffect: boolean; contactId: string }>(`SELECT ${CONSENT_COLS} FROM ${CONSENT_FROM} WHERE pc.id = $1`, [consentId])).rows[0];
      if (!c) throw notFound('Consent not found');
      const check = reuseCheck(c, { purpose: c.purpose, boxId: id, noticeVersion: WORDING_VERSION });
      if (!check.ok) throw invalid(`This consent cannot be used for this deal: ${check.reasons.join('; ')}. Record a new consent instead.`);
      const uid = randomUUID();
      await tx.query('INSERT INTO consent_uses (id, tenant_id, consent_id, box_id, used_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (consent_id, box_id) DO NOTHING',
        [uid, ctx.tenantId, consentId, id, ctx.userId]);
      await audit(tx, ctx, 'person_consent_used', 'box', id, { purpose: c.purpose, contactId: c.contactId }, box.owner_node_id);
      return { id: uid };
    });
    return reply.code(201).send(out);
  });

  // ---------------------------------------------------------------- legal authority
  app.post('/v1/people/:id/authorities', {
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['kind', 'purposes', 'startsOn', 'evidenceDescription'],
        properties: {
          holderContactId: uuid, holderName: { type: 'string', minLength: 2, maxLength: 200 }, kind: { type: 'string', enum: [...AUTHORITY_KINDS] },
          purposes: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { type: 'string', enum: [...AUTHORITY_PURPOSES] } },
          startsOn: date, endsOn: date, evidenceDescription: { type: 'string', minLength: 10, maxLength: 500 }, evidenceDocumentId: uuid,
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { holderContactId?: string; holderName?: string; kind: string; purposes: string[]; startsOn: string; endsOn?: string; evidenceDescription: string; evidenceDocumentId?: string };
    if (!!b.holderContactId === !!b.holderName?.trim()) throw invalid('Name the holder: a client, or someone outside PII by name');
    if (b.holderContactId === id) throw invalid('A person cannot hold an authority over themselves');
    if (b.endsOn && b.endsOn < b.startsOn) throw invalid('The end date is before the start date');
    if (looksLikeIdNumber(b.evidenceDescription)) throw invalid('Describe the evidence without document or file numbers');
    const out = await run(ctx, async (tx) => {
      await ensureCapacityDefaults(tx, ctx);
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      const cap = await capacityFor(tx, c.jur, c.dob, todayIso());
      if (!guardianAllowed(b.kind, cap.minor)) throw invalid(`A guardian of a minor needs the person to be under ${cap.rule!.minAge}, the age of majority in ${cap.jurisdiction}`);
      if (b.holderContactId) {
        const h = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM contacts WHERE id = $1', [b.holderContactId])).rows[0];
        if (!h) throw notFound('Holder not found');
        if (h.owner_node_id !== c.owner_node_id) throw invalid('The holder must be a client of the same partner, or entered by name');
      }
      const aid = randomUUID();
      await tx.query(
        `INSERT INTO legal_authorities (id, tenant_id, owner_node_id, context_node_id, subject_contact_id, holder_contact_id, holder_name, kind, purposes, starts_on, ends_on,
           evidence_description, evidence_document_id, recorded_by, recorded_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [aid, ctx.tenantId, c.owner_node_id, c.context_node_id, id, b.holderContactId ?? null, b.holderName?.trim() || null, b.kind, b.purposes, b.startsOn, b.endsOn ?? null,
          b.evidenceDescription.trim(), b.evidenceDocumentId ?? null, ctx.userId, await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'legal_authority_recorded', 'contact', id, { kind: b.kind, purposes: b.purposes, holder: b.holderContactId ? 'client' : 'outside' }, c.owner_node_id);
      return { id: aid, status: 'pending' };
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/authorities/pending', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ ownerNodeId: string; recordedById: string }>(
        `SELECT ${AUTH_COLS} FROM ${AUTH_FROM} WHERE a.status = 'pending' AND a.ended_at IS NULL ORDER BY a.recorded_at LIMIT 200`)).rows;
      const mine = [];
      for (const r of rows) if (r.recordedById !== ctx.userId && (await canVerify(tx, ctx, r.ownerNodeId))) mine.push(r);
      return { authorities: mine };
    });
  });

  app.post('/v1/authorities/:id/decide', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['decision', 'note'], properties: {
      decision: { type: 'string', enum: ['verified', 'rejected'] }, note: { type: 'string', minLength: 5, maxLength: 500 } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { decision: 'verified' | 'rejected'; note: string };
    return run(ctx, async (tx) => {
      const a = (await tx.query<{ owner_node_id: string; recorded_by: string; status: string; ended_at: string | null; subject_contact_id: string; kind: string }>(
        'SELECT owner_node_id, recorded_by, status, ended_at, subject_contact_id, kind FROM legal_authorities WHERE id = $1', [id])).rows[0];
      if (!a) throw notFound('Authority not found');
      if (a.recorded_by === ctx.userId) throw forbidden('The person who recorded an authority cannot verify it; another compliance user must');
      if (!(await canVerify(tx, ctx, a.owner_node_id))) throw forbidden('Only compliance for this partner, or a tenant admin, can verify an authority');
      if (a.status !== 'pending' || a.ended_at) throw invalid('This authority has already been decided');
      await tx.query(`UPDATE legal_authorities SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = now(), decision_note = $5 WHERE id = $1`,
        [id, b.decision, ctx.userId, await nameOf(tx, ctx), b.note.trim()]);
      await audit(tx, ctx, `legal_authority_${b.decision}`, 'contact', a.subject_contact_id, { authorityId: id, kind: a.kind }, a.owner_node_id);
      return { ok: true, status: b.decision };
    });
  });

  app.post('/v1/authorities/:id/end', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', enum: [...AUTHORITY_END_REASONS] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason: string };
    return run(ctx, async (tx) => {
      const a = (await tx.query<{ owner_node_id: string; subject_contact_id: string; kind: string }>(
        'SELECT owner_node_id, subject_contact_id, kind FROM legal_authorities WHERE id = $1', [id])).rows[0];
      if (!a) throw notFound('Authority not found');
      if (!(ctx.isTenantAdmin || ctx.nodeIds.includes(a.owner_node_id) || (await canVerify(tx, ctx, a.owner_node_id)))) throw forbidden('Only the client\'s partner or compliance can end an authority');
      const done = await tx.query('UPDATE legal_authorities SET ended_at = now(), ended_by_name = $2, end_reason = $3 WHERE id = $1 AND ended_at IS NULL',
        [id, await nameOf(tx, ctx), reason]);
      if (!done.rowCount) throw invalid('This authority has already ended');
      // Consents given under it stop counting at once (the database works that out); the partner reviews what relied on them.
      const items = (await tx.query<{ id: string; label: string }>(
        `SELECT DISTINCT b.id, b.name AS label FROM person_consents pc JOIN consent_uses u ON u.consent_id = pc.id JOIN boxes b ON b.id = u.box_id
          WHERE pc.authority_id = $1 AND pc.withdrawn_at IS NULL`, [id])).rows.map((r) => ({ type: 'deal' as const, ...r }));
      const c = await person(tx, a.subject_contact_id);
      const reviewId = items.length ? await openReview(tx, ctx, c, 'authority_ending', { authorityId: id }, items, addDays(todayIso(), 7)) : null;
      await audit(tx, ctx, 'legal_authority_ended', 'contact', a.subject_contact_id, { authorityId: id, kind: a.kind, reason, dealsAffected: items.length }, a.owner_node_id);
      return { ok: true, dealsAffected: items.length, reviewId };
    });
  });

  // ---------------------------------------------------------------- ID references and rules
  app.post('/v1/people/:id/id-references', {
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['method', 'result', 'checkedOn'], properties: {
        method: { type: 'string', enum: [...ID_METHODS] }, result: { type: 'string', enum: [...ID_RESULTS] }, checkedOn: date,
        documentsSeen: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: [...ID_DOCUMENTS] } },
        evidenceDocumentId: uuid, note: { type: 'string', maxLength: 300 } } },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { method: string; result: string; checkedOn: string; documentsSeen?: string[]; evidenceDocumentId?: string; note?: string };
    if (looksLikeIdNumber(b.note)) throw invalid('Do not put document numbers in the note. PII records what was checked, not the number on it.');
    if (b.checkedOn > todayIso()) throw invalid('A check cannot be dated in the future');
    const out = await run(ctx, async (tx) => {
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      const rid = randomUUID();
      await tx.query(
        `INSERT INTO identity_references (id, tenant_id, owner_node_id, context_node_id, contact_id, method, documents_seen, result, checked_on, checked_by, checked_by_name, evidence_document_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [rid, ctx.tenantId, c.owner_node_id, c.context_node_id, id, b.method, b.documentsSeen ?? [], b.result, b.checkedOn, ctx.userId, await nameOf(tx, ctx),
          b.evidenceDocumentId ?? null, b.note?.trim() || null]);
      await audit(tx, ctx, 'identity_reference_recorded', 'contact', id, { method: b.method, result: b.result }, c.owner_node_id);
      return { id: rid };
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/id-check-rules', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => ({
      rules: (await tx.query(`SELECT deal_role AS "dealRole", required, valid_months AS "validMonths", note, set_by_name AS "setBy", updated_at AS "updatedAt" FROM id_check_rules ORDER BY deal_role`)).rows,
      roles: DEAL_ROLES, canChange: ctx.isTenantAdmin || canWaive(ctx),
    }));
  });
  app.put('/v1/id-check-rules/:role', {
    schema: {
      params: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: [...DEAL_ROLES] } } },
      body: { type: 'object', additionalProperties: false, required: ['required'], properties: {
        required: { type: 'boolean' }, validMonths: { anyOf: [{ type: 'integer', minimum: 1, maximum: 120 }, { type: 'null' }] }, note: { type: 'string', maxLength: 300 } } },
    },
  }, async (req) => {
    const ctx = await begin(req);
    if (!(ctx.isTenantAdmin || canWaive(ctx))) throw forbidden('Only compliance or a tenant admin can set ID rules');
    const { role } = req.params as { role: string };
    const b = req.body as { required: boolean; validMonths?: number | null; note?: string };
    return run(ctx, async (tx) => {
      await tx.query(
        `INSERT INTO id_check_rules (tenant_id, deal_role, required, valid_months, note, set_by_name) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, deal_role) DO UPDATE SET required = EXCLUDED.required, valid_months = EXCLUDED.valid_months, note = EXCLUDED.note,
           set_by_name = EXCLUDED.set_by_name, updated_at = now()`,
        [ctx.tenantId, role, b.required, b.validMonths ?? null, b.note?.trim() || null, await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'id_check_rule_set', 'tenant', ctx.tenantId, { role, required: b.required, validMonths: b.validMonths ?? null });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- capacity rules
  app.get('/v1/capacity-rules', async (req) => {
    const ctx = await begin(req);
    return run(ctx, async (tx) => {
      await ensureCapacityDefaults(tx, ctx);
      return {
        rules: (await tx.query(
          `SELECT id, jurisdiction, activity, min_age AS "minAge", effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo", source_note AS "sourceNote",
                  counsel_confirmed_at AS "counselConfirmedAt", counsel_confirmed_by AS "counselConfirmedBy", created_by_name AS "createdBy"
             FROM capacity_rules ORDER BY jurisdiction, activity, effective_from DESC`)).rows,
        activities: CAPACITY_ACTIVITIES, canChange: ctx.isTenantAdmin || canWaive(ctx),
      };
    });
  });
  app.post('/v1/capacity-rules', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['jurisdiction', 'activity', 'minAge', 'effectiveFrom', 'sourceNote'], properties: {
      jurisdiction, activity: { type: 'string', enum: [...CAPACITY_ACTIVITIES] }, minAge: { type: 'integer', minimum: 0, maximum: 25 }, effectiveFrom: date,
      sourceNote: { type: 'string', minLength: 3, maxLength: 300 } } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    if (!(ctx.isTenantAdmin || canWaive(ctx))) throw forbidden('Only compliance or a tenant admin can change capacity rules');
    const b = req.body as { jurisdiction: string; activity: string; minAge: number; effectiveFrom: string; sourceNote: string };
    const out = await run(ctx, async (tx) => {
      // A new rule closes the one before it the day before it starts; past rules are kept for the dates they covered.
      const prev = await tx.query<{ effective_from: string }>(
        `SELECT effective_from::text FROM capacity_rules WHERE jurisdiction = $1 AND activity = $2 AND effective_to IS NULL`, [b.jurisdiction, b.activity]);
      if (prev.rows.some((p) => p.effective_from >= b.effectiveFrom)) throw invalid('A rule for this jurisdiction and activity already starts on or after that date');
      await tx.query(`UPDATE capacity_rules SET effective_to = $3::date - 1 WHERE jurisdiction = $1 AND activity = $2 AND effective_to IS NULL`, [b.jurisdiction, b.activity, b.effectiveFrom]);
      const rid = randomUUID();
      await tx.query(`INSERT INTO capacity_rules (id, tenant_id, jurisdiction, activity, min_age, effective_from, source_note, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rid, ctx.tenantId, b.jurisdiction, b.activity, b.minAge, b.effectiveFrom, b.sourceNote.trim(), await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'capacity_rule_added', 'tenant', ctx.tenantId, { jurisdiction: b.jurisdiction, activity: b.activity, minAge: b.minAge, effectiveFrom: b.effectiveFrom });
      return { id: rid };
    });
    return reply.code(201).send(out);
  });
  app.post('/v1/capacity-rules/:id/confirm', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['counsel'], properties: { counsel: { type: 'string', minLength: 2, maxLength: 200 } } } },
  }, async (req) => {
    const ctx = await begin(req);
    if (!(ctx.isTenantAdmin || canWaive(ctx))) throw forbidden('Only compliance or a tenant admin can record counsel\'s confirmation');
    const { id } = req.params as { id: string };
    const { counsel } = req.body as { counsel: string };
    return run(ctx, async (tx) => {
      const done = await tx.query('UPDATE capacity_rules SET counsel_confirmed_at = now(), counsel_confirmed_by = $2 WHERE id = $1 AND counsel_confirmed_at IS NULL', [id, counsel.trim()]);
      if (!done.rowCount) throw invalid('That rule was not found or is already confirmed');
      await audit(tx, ctx, 'capacity_rule_confirmed', 'tenant', ctx.tenantId, { ruleId: id });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- life events
  app.post('/v1/people/:id/life-events', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['kind', 'occurredOn'], properties: {
      kind: { type: 'string', enum: [...LIFE_EVENT_KINDS] }, occurredOn: date, note: { type: 'string', maxLength: 500 } } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { kind: string; occurredOn: string; note?: string };
    if (b.occurredOn > todayIso()) throw invalid('A life event cannot be dated in the future');
    const out = await run(ctx, async (tx) => {
      const c = await person(tx, id);
      requireEdit(ctx, c.owner_node_id);
      const eid = randomUUID();
      await tx.query(`INSERT INTO life_events (id, tenant_id, owner_node_id, context_node_id, contact_id, kind, occurred_on, note, recorded_by, recorded_by_name)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [eid, ctx.tenantId, c.owner_node_id, c.context_node_id, id, b.kind, b.occurredOn, b.note?.trim() || null, ctx.userId, await nameOf(tx, ctx)]);
      // Nothing else changes: no membership, policy, beneficiary, authority or payout is touched. A review lists what to look at.
      const items = await affectedItems(tx, id);
      const reviewId = await openReview(tx, ctx, c, 'life_event', { lifeEventId: eid }, items, addDays(todayIso(), lifeEventDueDays(b.kind)));
      await audit(tx, ctx, 'life_event_recorded', 'contact', id, { kind: b.kind, items: items.length }, c.owner_node_id);
      return { id: eid, reviewId, items };
    });
    return reply.code(201).send(out);
  });

  // ---------------------------------------------------------------- reviews
  app.get('/v1/compliance-reviews', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['open', 'resolved'] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { status = 'open' } = req.query as { status?: 'open' | 'resolved' };
    return run(ctx, async (tx) => ({
      reviews: (await tx.query(
        `SELECT r.id, r.kind, r.contact_id AS "contactId", c.full_name AS "fullName", r.items, r.due_on::text AS "dueOn", r.milestone_on::text AS "milestoneOn",
                le.kind AS "lifeEventKind", pc.purpose AS "consentPurpose", r.opened_at AS "openedAt", r.resolved_at AS "resolvedAt", r.resolved_by_name AS "resolvedBy",
                r.resolution_note AS "resolutionNote", (r.due_on < current_date AND r.resolved_at IS NULL) AS overdue
           FROM compliance_reviews r JOIN contacts c ON c.id = r.contact_id
           LEFT JOIN life_events le ON le.id = r.life_event_id LEFT JOIN person_consents pc ON pc.id = r.consent_id
          WHERE ($1 = 'open') = (r.resolved_at IS NULL) ORDER BY r.due_on, r.opened_at LIMIT 200`, [status])).rows,
    }));
  });
  app.post('/v1/compliance-reviews/:id/resolve', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', minLength: 5, maxLength: 500 } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { note } = req.body as { note: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query<{ owner_node_id: string; contact_id: string; kind: string }>('SELECT owner_node_id, contact_id, kind FROM compliance_reviews WHERE id = $1', [id])).rows[0];
      if (!r) throw notFound('Review not found');
      if (!(ctx.isTenantAdmin || ctx.nodeIds.includes(r.owner_node_id) || (await canVerify(tx, ctx, r.owner_node_id)))) throw forbidden('Only the client\'s partner or compliance can resolve this review');
      const done = await tx.query('UPDATE compliance_reviews SET resolved_at = now(), resolved_by_name = $2, resolution_note = $3 WHERE id = $1 AND resolved_at IS NULL',
        [id, await nameOf(tx, ctx), note.trim()]);
      if (!done.rowCount) throw invalid('This review is already resolved');
      await audit(tx, ctx, 'compliance_review_resolved', 'contact', r.contact_id, { reviewId: id, kind: r.kind }, r.owner_node_id);
      return { ok: true };
    });
  });
  // Run the coming-of-age and authority-ending checks now for this company (a tenant admin; the background job does this daily).
  app.post('/v1/compliance-reviews/run', async (req) => {
    const ctx = await begin(req);
    if (!ctx.isTenantAdmin) throw forbidden('Only a tenant admin can run the review checks');
    return { opened: await run(ctx, (tx) => openDueReviews(tx, ctx)) };
  });

  // ---------------------------------------------------------------- family summary
  app.get('/v1/families/:id/compliance', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM families WHERE id = $1', [id])).rowCount) throw notFound('Family not found');
      await ensureCapacityDefaults(tx, ctx);
      const today = todayIso();
      const members = (await tx.query<{ contactId: string; fullName: string | null; role: string; dob: string | null; jur: string | null; deceasedOn: string | null }>(
        `SELECT c.id AS "contactId", c.full_name AS "fullName", m.role, c.date_of_birth::text AS dob, c.residence_jurisdiction AS jur, c.deceased_on::text AS "deceasedOn"
           FROM family_memberships m JOIN contacts c ON c.id = m.contact_id WHERE m.family_id = $1 AND m.ended_at IS NULL ORDER BY c.full_name`, [id])).rows;
      const out = [];
      for (const m of members) {
        const s = (await tx.query<{ purposes: string[]; authorities: number; pending: number; idResult: string | null; idOn: string | null; reviews: number }>(
          `SELECT coalesce(array_agg(DISTINCT pc.purpose) FILTER (WHERE pc.withdrawn_at IS NULL AND (pc.authority_id IS NULL OR authority_in_effect(pc.authority_id, pc.purpose, current_date))), '{}') AS purposes,
                  (SELECT count(*)::int FROM legal_authorities a WHERE a.subject_contact_id = $1 AND a.status = 'verified' AND a.ended_at IS NULL
                      AND a.starts_on <= current_date AND (a.ends_on IS NULL OR a.ends_on >= current_date)) AS authorities,
                  (SELECT count(*)::int FROM legal_authorities a WHERE a.subject_contact_id = $1 AND a.status = 'pending' AND a.ended_at IS NULL) AS pending,
                  (SELECT result FROM identity_references i WHERE i.contact_id = $1 ORDER BY checked_on DESC, created_at DESC LIMIT 1) AS "idResult",
                  (SELECT checked_on::text FROM identity_references i WHERE i.contact_id = $1 ORDER BY checked_on DESC, created_at DESC LIMIT 1) AS "idOn",
                  (SELECT count(*)::int FROM compliance_reviews r WHERE r.contact_id = $1 AND r.resolved_at IS NULL) AS reviews
             FROM (SELECT 1) one LEFT JOIN person_consents pc ON pc.contact_id = $1`, [m.contactId])).rows[0]!;
        const cap = await capacityFor(tx, m.jur, m.dob, today);
        out.push({ contactId: m.contactId, fullName: m.fullName, role: m.role, age: ageOn(m.dob), deceasedOn: m.deceasedOn,
          residenceJurisdiction: m.jur, minor: cap.minor, reachesMajorityOn: cap.reachesOn, majorityAge: cap.rule?.minAge ?? null, ruleConfirmed: cap.rule?.counselConfirmed ?? null,
          consentsInForce: s.purposes, verifiedAuthorities: s.authorities, pendingAuthorities: s.pending, latestId: s.idResult ? { result: s.idResult, checkedOn: s.idOn } : null, openReviews: s.reviews });
      }
      return { members: out };
    });
  });
}

/**
 * Open the reviews that dates call for, for one company, as the caller sees it: people reaching the age of majority in
 * the next 60 days (or who reached it with a guardian authority still open), and verified authorities ending in the next
 * 30 days. Each opens once. Nothing is changed besides the review.
 */
export async function openDueReviews(tx: Tx, ctx: RequestContext): Promise<number> {
  await ensureCapacityDefaults(tx, ctx);
  const today = todayIso();
  let opened = 0;
  const people = (await tx.query<{ id: string; full_name: string | null; owner_node_id: string; context_node_id: string | null; dob: string; jur: string; rule_id: string; min_age: number; confirmed: boolean; guardian_open: boolean }>(
    `SELECT c.id, c.full_name, c.owner_node_id, c.context_node_id, c.date_of_birth::text AS dob, c.residence_jurisdiction AS jur,
            (r).id AS rule_id, (r).min_age, (r).counsel_confirmed_at IS NOT NULL AS confirmed,
            EXISTS (SELECT 1 FROM legal_authorities a WHERE a.subject_contact_id = c.id AND a.kind = 'guardian_of_minor' AND a.ended_at IS NULL AND a.status <> 'rejected') AS guardian_open
       FROM (SELECT c.*, capacity_rule_on(c.residence_jurisdiction, 'age_of_majority', current_date) AS r FROM contacts c
              WHERE c.date_of_birth IS NOT NULL AND c.residence_jurisdiction IS NOT NULL AND c.deceased_on IS NULL) c
      WHERE (r).id IS NOT NULL
        AND c.date_of_birth > current_date - make_interval(years => (r).min_age + 2)
        AND c.date_of_birth <= (current_date + 60) - make_interval(years => (r).min_age)
      LIMIT 2000`)).rows;
  for (const p of people) {
    const reach = reachesAgeOn(p.dob, p.min_age);
    const window = addDays(today, 60);
    if (reach.on > window) continue;
    if (reach.on < today && !p.guardian_open) continue; // already of age and nothing left open: no review needed
    const items: Item[] = await affectedItems(tx, p.id);
    if (reach.leapDay) items.unshift({ type: 'note', id: null, label: 'Born on 29 February: confirm with counsel which day the age is reached' });
    if (!p.confirmed) items.unshift({ type: 'note', id: null, label: `Age ${p.min_age} for ${p.jur} is not yet confirmed by counsel` });
    const id = await openReview(tx, ctx, { id: p.id, owner_node_id: p.owner_node_id, context_node_id: p.context_node_id }, 'coming_of_age',
      { ruleId: p.rule_id, milestoneOn: reach.on }, items, reach.on < today ? today : reach.on);
    if (id) opened++;
  }
  const ending = (await tx.query<{ id: string; subject: string; owner_node_id: string; context_node_id: string | null; ends_on: string; holder: string | null }>(
    `SELECT a.id, a.subject_contact_id AS subject, a.owner_node_id, c.context_node_id, a.ends_on::text, coalesce(h.full_name, a.holder_name) AS holder
       FROM legal_authorities a JOIN contacts c ON c.id = a.subject_contact_id LEFT JOIN contacts h ON h.id = a.holder_contact_id
      WHERE a.status = 'verified' AND a.ended_at IS NULL AND a.ends_on IS NOT NULL AND a.ends_on <= current_date + 30 LIMIT 500`)).rows;
  for (const a of ending) {
    const items = (await tx.query<{ id: string; label: string }>(
      `SELECT DISTINCT b.id, b.name AS label FROM person_consents pc JOIN consent_uses u ON u.consent_id = pc.id JOIN boxes b ON b.id = u.box_id
        WHERE pc.authority_id = $1 AND pc.withdrawn_at IS NULL`, [a.id])).rows.map((r): Item => ({ type: 'deal', ...r }));
    items.unshift({ type: 'authority', id: a.id, label: `Authority held by ${a.holder ?? 'someone'} ends on ${a.ends_on}` });
    const id = await openReview(tx, ctx, { id: a.subject, owner_node_id: a.owner_node_id, context_node_id: a.context_node_id }, 'authority_ending', { authorityId: a.id }, items, a.ends_on < today ? today : a.ends_on);
    if (id) opened++;
  }
  return opened;
}

/** The daily sweep: every company, as its top-level admin (who sees every client below). Only while Gate C is on. */
export async function sweepFamilyReviews(deps: AppDeps): Promise<number> {
  if (!familyComplianceEnabled()) return 0;
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let opened = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const ctx = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      opened += await withRequestTx(deps.appPool, ctx, (tx) => openDueReviews(tx, ctx));
    } catch { /* one company failing must not stop the others */ }
  }
  return opened;
}
