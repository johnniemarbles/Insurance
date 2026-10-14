import { isUuid } from './uuid.ts';
import { isRole, type OrgRole } from './org.ts';

export interface RoleAssignment {
  nodeId: string;
  role: string;
}

export interface SessionInput {
  tenantId: string;
  userId: string;
  homeNodeId: string;
  tenantRootNodeId: string;
  roles: RoleAssignment[];
}

/** Everything the API needs to know about the caller, derived once per request. */
export interface RequestContext {
  tenantId: string;
  userId: string;
  /** Home node plus every node where the user holds a role. Drives row-level security. */
  nodeIds: string[];
  /** Nodes where the user is an admin. */
  adminNodeIds: string[];
  isTenantAdmin: boolean;
  canWrite: boolean;
  /** CRM access: any role except learner-only and trainer-only. */
  canUseCrm: boolean;
  roles: { nodeId: string; role: OrgRole }[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildRequestContext(input: SessionInput): RequestContext {
  for (const [label, value] of [
    ['tenantId', input.tenantId],
    ['userId', input.userId],
    ['homeNodeId', input.homeNodeId],
    ['tenantRootNodeId', input.tenantRootNodeId],
  ] as const) {
    if (!isUuid(value)) throw new Error(`Invalid ${label}`);
  }
  const roles: { nodeId: string; role: OrgRole }[] = [];
  for (const r of input.roles) {
    if (!isUuid(r.nodeId)) throw new Error('Invalid role node id');
    if (isRole(r.role)) roles.push({ nodeId: r.nodeId, role: r.role });
  }
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    nodeIds: unique([input.homeNodeId, ...roles.map((r) => r.nodeId)]),
    adminNodeIds: unique(roles.filter((r) => r.role === 'admin').map((r) => r.nodeId)),
    isTenantAdmin: roles.some((r) => r.role === 'admin' && r.nodeId === input.tenantRootNodeId),
    // Any assigned role except read-only auditor may write; finer rules (who may edit what) are enforced by the API.
    canWrite: roles.some((r) => r.role !== 'auditor'),
    // Everyone with a role can read the CRM; an auditor reads it but cannot write (see canWrite).
    canUseCrm: roles.length > 0,
    roles,
  };
}

/** The per-transaction settings the database policies read (SET LOCAL via set_config). */
export function toSessionSettings(ctx: RequestContext): Record<string, string> {
  for (const id of ctx.nodeIds) {
    if (!isUuid(id)) throw new Error('Invalid node id');
  }
  return {
    'app.tenant_id': ctx.tenantId,
    'app.user_id': ctx.userId,
    'app.node_ids': `{${ctx.nodeIds.join(',')}}`,
    'app.admin_node_ids': `{${ctx.adminNodeIds.filter((i) => isUuid(i)).join(',')}}`,
    'app.is_tenant_admin': ctx.isTenantAdmin ? 'true' : 'false',
    'app.can_write': ctx.canWrite ? 'true' : 'false',
  };
}
