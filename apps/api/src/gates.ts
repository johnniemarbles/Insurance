import type { Tx } from '@pii/db';
import { ADVICE_DOC_TYPES, CONSENT_GATE_TYPE, DOC_TYPE_LABELS, consentStates, isDocType, missingDocs, openScreeningHits, type ConsentKind, type DocType } from '@pii/domain';
import { HttpError } from './errors.ts';
import { tenantSettingInt } from './needs-analysis.ts';

/** What a record holds against what a stage requires. All lists are document type keys.
 *  `unverified`: advice paperwork uploaded but not yet verified by compliance. `needsExpiredOn`: the last signed needs analysis, if it has expired. */
export interface GateStatus { stageId: string; stageName: string; required: string[]; filed: string[]; overridden: string[]; missing: string[]; unverified: string[]; needsExpiredOn: string | null }

/**
 * Advice paperwork (needs analysis, recommendation, beneficiary designation, replacement disclosure) counts only when it is a signed advice
 * record on this file, or an upload a compliance person has verified. A needs analysis also has to be current. When the client's needs
 * analysis says existing cover is being replaced, any stage that requires the needs analysis or the recommendation also requires a signed
 * replacement disclosure (Code of Conduct: no replacement without a complete analysis and disclosure).
 */
export async function gateStatus(tx: Tx, stageId: string, boxId: string): Promise<GateStatus | null> {
  const st = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [stageId])).rows[0];
  if (!st) return null;
  const required = (await tx.query<{ doc_type: string }>('SELECT doc_type FROM stage_doc_requirements WHERE stage_id = $1 ORDER BY doc_type', [stageId])).rows.map((r) => r.doc_type);
  if (required.length === 0) return { stageId, stageName: st.name, required, filed: [], overridden: [], missing: [], unverified: [], needsExpiredOn: null };
  const months = await tenantSettingInt(tx, 'compliance.naValidityMonths', 12);
  const docs = (await tx.query<{ doc_type: string; verified: boolean; current: boolean }>(
    `SELECT doc_type, verified_at IS NOT NULL AS verified, (verified_at IS NOT NULL AND (verified_at AT TIME ZONE 'UTC')::date + make_interval(months => $2) >= current_date) AS current
       FROM box_documents WHERE box_id = $1 AND doc_type IS NOT NULL`, [boxId, months])).rows;
  const filed: string[] = [];
  const unverified = new Set<string>();
  for (const d of docs) {
    if (!ADVICE_DOC_TYPES.includes(d.doc_type)) { if (!filed.includes(d.doc_type)) filed.push(d.doc_type); continue; }
    if (!d.verified) { unverified.add(d.doc_type); continue; }
    if (d.doc_type === 'needs_analysis' && !d.current) continue;
    if (!filed.includes(d.doc_type)) filed.push(d.doc_type);
  }
  const advice = (await tx.query<{ kind: string; current: boolean; valid_until: string | null; replacing: boolean }>(
    `SELECT kind, (valid_until IS NULL OR valid_until >= current_date) AS current, valid_until::text AS valid_until, coalesce((answers->>'replacing')::boolean, false) AS replacing
       FROM advice_records WHERE box_id = $1 AND status = 'signed' ORDER BY signed_at DESC`, [boxId])).rows;
  let needsExpiredOn: string | null = null;
  for (const a of advice) {
    if (a.kind === 'needs_analysis' && !a.current) { needsExpiredOn ??= a.valid_until; continue; }
    if (!filed.includes(a.kind)) filed.push(a.kind);
  }
  for (const t of filed) unverified.delete(t);
  if (filed.includes('needs_analysis')) needsExpiredOn = null;
  const latestNeeds = advice.find((a) => a.kind === 'needs_analysis' && a.current);
  const req = [...required];
  if (latestNeeds?.replacing && (req.includes('needs_analysis') || req.includes('recommendation')) && !req.includes('replacement_disclosure')) req.push('replacement_disclosure');
  if (!filed.includes('id_record') && (await tx.query("SELECT 1 FROM client_id_records WHERE box_id = $1 AND result = 'verified' LIMIT 1", [boxId])).rowCount) filed.push('id_record');
  const consents = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>('SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 ORDER BY created_at', [boxId])).rows;
  for (const k of consentStates(consents).active) { const t = CONSENT_GATE_TYPE[k as ConsentKind]; if (t && !filed.includes(t)) filed.push(t); }
  const overridden = (await tx.query<{ t: string }>('SELECT DISTINCT unnest(doc_types) AS t FROM gate_overrides WHERE box_id = $1 AND stage_id = $2', [boxId, stageId])).rows.map((r) => r.t);
  const missing = missingDocs(req, filed, overridden);
  return { stageId, stageName: st.name, required: req, filed, overridden, missing, unverified: [...unverified].filter((t) => missing.includes(t)), needsExpiredOn: missing.includes('needs_analysis') ? needsExpiredOn : null };
}

