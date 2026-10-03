import { withRequestTx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { fireAutomations, runOne, type Effect, type Trigger } from './automation-engine.ts';
import { buildDigest } from './digest.ts';
import { emitEvent, emitEventNow } from './webhooks.ts';
import type { AppDeps } from './app.ts';

/** The identity automations act as: the person who set them up, at the record's own branch. */
const actingAs = (tenantId: string, userId: string, nodeId: string): RequestContext =>
  ({ tenantId, userId, nodeIds: [nodeId], adminNodeIds: [], isTenantAdmin: false, canWrite: true, canUseCrm: true, roles: [] });

/** Records that have sat in a stage longer than an automation allows. Each stay triggers an automation once. */
export async function sweepStale(deps: AppDeps): Promise<number> {
  const autos = (await deps.authPool.query<{ id: string; tenant_id: string; actor: string | null; node: string }>(
    `SELECT a.id, a.tenant_id, a.created_by AS actor, p.owner_node_id AS node
       FROM automations a JOIN pipelines p ON p.id = a.pipeline_id WHERE a.active AND a.trigger = 'stale' ORDER BY a.created_at LIMIT 500`,
  )).rows;
  let n = 0;
  for (const a of autos) {
    if (!a.actor) continue;
    try {
      // 1. find the due records the automation's owner can see
      const due = await withRequestTx(deps.appPool, actingAs(a.tenant_id, a.actor, a.node), async (tx) =>
        (await tx.query<{ box_id: string; node: string; key: string }>(
          `SELECT b.id AS box_id, b.owner_node_id AS node, 'stale:' || floor(extract(epoch FROM b.stage_entered_at) * 1000)::bigint AS key
             FROM automations a JOIN boxes b ON b.stage_id = a.stage_id
            WHERE a.id = $1 AND b.stage_entered_at <= now() - a.stale_days * interval '1 day'
              AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = a.id AND r.box_id = b.id AND r.run_key = 'stale:' || floor(extract(epoch FROM b.stage_entered_at) * 1000)::bigint)
            ORDER BY b.stage_entered_at LIMIT 100`, [a.id],
        )).rows);
      // 2. act on each at the record's own branch
      for (const d of due) {
        const ctx = actingAs(a.tenant_id, a.actor, d.node);
        const effects: Effect[] = [];
        try {
          await withRequestTx(deps.appPool, ctx, async (tx) => {
            const row = (await tx.query('SELECT id, pipeline_id, stage_id, trigger, action, title, due_in_days, assignee_user_id, target_stage_id, target_pipeline_id, body FROM automations WHERE id = $1 AND active', [a.id])).rows[0];
            if (row) await runOne(tx, ctx, row, d.box_id, d.key, effects, 0);
          });
          for (const f of effects) emitEvent(deps, a.tenant_id, f.pipelineId, f.event, f.data);
          n++;
        } catch { /* one record failing must not stop the sweep */ }
      }
    } catch { /* next automation */ }
  }
  return n;
}

/** Send the weekly summary to every subscription that asked for it and is due. */
export async function sweepDigests(deps: AppDeps): Promise<number> {
  const due = (await deps.authPool.query<{ id: string; pipeline_id: string; tenant_id: string; node: string; actor: string }>(
    `SELECT s.id, s.pipeline_id, s.tenant_id, p.owner_node_id AS node, s.created_by AS actor
       FROM webhook_subscriptions s JOIN pipelines p ON p.id = s.pipeline_id
      WHERE s.active AND 'digest.weekly' = ANY(s.events) AND coalesce(s.last_digest_at, s.created_at) <= now() - interval '7 days' LIMIT 200`,
  )).rows;
  let n = 0;
  for (const d of due) {
    try {
      const digest = await withRequestTx(deps.appPool, actingAs(d.tenant_id, d.actor, d.node), (tx) => buildDigest(tx, d.pipeline_id, 7, null));
      await emitEventNow(deps, d.tenant_id, d.pipeline_id, 'digest.weekly', { digest }, [d.id]);
      n++;
    } catch { /* try again next sweep */ }
  }
  return n;
}

let running = false;
/** Every ten minutes; safe to run on several instances because each automation acts once per stay. */
export function startBackgroundJobs(deps: AppDeps): () => void {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweepStale(deps); await sweepDigests(deps); } catch { /* next tick */ } finally { running = false; }
  };
  const t = setInterval(() => void tick(), 10 * 60_000);
  t.unref();
  setTimeout(() => void tick(), 15_000).unref();
  return () => clearInterval(t);
}
export type { Trigger };
export { fireAutomations };
