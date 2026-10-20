import type { Tx } from '@pii/db';
import { ADVICE_DOC_TYPES, CONSENT_GATE_TYPE, DOC_TYPE_LABELS, consentStates, isDocType, missingDocs, openScreeningHits, type ConsentKind, type DocType } from '@pii/domain';
import { HttpError } from './errors.ts';
import { tenantSettingInt } from './needs-analysis.ts';

/** What a record holds against what a stage requires. All lists are document type keys.
 *  `unverified`: advice paperwork uploaded but not yet verified by compliance. `needsExpiredOn`: the last signed needs analysis, if it has expired. */
export interface GateStatus { stageId: string; stageName: string; required: string[]; filed: string[]; overridden: string[]; missing: string[]; unverified: string[]; needsExpiredOn: string | null }

/**
 * Advice paperwork (needs analysis, recommendation, beneficiary designation, replacement disclosure) counts only when it is a signed advice
 * record on this file, or an upload a compliance person has verified. A needs analysis has to be current: signed (or, on paper, signed by
 * the client, as compliance recorded when verifying it) within the company's validity period. A recommendation counts only while the needs
 * analysis it answers is signed and current. When any current needs analysis says existing cover is being replaced, a stage that requires
 * the needs analysis or the recommendation also requires a signed replacement disclosure.
 */
export async function gateStatus(tx: Tx, stageId: string, boxId: string): Promise<GateStatus | null> {
  const st = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [stageId])).rows[0];
  if (!st) return null;
  const required = (await tx.query<{ doc_type: string }>('SELECT doc_type FROM stage_doc_requirements WHERE stage_id = $1 ORDER BY doc_type', [stageId])).rows.map((r) => r.doc_type);
  if (required.length === 0) return { stageId, stageName: st.name, required, filed: [], overridden: [], missing: [], unverified: [], needsExpiredOn: null };
  const months = await tenantSettingInt(tx, 'compliance.naValidityMonths', 12);
  const docs = (await tx.query<{ doc_type: string; verified: boolean; current: boolean }>(
    `SELECT doc_type, verified_at IS NOT NULL AS verified,
            (verified_at IS NOT NULL AND coalesce(client_signed_on, (verified_at AT TIME ZONE 'UTC')::date) + make_interval(months => $2) >= current_date) AS current
       FROM box_documents WHERE box_id = $1 AND doc_type IS NOT NULL`, [boxId, months])).rows;
  const filed: string[] = [];
  const unverified = new Set<string>();
  for (const d of docs) {
    if (!ADVICE_DOC_TYPES.includes(d.doc_type)) { if (!filed.includes(d.doc_type)) filed.push(d.doc_type); continue; }
    if (!d.verified) { unverified.add(d.doc_type); continue; }
    if (d.doc_type === 'needs_analysis' && !d.current) continue;
    if (!filed.includes(d.doc_type)) filed.push(d.doc_type);
  }
  const advice = (await tx.query<{ kind: string; current: boolean; valid_until: string | null; replacing: boolean; linked_ok: boolean }>(
    `SELECT a.kind, (a.valid_until IS NULL OR a.valid_until >= current_date) AS current, a.valid_until::text AS valid_until,
            coalesce((a.answers->>'replacing')::boolean, false) AS replacing,
            (a.kind <> 'recommendation' OR EXISTS (SELECT 1 FROM advice_records n WHERE n.id = a.linked_advice_id AND n.box_id = a.box_id AND n.status = 'signed'
                                                    AND (n.valid_until IS NULL OR n.valid_until >= current_date))) AS linked_ok
       FROM advice_records a WHERE a.box_id = $1 AND a.status = 'signed' ORDER BY a.signed_at DESC`, [boxId])).rows;
  let needsExpiredOn: string | null = null;
  for (const a of advice) {
    if (a.kind === 'needs_analysis' && !a.current) { needsExpiredOn ??= a.valid_until; continue; }
    if (!a.linked_ok) continue; // a recommendation whose needs analysis has expired (or that predates linking) no longer counts
    if (!filed.includes(a.kind)) filed.push(a.kind);
  }
  for (const t of filed) unverified.delete(t);
  if (filed.includes('needs_analysis')) needsExpiredOn = null;
  const replacing = advice.some((a) => a.kind === 'needs_analysis' && a.current && a.replacing);
  const req = [...required];
  if (replacing && (req.includes('needs_analysis') || req.includes('recommendation')) && !req.includes('replacement_disclosure')) req.push('replacement_disclosure');
  if (!filed.includes('id_record') && (await tx.query("SELECT 1 FROM client_id_records WHERE box_id = $1 AND result = 'verified' LIMIT 1", [boxId])).rowCount) filed.push('id_record');
  const consents = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>('SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 ORDER BY created_at', [boxId])).rows;
  for (const k of consentStates(consents).active) { const t = CONSENT_GATE_TYPE[k as ConsentKind]; if (t && !filed.includes(t)) filed.push(t); }
  const overridden = (await tx.query<{ t: string }>('SELECT DISTINCT unnest(doc_types) AS t FROM gate_overrides WHERE box_id = $1 AND stage_id = $2', [boxId, stageId])).rows.map((r) => r.t);
  const missing = missingDocs(req, filed, overridden);
  return { stageId, stageName: st.name, required: req, filed, overridden, missing, unverified: [...unverified].filter((t) => missing.includes(t)), needsExpiredOn: missing.includes('needs_analysis') ? needsExpiredOn : null };
}

