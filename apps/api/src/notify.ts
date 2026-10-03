import type { Tx } from '@pii/db';

export type NotifyKind = 'assigned' | 'task_assigned' | 'mention' | 'note' | 'stage_change' | 'capture' | 'merge_done' | 'unsubscribed';

/** Tells a person something. Never tells someone about their own action. Whether they see it is their own setting, checked when they read. */
export async function notify(tx: Tx, p: { tenantId: string; userId: string | null | undefined; actorId?: string | null; kind: NotifyKind; boxId?: string | null; data?: Record<string, unknown> }): Promise<void> {
  if (!p.userId || p.userId === p.actorId) return;
  await tx.query(
    `INSERT INTO notifications (tenant_id, user_id, kind, box_id, actor_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [p.tenantId, p.userId, p.kind, p.boxId ?? null, p.actorId ?? null, JSON.stringify(p.data ?? {})],
  );
}
