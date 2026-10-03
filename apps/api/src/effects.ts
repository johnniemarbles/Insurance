import { randomUUID } from 'node:crypto';
import { withRequestTx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { emitEvent, type WebhookEvent } from './webhooks.ts';
import type { AppDeps } from './app.ts';

/** Things an automation does that must happen after its transaction commits. */
export type Effect =
  | { kind: 'event'; pipelineId: string; event: WebhookEvent; data: Record<string, unknown> }
  | { kind: 'merge_add'; mergeId: string; boxId: string; nodeId: string };

export const actingAs = (tenantId: string, userId: string, nodeId: string): RequestContext =>
  ({ tenantId, userId, nodeIds: [nodeId], adminNodeIds: [], isTenantAdmin: false, canWrite: true, canUseCrm: true, roles: [] });

/** Add a record's contact to a mail merge, as the merge's owner. Skips people without an email address and people who opted out. */
export async function flushEffects(deps: AppDeps, tenantId: string, effects: Effect[]): Promise<void> {
  for (const f of effects) {
    if (f.kind === 'event') { emitEvent(deps, tenantId, f.pipelineId, f.event, f.data); continue; }
    try {
      const m = (await deps.authPool.query<{ user_id: string; status: string }>('SELECT user_id, status FROM mail_merges WHERE id = $1 AND tenant_id = $2', [f.mergeId, tenantId])).rows[0];
      if (!m || m.status === 'cancelled') continue;
      await withRequestTx(deps.appPool, actingAs(tenantId, m.user_id, f.nodeId), async (tx) => {
        const c = (await tx.query<{ id: string; email: string; opted: boolean }>(
          `SELECT c.id, c.email::text AS email, (c.email_opt_out_at IS NOT NULL) AS opted FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id
            WHERE bc.box_id = $1 AND c.email IS NOT NULL ORDER BY c.created_at LIMIT 1`, [f.boxId],
        )).rows[0];
        if (!c || c.opted) return;
        const r = await tx.query(
          `INSERT INTO mail_merge_recipients (id, tenant_id, merge_id, user_id, owner_node_id, box_id, contact_id, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,lower($8)) ON CONFLICT (merge_id, email) DO NOTHING`, [randomUUID(), tenantId, f.mergeId, m.user_id, f.nodeId, f.boxId, c.id, c.email],
        );
        if (r.rowCount && m.status === 'done') await tx.query(`UPDATE mail_merges SET status = 'running', finished_at = NULL WHERE id = $1`, [f.mergeId]);
      });
    } catch { /* adding to a merge is best effort and never blocks the person's change */ }
  }
}
