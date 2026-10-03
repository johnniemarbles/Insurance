import type { Tx } from '@pii/db';

export interface Digest {
  days: number;
  newBoxes: { id: string; name: string; stage: string | null; createdAt: string }[];
  reachedStage: { stage: string; boxes: { id: string; name: string }[] }[];
  dueTasks: { id: string; title: string; dueAt: string; overdue: boolean; boxId: string | null; boxName: string | null; assignee: string | null }[];
}

/** What happened in a pipeline lately and what is due soon. Rows are limited by row-level security to what the caller may see. */
export async function buildDigest(tx: Tx, pipelineId: string, days: number, tasksOf: string | null): Promise<Digest> {
  const newBoxes = (await tx.query(
    `SELECT b.id, b.name, s.name AS stage, b.created_at AS "createdAt" FROM boxes b LEFT JOIN stages s ON s.id = b.stage_id
      WHERE b.pipeline_id = $1 AND b.created_at > now() - make_interval(days => $2) ORDER BY b.created_at DESC LIMIT 100`, [pipelineId, days],
  )).rows;
  const moves = (await tx.query<{ stage: string; id: string; name: string }>(
    `SELECT DISTINCT s.position, s.name AS stage, b.id, b.name FROM box_events e JOIN boxes b ON b.id = e.box_id JOIN stages s ON s.id = e.to_stage_id
      WHERE b.pipeline_id = $1 AND e.kind = 'stage_changed' AND e.created_at > now() - make_interval(days => $2) AND b.stage_id = e.to_stage_id
      ORDER BY s.position, b.name LIMIT 300`, [pipelineId, days],
  )).rows;
  const reached = new Map<string, { id: string; name: string }[]>();
  for (const m of moves) reached.set(m.stage, [...(reached.get(m.stage) ?? []), { id: m.id, name: m.name }]);
  const dueTasks = (await tx.query(
    `SELECT t.id, t.title, t.due_at AS "dueAt", (t.due_at < now()) AS overdue, t.box_id AS "boxId", b.name AS "boxName", coalesce(u.display_name, u.email::text) AS assignee
       FROM tasks t JOIN boxes b ON b.id = t.box_id LEFT JOIN app_users u ON u.id = t.assignee_id
      WHERE b.pipeline_id = $1 AND t.done_at IS NULL AND t.due_at IS NOT NULL AND t.due_at < now() + make_interval(days => $2)
        AND ($3::uuid IS NULL OR t.assignee_id = $3) ORDER BY t.due_at LIMIT 200`, [pipelineId, days, tasksOf],
  )).rows;
  return { days, newBoxes, reachedStage: [...reached].map(([stage, boxes]) => ({ stage, boxes })), dueTasks };
}
