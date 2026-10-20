import { randomUUID } from 'node:crypto';
import { validateCustomValues, type RequestContext } from '@pii/domain';
import type { Tx } from '@pii/db';
import { audit } from './audit.ts';
import { fieldDefsFor } from './crm-helpers.ts';
import { HttpError, invalid } from './errors.ts';
import type { Effect } from './effects.ts';
import { checkStageGates } from './gates.ts';

export type Trigger = 'enter' | 'stale' | 'email';
export type { Effect };

interface AutoRow {
  id: string; pipeline_id: string; stage_id: string; trigger: Trigger; action: string; title: string | null; due_in_days: number | null;
  assignee_user_id: string | null; target_stage_id: string | null; target_pipeline_id: string | null; body: string | null; merge_id: string | null;
}
const MAX_DEPTH = 3;

/** A record may enter a stage only when the fields that stage requires are filled in. */
export async function checkStageRules(tx: Tx, stageId: string, boxId: string, gates = true, fromStageId?: string | null): Promise<void> {
  const st = (await tx.query<{ name: string; required_fields: string[] }>('SELECT name, required_fields FROM stages WHERE id = $1', [stageId])).rows[0];
  if (!st) return;
  if (st.required_fields.length === 0) { if (gates) await checkStageGates(tx, stageId, boxId, fromStageId); return; }
  const b = (await tx.query<{ value_amount: string | null; close_date: string | null; owner_user_id: string | null; custom: Record<string, unknown>; pipeline_id: string }>(
    'SELECT value_amount, close_date, owner_user_id, custom, pipeline_id FROM boxes WHERE id = $1', [boxId],
  )).rows[0];
  if (!b) return;
  const labels = (await tx.query<{ key: string; labels: Record<string, string> }>('SELECT key, labels FROM field_defs WHERE pipeline_id = $1', [b.pipeline_id])).rows;
  const missing = st.required_fields.filter((k) => {
    if (k === 'value') return b.value_amount == null;
    if (k === 'closeDate') return !b.close_date;
    if (k === 'owner') return !b.owner_user_id;
    const v = b.custom[k];
    return v == null || v === '' || v === false;
  }).map((k) => (k === 'value' ? 'Value' : k === 'closeDate' ? 'Close date' : k === 'owner' ? 'Owner' : (labels.find((l) => l.key === k)?.labels.en ?? k)));
  if (missing.length) throw invalid(`To move to “${st.name}”, fill in: ${missing.join(', ')}`);
  if (gates) await checkStageGates(tx, stageId, boxId, fromStageId);
}

/** Identifies one stay in a stage, so each automation acts once per stay. */
export async function stayKey(tx: Tx, boxId: string, kind: Trigger): Promise<string> {
  const r = await tx.query<{ k: string }>(`SELECT $2 || ':' || floor(extract(epoch FROM stage_entered_at) * 1000)::bigint AS k FROM boxes WHERE id = $1`, [boxId, kind]);
  return r.rows[0]?.k ?? `${kind}:0`;
}

/** Run every active automation of this trigger that is set on the record's current stage. */
export async function fireAutomations(tx: Tx, ctx: RequestContext, boxId: string, stageId: string, trigger: Trigger, effects: Effect[], depth = 0): Promise<void> {
  const autos = (await tx.query<AutoRow>(
    `SELECT id, pipeline_id, stage_id, trigger, action, title, due_in_days, assignee_user_id, target_stage_id, target_pipeline_id, body, merge_id
       FROM automations WHERE stage_id = $1 AND trigger = $2 AND active ORDER BY created_at`, [stageId, trigger],
  )).rows;
  if (autos.length === 0) return;
  const key = await stayKey(tx, boxId, trigger);
  for (const a of autos) await runOne(tx, ctx, a, boxId, key, effects, depth);
}

