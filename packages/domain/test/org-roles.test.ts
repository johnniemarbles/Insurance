// Who may give which role, and which roles a place offers (plan v7, sections 3 and 6).
// A branch manager gives manager, trainer and staff, in its own branch only. Compliance and admin roles: company admin only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canGrantRole, BRANCH_MANAGER_GRANTS, ORG_ROLES } from '../src/index.ts';

const admin = { isTenantAdmin: true, isAdminAbove: true, managesBranch: false };
const branchManager = { isTenantAdmin: false, isAdminAbove: false, managesBranch: true };
const compliance = { isTenantAdmin: false, isAdminAbove: false, managesBranch: false };

test('staff is a role', () => {
  assert.ok((ORG_ROLES as readonly string[]).includes('staff'));
  assert.deepEqual([...BRANCH_MANAGER_GRANTS].sort(), ['manager', 'staff', 'trainer']);
});

test('a branch manager can give manager, trainer and staff in its own branch', () => {
  for (const r of ['manager', 'trainer', 'staff'] as const) assert.equal(canGrantRole(branchManager, r, 'location'), true, r);
});

test('a branch manager cannot give compliance, auditor, admin or partner roles', () => {
  for (const r of ['compliance', 'auditor', 'admin', 'partner'] as const) assert.equal(canGrantRole(branchManager, r, 'location'), false, r);
});

test('a branch manager cannot give roles in a place it does not manage', () => {
  const elsewhere = { ...branchManager, managesBranch: false };
  assert.equal(canGrantRole(elsewhere, 'staff', 'location'), false);
});

test('a compliance manager cannot give staff roles', () => {
  assert.equal(canGrantRole(compliance, 'staff', 'location'), false);
  assert.equal(canGrantRole(compliance, 'trainer', 'location'), false);
});

test('the company administrator can give any role', () => {
  for (const r of ORG_ROLES) assert.equal(canGrantRole(admin, r, 'location'), true, r);
});
