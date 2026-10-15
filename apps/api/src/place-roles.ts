// Which roles a place offers (plan v7, sections 3 and 4). Learner is never assigned by hand: it is added when someone takes a course.
// A branch manager is offered manager, trainer and staff at its own branch only. Everything else at a branch is the company
// administrator's to give.
import { BRANCH_MANAGER_GRANTS } from '@pii/domain';

const OFFERED: Record<string, readonly string[]> = {
  tenant: ['admin', 'compliance', 'trainer', 'auditor'],
  location: ['admin', 'manager', 'trainer', 'partner', 'compliance', 'auditor', 'staff'],
  partner: ['admin', 'partner'],
};

export function rolesFor(nodeType: string, isTenantAdmin: boolean, managesBranch = false): string[] {
  if (isTenantAdmin) return [...(OFFERED[nodeType] ?? [])];
  if (nodeType === 'location') return managesBranch ? BRANCH_MANAGER_GRANTS.map(String) : [];
  if (nodeType === 'partner') return [...(OFFERED.partner ?? [])];
  return [];
}
