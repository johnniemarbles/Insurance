import { canEditRecord, type FieldDef, type RequestContext } from '@pii/domain';
import type { Tx } from '@pii/db';
import { forbidden, invalid, notFound } from './errors.ts';

export function requireCrm(ctx: RequestContext): void {
  if (!ctx.canUseCrm) throw forbidden('Your role does not include the CRM');
}

/** Nodes where the caller is admin or manager (may define pipelines). */
export function managerNodeIds(ctx: RequestContext): string[] {
  return ctx.roles.filter((r) => r.role === 'admin' || r.role === 'manager').map((r) => r.nodeId);
}

export function requireEdit(ctx: RequestContext, ownerNodeId: string): void {
  if (!canEditRecord(ctx, ownerNodeId)) throw forbidden('Only the owning branch can change this record');
}

/** Locations a record owned by `ownerNodeId` may be marked for (the owner's location links). */
export async function allowedContexts(tx: Tx, ownerNodeId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await tx.query<{ id: string; name: string }>(
    `SELECT DISTINCT n.id, n.name FROM org_links l
       JOIN org_partner_closure c ON c.ancestor_id = l.child_id AND c.descendant_id = $1
       JOIN org_nodes n ON n.id = l.parent_id
      WHERE l.kind = 'location_link' ORDER BY n.name`,
    [ownerNodeId],
  );
  return rows;
}

/**
 * Decide who owns a new record and which location it is for.
 * Owner defaults to the caller's home node; a partner serving several locations must say which one the record is for.
 */
export async function resolveOwnerAndContext(
  tx: Tx,
  ctx: RequestContext,
  input: { ownerNodeId?: string; contextNodeId?: string | null },
): Promise<{ ownerNodeId: string; contextNodeId: string | null }> {
  const ownerNodeId = input.ownerNodeId ?? ctx.nodeIds[0]!;
  if (!ctx.isTenantAdmin && !ctx.nodeIds.includes(ownerNodeId)) throw forbidden('You can only create records for your own branch');
  const exists = await tx.query('SELECT 1 FROM org_nodes WHERE id = $1', [ownerNodeId]);
  if (exists.rowCount === 0) throw notFound('Unknown organization node');
  const allowed = await allowedContexts(tx, ownerNodeId);
  if (input.contextNodeId) {
    if (!allowed.some((a) => a.id === input.contextNodeId)) throw invalid('That location is not linked to the owner');
    return { ownerNodeId, contextNodeId: input.contextNodeId };
  }
  if (allowed.length === 1) return { ownerNodeId, contextNodeId: allowed[0]!.id };
  if (allowed.length > 1) throw invalid(`contextNodeId is required: choose one of ${allowed.map((a) => a.name).join(', ')}`);
  return { ownerNodeId, contextNodeId: null };
}

export async function resolveOwnerNode(tx: Tx, nodeId: string): Promise<void> {
  const r = await tx.query('SELECT 1 FROM org_nodes WHERE id = $1', [nodeId]);
  if (r.rowCount === 0) throw notFound('Unknown organization node');
}

export async function fieldDefsFor(tx: Tx, pipelineId: string): Promise<FieldDef[]> {
  const { rows } = await tx.query<{ key: string; type: FieldDef['type']; required: boolean; options: string[] | null }>(
    'SELECT key, type, required, options FROM field_defs WHERE pipeline_id = $1 ORDER BY position',
    [pipelineId],
  );
  return rows;
}

export function page(q: { limit?: number; offset?: number }): { limit: number; offset: number } {
  return { limit: Math.min(Math.max(q.limit ?? 50, 1), 200), offset: Math.max(q.offset ?? 0, 0) };
}

export const uuid = { type: 'string', format: 'uuid' } as const;
export const pageQuery = { limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 } } as const;
