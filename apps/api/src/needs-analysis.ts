// Server side of the structured needs analysis: what makes advice signable, what happens when it is signed (validity, compliance review),
// and the plain-text rendering used by the client's signing page and the sealed PDF.
import { randomInt } from 'node:crypto';
import type { Tx } from '@pii/db';
import {
  NEEDS_SECTIONS, RECOMMENDATION_FIELDS, ADVICE_FLAG_LABELS, OBJECTIVE_LABELS, STRUCTURED_KINDS,
  adviceFlags, calcNeed, cleanNeeds, cleanRecommendation, fieldLabel, isNaCurrent, missingNeeds, missingRecommendation, reviewReasonFor, validUntil,
  type AdviceFlag, type AdviceKind, type FormField, type NeedsAnswers, type RecommendationAnswers, type RequestContext,
} from '@pii/domain';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';

/** A company-wide setting read inside any request transaction (row-level security scopes it to the company). */
export async function tenantSettingInt(tx: Tx, key: string, fallback: number): Promise<number> {
  const v = (await tx.query<{ value: unknown }>(`SELECT value FROM setting_values WHERE key = $1 AND scope_type = 'tenant' LIMIT 1`, [key])).rows[0]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export const isStructured = (k: AdviceKind) => STRUCTURED_KINDS.includes(k);
export function cleanAnswers(kind: AdviceKind, raw: unknown): Record<string, unknown> | null {
  if (!isStructured(kind)) return null;
  return (kind === 'needs_analysis' ? cleanNeeds(raw) : cleanRecommendation(raw)) as unknown as Record<string, unknown>;
}

interface AdvRow { id: string; box_id: string; kind: AdviceKind; status: string; answers: Record<string, unknown> | null; linked_advice_id: string | null }

/** The needs analysis a recommendation answers, if it is on the same record. */
async function linkedNeeds(tx: Tx, r: Pick<AdvRow, 'box_id' | 'linked_advice_id'>) {
  if (!r.linked_advice_id) return null;
  return (await tx.query<{ id: string; status: string; answers: NeedsAnswers | null; valid_until: string | null }>(
    `SELECT id, status, answers, valid_until::text AS valid_until FROM advice_records WHERE id = $1 AND box_id = $2 AND kind = 'needs_analysis'`, [r.linked_advice_id, r.box_id])).rows[0] ?? null;
}

/** A link from a recommendation must point at a needs analysis on the same record. */
export async function checkLink(tx: Tx, kind: AdviceKind, boxId: string, linkedId: string | null | undefined): Promise<void> {
  if (kind !== 'recommendation') { if (linkedId) throw new HttpError(422, 'bad_link', 'Only a recommendation is linked to a needs analysis'); return; }
  if (!linkedId) throw new HttpError(422, 'needs_link', 'Choose the needs analysis this recommendation answers. Make one on this record first.');
  if (!(await linkedNeeds(tx, { box_id: boxId, linked_advice_id: linkedId }))) throw new HttpError(422, 'bad_link', 'That needs analysis is not on this record');
}

/** What is still missing, for the screens (empty for free-text kinds). */
export function missingFor(kind: AdviceKind, answers: Record<string, unknown> | null): string[] {
  if (kind === 'needs_analysis') return missingNeeds(cleanNeeds(answers ?? {}));
  if (kind === 'recommendation') return missingRecommendation(cleanRecommendation(answers ?? {}));
  return [];
}

/** Refuses to send advice for signature until the form is complete and, for a recommendation, its needs analysis is signed and current.
 *  Returns the flags a reviewer should see, which are fixed with the wording. */
export async function prepareForSignature(tx: Tx, r: AdvRow): Promise<AdviceFlag[]> {
  if (!isStructured(r.kind)) return [];
  const missing = missingFor(r.kind, r.answers);
  if (r.kind === 'needs_analysis') {
    if (missing.length) throw new HttpError(409, 'advice_incomplete', `Finish the needs analysis first: ${missing.map((k) => fieldLabel(k)).join('; ')}`);
    return adviceFlags(cleanNeeds(r.answers ?? {}), null);
  }
  const na = await linkedNeeds(tx, r);
  if (!na) throw new HttpError(409, 'needs_link', 'Link this recommendation to the needs analysis it answers');
  if (na.status !== 'signed') throw new HttpError(409, 'needs_unsigned', 'The needs analysis must be signed first');
  if (!isNaCurrent(na.valid_until)) throw new HttpError(409, 'needs_expired', `The needs analysis expired on ${na.valid_until}. Complete and sign a new one first.`);
  if (missing.length) throw new HttpError(409, 'advice_incomplete', `Finish the recommendation first: ${missing.map((k) => fieldLabel(k)).join('; ')}`);
  return adviceFlags(cleanNeeds(na.answers ?? {}), cleanRecommendation(r.answers ?? {}));
}

/** Just before the record locks: fix the flags and, for a needs analysis, the day it stops being current. */
export async function stampBeforeSeal(tx: Tx, adviceId: string, signedAt: Date): Promise<void> {
  const r = (await tx.query<AdvRow>('SELECT id, box_id, kind, status, answers, linked_advice_id FROM advice_records WHERE id = $1', [adviceId])).rows[0];
  if (!r || r.status === 'signed') return;
  let flags: AdviceFlag[] = [];
  if (isStructured(r.kind)) {
    if (r.kind === 'needs_analysis') flags = adviceFlags(cleanNeeds(r.answers ?? {}), null);
    else { const na = await linkedNeeds(tx, r); flags = adviceFlags(na ? cleanNeeds(na.answers ?? {}) : null, cleanRecommendation(r.answers ?? {})); }
  }
  const months = await tenantSettingInt(tx, 'compliance.naValidityMonths', 12);
  await tx.query('UPDATE advice_records SET flags = $2, valid_until = $3 WHERE id = $1', [adviceId, flags, r.kind === 'needs_analysis' ? validUntil(signedAt, months) : null]);
}

/** Right after signing: every flagged file and every file from a new advisor goes to compliance review; a share of the rest at random. */
export async function selectForReview(tx: Tx, ctx: RequestContext, adviceId: string): Promise<string | null> {
  const r = (await tx.query<{ created_by: string; flags: string[]; box_id: string; first: Date | null }>(
    `SELECT a.created_by, a.flags, a.box_id,
            (SELECT min(x.signed_at) FROM advice_records x WHERE x.created_by = a.created_by AND x.status = 'signed') AS first
       FROM advice_records a WHERE a.id = $1 AND a.status = 'signed'`, [adviceId])).rows[0];
  if (!r) return null;
  const days = r.first ? (Date.now() - new Date(r.first).getTime()) / 86_400_000 : 0;
  const reason = reviewReasonFor({
    flags: r.flags, advisorDays: days,
    samplePct: await tenantSettingInt(tx, 'compliance.reviewSamplePct', 10),
    newAdvisorDays: await tenantSettingInt(tx, 'compliance.reviewNewAdvisorDays', 90),
    roll: randomInt(0, 10_000) / 10_000,
  });
  if (!reason) return null;
  const id = (await tx.query<{ id: string }>(
    `INSERT INTO advice_reviews (tenant_id, advice_id, advisor_id, reason, flags) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [ctx.tenantId, adviceId, r.created_by, reason, r.flags])).rows[0]?.id ?? null;
  if (id) await audit(tx, ctx, 'advice_review_opened', 'box', r.box_id, { adviceId, reviewId: id, reason });
  return id;
}

const money = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-CA', { maximumFractionDigits: 2 }) : '');
function valueText(x: FormField, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  switch (x.type) {
    case 'money': return `$${money(v)}`;
    case 'bool': return v ? 'Yes' : 'No';
    case 'check': return v ? 'Yes' : 'No';
    case 'choice': return x.options?.find((o) => o.value === v)?.label.en ?? String(v);
    case 'multi': return Array.isArray(v) ? v.map((k) => OBJECTIVE_LABELS[k as keyof typeof OBJECTIVE_LABELS]?.en ?? x.options?.find((o) => o.value === k)?.label.en ?? String(k)).join(', ') : String(v);
    default: return String(v);
  }
}

/** The structured answers as sections of label/value lines, for the sealed PDF and the client's signing page. */
export function answerSections(kind: AdviceKind, answers: Record<string, unknown> | null, flags: readonly string[] = []): { title: string; rows: [string, string][] }[] {
  if (!answers || !isStructured(kind)) return [];
  const out: { title: string; rows: [string, string][] }[] = [];
  if (kind === 'needs_analysis') {
    const a = cleanNeeds(answers);
    const showRisk = a.productLine === 'annuity' || (a.objectives ?? []).includes('savings_retirement');
    for (const s of NEEDS_SECTIONS) {
      if (s.key === 'risk' && !showRisk) continue;
      const rows: [string, string][] = s.fields
        .filter((x) => (a as unknown as Record<string, unknown>)[x.key] !== undefined || ['check', 'bool'].includes(x.type))
        .filter((x) => !(x.key === 'replacingNote' && !a.replacing) && !(x.key === 'conflictNote' && !a.hasConflict))
        .map((x) => [x.label.en, valueText(x, (a as unknown as Record<string, unknown>)[x.key])]);
      if (s.key === 'calculation') {
        const c = calcNeed(a);
        rows.push(['Total need', `$${money(c.totalNeed)}`], ['Cover in force and money available', `$${money(c.existing)}`], ['Gap to cover', `$${money(c.gap)}`]);
      }
      if (rows.length) out.push({ title: s.title.en, rows });
    }
  } else {
    const r = cleanRecommendation(answers) as Record<string, unknown>;
    out.push({ title: 'Recommendation', rows: RECOMMENDATION_FIELDS.filter((x) => r[x.key] !== undefined || x.type === 'check').map((x) => [x.label.en, valueText(x, r[x.key])]) });
  }
  if (flags.length) out.push({ title: 'Points for compliance review', rows: flags.map((f) => [ADVICE_FLAG_LABELS[f as AdviceFlag]?.en ?? f, 'Yes']) });
  return out;
}

export const answersText = (kind: AdviceKind, answers: Record<string, unknown> | null) =>
  answerSections(kind, answers).map((s) => `${s.title}\n${s.rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`).join('\n\n');
