// Which roles a place offers (onboarding plan, section 5: roles offered are filtered to what the chosen place allows).
// Learner is never assigned by hand: it is added when someone takes a course.
// Admin at a branch is offered only to a tenant admin, as before.
const OFFERED: Record<string, readonly string[]> = {
  tenant: ['admin', 'compliance', 'trainer', 'auditor'],
  location: ['admin', 'manager', 'trainer', 'partner', 'compliance', 'auditor'],
  partner: ['admin', 'partner'],
};

export function rolesFor(nodeType: string, isTenantAdmin: boolean): string[] {
  const roles = [...(OFFERED[nodeType] ?? [])];
  if (nodeType === 'location' && !isTenantAdmin) return roles.filter((r) => r !== 'admin');
  return roles;
}
