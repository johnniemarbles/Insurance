// Who may add a broker under a parent (plan v7, sections 2 and 5). A top-level broker is added by the Compliance Manager of
// its branch only. Sub-brokers keep the current rule until the sub-broker slice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddBroker } from '../src/index.ts';

const admin = { isTenantAdmin: true, isComplianceForBranch: false };
const officer = { isTenantAdmin: false, isComplianceForBranch: true };
const branchManager = { isTenantAdmin: false, isComplianceForBranch: false };
const partnerAdmin = { isTenantAdmin: false, isComplianceForBranch: false };

test('only the Compliance Manager of the branch adds a broker under it', () => {
  assert.equal(canAddBroker(officer, 'location', false), true);
});

test('the company administrator cannot add a broker under a branch (plan v7, decision 1)', () => {
  assert.equal(canAddBroker(admin, 'location', false), false);
});

test('a branch manager cannot add a broker under its branch', () => {
  assert.equal(canAddBroker(branchManager, 'location', false), false);
});

test('a Compliance Manager of another branch cannot add here', () => {
  // The caller passes isComplianceForBranch only for the branch it is assigned to.
  assert.equal(canAddBroker({ isTenantAdmin: false, isComplianceForBranch: false }, 'location', false), false);
});

test('sub-brokers beneath a partner: a partner administrator on the chain (unchanged until the sub-broker slice)', () => {
  assert.equal(canAddBroker(partnerAdmin, 'partner', true), true);
  assert.equal(canAddBroker(partnerAdmin, 'partner', false), false);
  assert.equal(canAddBroker(admin, 'partner', false), true);
});

test('nothing else can hold a broker: a broker is never added under a broker-less parent', () => {
  assert.equal(canAddBroker(officer, 'tenant', false), false);
});
