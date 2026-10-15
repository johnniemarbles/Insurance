// Who may add a broker under a parent. A branch manager adds brokers under its own branch only (plan section 6 and 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddBroker } from '../src/index.ts';

const admin = { isTenantAdmin: true };
const nobody = { isTenantAdmin: false };

test('a branch manager can add a broker under its own branch', () => {
  assert.equal(canAddBroker(nobody, 'location', false, true), true);
});

test('a branch manager cannot add a broker under a branch it does not manage', () => {
  assert.equal(canAddBroker(nobody, 'location', false, false), false);
});

test('a branch manager cannot add a sub-broker under a partner', () => {
  assert.equal(canAddBroker(nobody, 'partner', false, true), false);
});

test('a partner administrator adds sub-brokers beneath its partner, not brokers under a branch', () => {
  assert.equal(canAddBroker(nobody, 'partner', true, false), true);
  assert.equal(canAddBroker(nobody, 'location', false, false), false);
});

test('the company administrator can add a broker anywhere', () => {
  assert.equal(canAddBroker(admin, 'location', false, false), true);
  assert.equal(canAddBroker(admin, 'partner', false, false), true);
});