/** Run one automation on one record, once per run key. A failure is recorded, never thrown: it must not undo the person's own change. */
export async function runOne(tx: Tx, ctx: RequestContext, a: AutoRow, boxId: string, key: string, effects: Effect[], depth: number): Promise<void> {
  const ins = await tx.query('INSERT INTO automation_runs (automation_id, box_id, tenant_id, run_key) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [a.id, boxId, ctx.tenantId, key]);
  if (ins.rowCount === 0) return;
  await tx.query('SAVEPOINT auto_step');
  try {
    await apply(tx, ctx, a, boxId, effects, depth);
    await tx.query('RELEASE SAVEPOINT auto_step');
    await audit(tx, ctx, 'automation_ran', 'box', boxId, { automationId: a.id, action: a.action, trigger: a.trigger });
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT auto_step');
    const why = e instanceof HttpError ? e.message : 'Could not complete';
    await tx.query(`UPDATE automation_runs SET outcome = 'skipped', note = $4 WHERE automation_id = $1 AND box_id = $2 AND run_key = $3`, [a.id, boxId, key, why.slice(0, 300)]);
  }
}

async function apply(tx: Tx, ctx: RequestContext, a: AutoRow, boxId: string, effects: Effect[], depth: number): Promise<void> {
  const b = (await tx.query<{ pipeline_id: string; name: string; owner_node_id: string; context_node_id: string | null; owner_user_id: string | null; stage_id: string; value_amount: string | null; currency: string; close_date: string | null; custom: Record<string, unknown> }>(
    'SELECT pipeline_id, name, owner_node_id, context_node_id, owner_user_id, stage_id, value_amount, currency, close_date, custom FROM boxes WHERE id = $1', [boxId],
  )).rows[0];
  if (!b) return;
  if (a.action === 'assign_owner' && a.assignee_user_id) {
    const ok = await tx.query('SELECT 1 FROM user_node_roles WHERE user_id = $1 AND node_id = $2', [a.assignee_user_id, b.owner_node_id]);
    if (ok.rowCount) await tx.query('UPDATE boxes SET owner_user_id = $2, updated_at = now() WHERE id = $1', [boxId, a.assignee_user_id]);
    else throw invalid('That person is no longer in this record’s branch');
  } else if (a.action === 'create_task' && a.title) {
    const due = a.due_in_days == null ? null : new Date(Date.now() + a.due_in_days * 86_400_000).toISOString();
    await tx.query(
      'INSERT INTO tasks (id, tenant_id, box_id, owner_node_id, context_node_id, assignee_id, title, due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), ctx.tenantId, boxId, b.owner_node_id, b.context_node_id, b.owner_user_id ?? ctx.userId, a.title, due],
    );
  } else if (a.action === 'add_note' && a.body) {
    await tx.query('INSERT INTO notes (id, tenant_id, box_id, owner_node_id, context_node_id, author_id, body) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), ctx.tenantId, boxId, b.owner_node_id, b.context_node_id, ctx.userId, a.body]);
  } else if (a.action === 'move_stage' && a.target_stage_id) {
    if (a.target_stage_id === b.stage_id) return;
    const to = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1 AND pipeline_id = $2', [a.target_stage_id, b.pipeline_id])).rows[0];
    if (!to) throw invalid('The target stage no longer exists');
    await checkStageRules(tx, a.target_stage_id, boxId, true, b.stage_id);
    const from = (await tx.query<{ name: string }>('SELECT name FROM stages WHERE id = $1', [b.stage_id])).rows[0];
    await tx.query('UPDATE boxes SET stage_id = $2, stage_entered_at = now(), updated_at = now() WHERE id = $1', [boxId, a.target_stage_id]);
    await tx.query(`INSERT INTO box_events (tenant_id, box_id, kind, from_stage_id, to_stage_id, actor_id) VALUES ($1,$2,'stage_changed',$3,$4,$5)`, [ctx.tenantId, boxId, b.stage_id, a.target_stage_id, ctx.userId]);
    effects.push({ kind: 'event', pipelineId: b.pipeline_id, event: 'box.stage_changed', data: { box: { id: boxId, name: b.name, stageId: a.target_stage_id, stageName: to.name, valueAmount: b.value_amount == null ? null : Number(b.value_amount) }, from: { stageId: b.stage_id, stageName: from?.name ?? null }, source: 'automation' } });
    if (depth < MAX_DEPTH) await fireAutomations(tx, ctx, boxId, a.target_stage_id, 'enter', effects, depth + 1);
  } else if (a.action === 'add_to_merge' && a.merge_id) {
    effects.push({ kind: 'merge_add', mergeId: a.merge_id, boxId, nodeId: b.owner_node_id });
  } else if (a.action === 'copy_to_pipeline' && a.target_pipeline_id) {
    const target = (await tx.query<{ id: string }>('SELECT id FROM pipelines WHERE id = $1', [a.target_pipeline_id])).rows[0];
    if (!target) throw invalid('The target pipeline is not available');
    const stage = a.target_stage_id
      ? (await tx.query<{ id: string; name: string }>('SELECT id, name FROM stages WHERE id = $1 AND pipeline_id = $2', [a.target_stage_id, target.id])).rows[0]
      : (await tx.query<{ id: string; name: string }>('SELECT id, name FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1', [target.id])).rows[0];
    if (!stage) throw invalid('The target pipeline has no such stage');
    const defs = await fieldDefsFor(tx, target.id);
    const keep: Record<string, unknown> = {};
    for (const d of defs) if (d.key in b.custom) keep[d.key] = b.custom[d.key];
    const v = validateCustomValues(defs, keep, { partial: true });
    const newId = randomUUID();
    await tx.query(
      `INSERT INTO boxes (id, tenant_id, pipeline_id, stage_id, owner_node_id, context_node_id, owner_user_id, name, value_amount, currency, close_date, custom, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [newId, ctx.tenantId, target.id, stage.id, b.owner_node_id, b.context_node_id, b.owner_user_id, b.name, b.value_amount, b.currency, b.close_date, JSON.stringify(v.ok ? v.value : {}), ctx.userId],
    );
    await tx.query(`INSERT INTO box_events (tenant_id, box_id, kind, to_stage_id, actor_id) VALUES ($1,$2,'created',$3,$4)`, [ctx.tenantId, newId, stage.id, ctx.userId]);
    await tx.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) SELECT $1, contact_id, tenant_id FROM box_contacts WHERE box_id = $2', [newId, boxId]);
    effects.push({ kind: 'event', pipelineId: target.id, event: 'box.created', data: { box: { id: newId, name: b.name, stageId: stage.id, stageName: stage.name, valueAmount: b.value_amount == null ? null : Number(b.value_amount) }, source: 'automation' } });
    if (depth < MAX_DEPTH) await fireAutomations(tx, ctx, newId, stage.id, 'enter', effects, depth + 1);
  }
}