const labelOf = (t: string) => (isDocType(t) ? DOC_TYPE_LABELS[t as DocType].en : t);

/**
 * Which gated stages apply when a record enters `stageId`: every gated stage up to and including it, and every gated stage in the pipeline
 * when it is a won stage (so neither reordering nor a hop through Lost can skip paperwork). A lost stage without paperwork of its own needs nothing.
 */
async function applicableGates(tx: Tx, stageId: string): Promise<{ name: string; pipelineId: string; first: boolean; gated: string[] } | null> {
  const t = (await tx.query<{ name: string; pipeline_id: string; position: number; is_won: boolean; is_lost: boolean; own: boolean; first: boolean }>(
    `SELECT s.name, s.pipeline_id, s.position, s.is_won, s.is_lost, EXISTS (SELECT 1 FROM stage_doc_requirements r WHERE r.stage_id = s.id) AS own,
            s.position = (SELECT min(position) FROM stages x WHERE x.pipeline_id = s.pipeline_id) AS first
       FROM stages s WHERE s.id = $1`, [stageId])).rows[0];
  if (!t) return null;
  if (t.is_lost && !t.own) return { name: t.name, pipelineId: t.pipeline_id, first: t.first, gated: [] };
  const gated = (await tx.query<{ id: string }>(
    `SELECT s.id FROM stages s WHERE s.pipeline_id = $1 AND (s.id = $3 OR $2 OR (s.position <= $4 AND NOT s.is_lost))
        AND EXISTS (SELECT 1 FROM stage_doc_requirements r WHERE r.stage_id = s.id) ORDER BY s.position`,
    [t.pipeline_id, t.is_won, stageId, t.position])).rows.map((r) => r.id);
  return { name: t.name, pipelineId: t.pipeline_id, first: t.first, gated };
}

/** Where a brand-new record (import, intake form, automation copy) may start: the stage asked for if no paperwork applies to it, otherwise the
 *  pipeline's first stage. A new record has no paperwork yet, so any applicable gate would block it. */
export async function startStageFor(tx: Tx, stageId: string): Promise<string> {
  const g = await applicableGates(tx, stageId);
  if (!g || g.first || g.gated.length === 0) return stageId;
  return (await tx.query<{ id: string }>('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1', [g.pipelineId])).rows[0]!.id;
}

/** A record may enter a stage only when the paperwork every applicable gated stage requires is on file, or was waived for this record.
 *  A record created in the pipeline's first stage is not blocked by that stage's own paperwork. */
export async function checkStageGates(tx: Tx, stageId: string, boxId: string, opts: { creating?: boolean } = {}): Promise<void> {
  const g = await applicableGates(tx, stageId);
  if (!g || g.gated.length === 0 || (opts.creating && g.first)) return;
  const rows = (await tx.query<{ list: string; result: string; createdAt: string }>('SELECT list, result, created_at AS "createdAt" FROM screening_results WHERE box_id = $1 ORDER BY created_at', [boxId])).rows;
  const hits = openScreeningHits(rows);
  if (hits.length) throw new HttpError(409, 'screening_hit', `To move to “${g.name}”, a compliance review of the ${hits.map((h) => (h === 'pep' ? 'PEP' : 'sanctions')).join(' and ')} screening hit is needed first`);
  for (const id of g.gated) {
    const s = await gateStatus(tx, id, boxId);
    if (!s || s.missing.length === 0) continue;
    const notes = [
      ...(id !== stageId ? [`required from “${s.stageName}” on`] : []),
      ...(s.needsExpiredOn ? [`the last needs analysis expired on ${s.needsExpiredOn}, so a new signed one is needed`] : []),
      ...(s.unverified.length ? [`uploaded ${s.unverified.map(labelOf).join(', ')} must be verified by compliance or signed in PII`] : []),
    ];
    throw new HttpError(409, 'gate_blocked', `To move to “${g.name}”, file: ${s.missing.map(labelOf).join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }
}
