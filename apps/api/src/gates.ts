import type { Tx } from '@pii/db';
import { DOC_TYPE_LABELS, isDocType, missingDocs, type DocType } from '@pii/domain';
import { HttpError } from './errors.ts';

/** What a record holds against what a stage requires. All three lists are document type keys. */
export interface GateStatus { stageId: string; stageName: string; required: string[]; filed: string[]; overridden: string[]; missing: string[] }

export async function gateStatus(tx: Tx, stageId: string, boxId: string): Promise<GateStatus | null> {
  const st = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [stageId])).rows[0];
  if (!st) return null;
  const required = (await tx.query<{ doc_type: string }>('SELECT doc_type FROM stage_doc_requirements WHERE stage_id = $1 ORDER BY doc_type', [stageId])).rows.map((r) => r.doc_type);
  if (required.length === 0) return { stageId, stageName: st.name, required, filed: [], overridden: [], missing: [] };
  const filed = (await tx.query<{ doc_type: string }>('SELECT DISTINCT doc_type FROM box_documents WHERE box_id = $1 AND doc_type IS NOT NULL', [boxId])).rows.map((r) => r.doc_type);
  const overridden = (await tx.query<{ t: string }>('SELECT DISTINCT unnest(doc_types) AS t FROM gate_overrides WHERE box_id = $1 AND stage_id = $2', [boxId, stageId])).rows.map((r) => r.t);
  return { stageId, stageName: st.name, required, filed, overridden, missing: missingDocs(required, filed, overridden) };
}

const labelOf = (t: string) => (isDocType(t) ? DOC_TYPE_LABELS[t as DocType].en : t);

/** A record may enter a stage only when the paperwork that stage requires is on file, or the requirement was waived for this record. */
export async function checkStageGates(tx: Tx, stageId: string, boxId: string): Promise<void> {
  const g = await gateStatus(tx, stageId, boxId);
  if (!g || g.missing.length === 0) return;
  throw new HttpError(409, 'gate_blocked', `To move to “${g.stageName}”, file: ${g.missing.map(labelOf).join(', ')}`);
}