const labelOf = (t: string) => (isDocType(t) ? DOC_TYPE_LABELS[t as DocType].en : t);

/** A record may enter a stage only when the paperwork that stage requires is on file, or the requirement was waived for this record.
 *  Jumping forward past a gated stage does not skip it. Moving to a lost stage is never blocked. */
export async function checkStageGates(tx: Tx, stageId: string, boxId: string, fromStageId?: string | null): Promise<void> {
  const target = (await tx.query<{ pipeline_id: string; position: number; is_lost: boolean }>('SELECT pipeline_id, position, is_lost FROM stages WHERE id = $1', [stageId])).rows[0];
  if (!target || target.is_lost) return;
  // The stage entered, plus any gated stage between where the record is now and where it goes (a forward jump cannot skip a gate).
  const from = fromStageId === undefined
    ? (await tx.query<{ position: number }>('SELECT s.position FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE b.id = $1 AND s.pipeline_id = $2', [boxId, target.pipeline_id])).rows[0]?.position ?? 0
    : fromStageId ? (await tx.query<{ position: number }>('SELECT position FROM stages WHERE id = $1 AND pipeline_id = $2', [fromStageId, target.pipeline_id])).rows[0]?.position ?? 0 : 0;
  const gated = (await tx.query<{ id: string }>(
    `SELECT s.id FROM stages s WHERE s.pipeline_id = $1 AND NOT s.is_lost AND (s.id = $4 OR (s.position > $3 AND s.position <= $2))
        AND EXISTS (SELECT 1 FROM stage_doc_requirements r WHERE r.stage_id = s.id) ORDER BY s.position`,
    [target.pipeline_id, target.position, from, stageId])).rows;
  if (gated.length === 0) return;
  const rows = (await tx.query<{ list: string; result: string; createdAt: string }>('SELECT list, result, created_at AS "createdAt" FROM screening_results WHERE box_id = $1 ORDER BY created_at', [boxId])).rows;
  const hits = openScreeningHits(rows);
  const name = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [stageId])).rows[0]!.name;
  if (hits.length) throw new HttpError(409, 'screening_hit', `To move to “${name}”, a compliance review of the ${hits.map((h) => (h === 'pep' ? 'PEP' : 'sanctions')).join(' and ')} screening hit is needed first`);
  for (const s of gated) {
    const g = await gateStatus(tx, s.id, boxId);
    if (!g || g.missing.length === 0) continue;
    const notes = [
      ...(g.stageId !== stageId ? [`required from “${g.stageName}” on`] : []),
      ...(g.needsExpiredOn ? [`the last needs analysis expired on ${g.needsExpiredOn}, so a new signed one is needed`] : []),
      ...(g.unverified.length ? [`uploaded ${g.unverified.map(labelOf).join(', ')} must be verified by compliance or signed in PII`] : []),
    ];
    throw new HttpError(409, 'gate_blocked', `To move to “${name}”, file: ${g.missing.map(labelOf).join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }
}
