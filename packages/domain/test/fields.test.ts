import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCustomValues, canEditRecord, type FieldDef } from '../src/index.ts';

const defs: FieldDef[] = [
  { key: 'policy_type', type: 'dropdown', required: true, options: ['Auto', 'Home', 'Life'] },
  { key: 'premium', type: 'currency', required: false },
  { key: 'renewal', type: 'date', required: false },
  { key: 'notes', type: 'text', required: false },
  { key: 'has_claims', type: 'checkbox', required: false },
];

test('valid values pass and are returned', () => {
  const r = validateCustomValues(defs, { policy_type: 'Auto', premium: 1200.5, renewal: '2026-12-01', has_claims: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { policy_type: 'Auto', premium: 1200.5, renewal: '2026-12-01', has_claims: false });
});

test('required, type, option and unknown-key errors are reported', () => {
  const r = validateCustomValues(defs, { premium: 'lots', renewal: '12/01/2026', has_claims: 'yes', extra: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 5); // premium, renewal, has_claims, extra, missing policy_type
  assert.ok(r.errors.some((e) => /policy_type" is required/.test(e)));
  assert.ok(validateCustomValues(defs, { policy_type: 'Boat' }).errors[0]!.includes('Auto, Home, Life'));
});

test('partial updates skip the required check; null clears optional fields only', () => {
  assert.equal(validateCustomValues(defs, { premium: 10 }, { partial: true }).ok, true);
  assert.equal(validateCustomValues(defs, { premium: null }, { partial: true }).ok, true);
  assert.equal(validateCustomValues(defs, { policy_type: null }, { partial: true }).ok, false);
});

test('impossible calendar dates are rejected', () => {
  assert.equal(validateCustomValues(defs, { policy_type: 'Auto', renewal: '2026-02-31' }).ok, false);
});

test('only the owner node and tenant admins may edit a record', () => {
  assert.equal(canEditRecord({ isTenantAdmin: false, nodeIds: ['a', 'b'] }, 'b'), true);
  assert.equal(canEditRecord({ isTenantAdmin: false, nodeIds: ['a'] }, 'z'), false);
  assert.equal(canEditRecord({ isTenantAdmin: true, nodeIds: [] }, 'z'), true);
});
