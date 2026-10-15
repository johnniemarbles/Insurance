// Who may add a broker under a parent (plan v7). Slice 1: branch managers may no longer add brokers. Slice 3 moves this to
// Compliance Managers for their assigned branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddBroker } from '../src/index.ts';

const admin = { isTenantAdmin: true };
const nobody = { isTenantAdmin: false };

test('a branch manager cannot add a broker under its branch', () => {
  assert.equal(canAddBroker(nobody, 'location', false), false);
});

test('a branch manager cannot add a sub-broker under a partner', () => {
  assert.equal(canAddBroker(nobody, 'partner', false), false);
});

test('a partner administrator adds sub-brokers beneath its partner, not brokers under a branch', () => {
  assert.equal(canAddBroker(nobody, 'partner', true), true);
  assert.equal(canAddBroker(nobody, 'location', false), false);
});

test('the company administrator can still add a broker (removed in slice 3)', () => {
  assert.equal(canAddBroker(admin, 'location', false), true);
  assert.equal(canAddBroker(admin, 'partner', false), true);
});
