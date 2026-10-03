import type { Tx } from '@pii/db';

export interface Risk { id: string; pipelineId: string; pipeline: string; name: string; stage: string; value: number | null; days: number; overdue: number; reasons: string[]; score: number }

/** Records that look stuck, from plain rules. Visibility comes from the caller's row-level security. */
export async function listRisks(tx: Tx, pipelineId: string | null): Promise<Risk[]> {
  const rows = (await tx.query(
    `SELECT b.id, b.pipeline_id AS "pipelineId", p.name AS pipeline, b.name, s.name AS stage, b.value_amount::float8 AS value,
            floor(extract(epoch FROM (now() - b.stage_entered_at)) / 86400)::int AS days,
            (SELECT count(*)::int FROM tasks t WHERE t.box_id = b.id AND t.done_at IS NULL AND t.due_at < now()) AS overdue,
            (b.close_date IS NOT NULL AND b.close_date < current_date) AS "pastClose",
            (b.owner_user_id IS NULL) AS unowned,
            (SELECT count(*)::int FROM tasks t WHERE t.box_id = b.id AND t.done_at IS NULL) AS "openTasks"
       FROM boxes b JOIN stages s ON s.id = b.stage_id JOIN pipelines p ON p.id = b.pipeline_id
      WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND NOT s.is_won AND NOT s.is_lost`, [pipelineId])).rows as (Omit<Risk, 'reasons' | 'score'> & { pastClose: boolean; unowned: boolean; openTasks: number })[];
  return rows.map((r) => {
    const reasons: string[] = [];
    let score = 0;
    if (r.days >= 14) { reasons.push('stalled'); score += Math.min(5, Math.floor(r.days / 14)); }
    if (r.overdue > 0) { reasons.push('overdue'); score += 2 + Math.min(2, r.overdue); }
    if (r.pastClose) { reasons.push('past_close'); score += 3; }
    if (r.openTasks === 0 && r.days >= 7) { reasons.push('no_next_step'); score += 2; }
    if (r.unowned) { reasons.push('unowned'); score += 1; }
    return { id: r.id, pipelineId: r.pipelineId, pipeline: r.pipeline, name: r.name, stage: r.stage, value: r.value, days: r.days, overdue: r.overdue, reasons, score };
  }).filter((r) => r.reasons.length > 0).sort((a, b) => b.score - a.score || (b.value ?? 0) - (a.value ?? 0));
}
