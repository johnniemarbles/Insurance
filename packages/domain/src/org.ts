// Organization model (PRD 6B): tenant > location > partner > sub-partner.
// A tenant is one company in one country. Pure logic: no database access here.

export const ORG_ROLES = ['admin', 'manager', 'trainer', 'partner', 'learner', 'compliance', 'auditor', 'staff'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export type OrgNodeType = 'tenant' | 'location' | 'partner';
export type OrgLinkKind = 'location_link' | 'partner_link';

/** Maximum partner levels (partner + sub-partners) beneath a location. */
export const MAX_PARTNER_LEVELS = 5;

export function isRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

/** Which kind of link joins a parent type to a child type, or null if that pairing is not allowed. */
export function linkKindFor(parent: OrgNodeType, child: OrgNodeType): OrgLinkKind | null {
  if (parent === 'location' && child === 'partner') return 'location_link';
  if (parent === 'partner' && child === 'partner') return 'partner_link';
  return null;
}

export type StructureChange = 'create_root_node' | OrgLinkKind;

/**
 * Who may change the organization structure.
 * - Tenant admins: everything.
 * - A partner admin (on the parent partner or any partner above it): add and remove sub-partners beneath it.
 * - Nobody else.
 * The database enforces tenant walls and visibility; this rule is enforced by the API.
 */
export function canChangeStructure(
  actor: { isTenantAdmin: boolean },
  change: StructureChange,
  isAdminOnParentPartnerChain: boolean,
): boolean {
  if (actor.isTenantAdmin) return true;
  if (change === 'partner_link') return isAdminOnParentPartnerChain;
  return false;
}

/**
 * Who may edit a CRM record: its owner node (the people who work it) and tenant admins.
 * People above the owner can read it but not change it.
 */
export function canEditRecord(actor: { isTenantAdmin: boolean; nodeIds: string[] }, ownerNodeId: string): boolean {
  return actor.isTenantAdmin || actor.nodeIds.includes(ownerNodeId);
}

/** The roles a branch manager gives in its own branch (plan v7, section 3). */
export const BRANCH_MANAGER_GRANTS: readonly OrgRole[] = ['manager', 'trainer', 'staff'];

/**
 * Who may give a role at a place (add it, or remove it).
 * - Tenant admins: any role, anywhere.
 * - A partner administrator (on the partner): the partner's own roles, as before.
 * - A branch manager: manager, trainer and staff, in its own branch only.
 * - Nobody else. A Compliance Manager is appointed by the company administrator only.
 */
export function canGrantRole(
  actor: { isTenantAdmin: boolean; isAdminAbove: boolean; managesBranch: boolean },
  role: OrgRole,
  nodeType: OrgNodeType,
): boolean {
  if (actor.isTenantAdmin) return true;
  if (nodeType === 'partner') return actor.isAdminAbove;
  if (nodeType === 'location') return actor.managesBranch && (BRANCH_MANAGER_GRANTS as readonly string[]).includes(role);
  return false;
}

/**
 * Who may add a broker (a partner) under a parent.
 * - Tenant admins: anywhere (until slice 3 limits it to Compliance Managers).
 * - A partner administrator on the parent partner's chain: sub-brokers beneath that partner.
 * - Branch managers: no. Starting a broker is the Compliance Manager's job (plan v7, section 5).
 */
export function canAddBroker(actor: { isTenantAdmin: boolean }, parent: OrgNodeType, isAdminOnParentChain: boolean): boolean {
  if (actor.isTenantAdmin) return true;
  if (parent === 'partner') return isAdminOnParentChain;
  return false;
}
