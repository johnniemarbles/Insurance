// Supervision rules (roadmap Phase 2, feature 9): which rules apply to a deal entering a stage. Pure matching on facts
// the deal already holds; the database reading is in routes-supervision.ts.
export const supervisionEnabled = (): boolean => ['1', 'true'].includes(String(process.env.SUPERVISION_ENABLED ?? '').toLowerCase());

export interface DealFacts { pipelineId: string; valueAmount: number | null; coverage: number | null; productLine: string | null; province: string | null; replacing: boolean }
export interface Rule {
  id: string; name: string; risk: 'low' | 'medium' | 'high'; pipeline_id: string | null; stage_id: string | null; min_deal_value: string | number | null; min_coverage: string | number | null;
  product_line: string | null; province: string | null; replacing_only: boolean; required_docs: string[]; review_required: boolean; review_hours: number; escalate_to: string | null;
}

/** Does the rule apply to this deal entering this stage? A condition the deal has no fact for does not match. */
export function ruleApplies(r: Rule, f: DealFacts, stage: { id: string; isWon: boolean }): boolean {
  if (r.pipeline_id && r.pipeline_id !== f.pipelineId) return false;
  if (r.stage_id ? r.stage_id !== stage.id : !stage.isWon) return false;
  if (r.min_deal_value != null && !(f.valueAmount != null && f.valueAmount >= Number(r.min_deal_value))) return false;
  if (r.min_coverage != null && !(f.coverage != null && f.coverage >= Number(r.min_coverage))) return false;
  if (r.product_line && r.product_line !== f.productLine) return false;
  if (r.province && r.province !== f.province) return false;
  if (r.replacing_only && !f.replacing) return false;
  return true;
}

/** A plain description of a rule's conditions, for screens and error messages. */
export function describeRule(r: Rule, names: { pipeline?: string | null; stage?: string | null }): string {
  const parts = [names.stage ? `entering “${names.stage}”` : 'being won', ...(names.pipeline ? [`in ${names.pipeline}`] : [])];
  if (r.min_deal_value != null) parts.push(`deal value at least $${Number(r.min_deal_value).toLocaleString('en-CA')}`);
  if (r.min_coverage != null) parts.push(`cover at least $${Number(r.min_coverage).toLocaleString('en-CA')}`);
  if (r.product_line) parts.push(r.product_line === 'annuity' ? 'annuities' : 'life and health');
  if (r.province) parts.push(`in ${r.province}`);
  if (r.replacing_only) parts.push('replacing existing cover');
  return parts.join(', ');
}

/** Province as two capital letters ("Ontario" or "on" → null unless already a code). */
export const provinceCode = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
