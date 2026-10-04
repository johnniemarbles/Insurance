import type { Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';

export async function audit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
  ownerNodeId: string | null = null,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail, owner_node_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.tenantId, ctx.userId, action, entityType, entityId, JSON.stringify(detail), ownerNodeId],
  );
}
