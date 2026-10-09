import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearanceReasons } from '../src/index.ts';

const ok = { status: 'approved', licences: 1, validLicences: 1, eoPolicies: 1, validEo: 1, eoMaxLimit: 2_000_000, eoMin: 1_000_000 };
test('a partner with everything in force is cleared', () => { assert.deepEqual(clearanceReasons(ok), []); });
test('each gap is named', () => {
  assert.deepEqual(clearanceReasons({ ...ok, status: 'submitted' }), ['not_approved']);
  assert.deepEqual(clearanceReasons({ ...ok, licences: 0, validLicences: 0 }), ['no_licence']);
  assert.deepEqual(clearanceReasons({ ...ok, validLicences: 0 }), ['licence_expired']);
  assert.deepEqual(clearanceReasons({ ...ok, eoPolicies: 0, validEo: 0, eoMaxLimit: null }), ['no_eo']);
  assert.deepEqual(clearanceReasons({ ...ok, validEo: 0, eoMaxLimit: null }), ['eo_expired']);
  assert.deepEqual(clearanceReasons({ ...ok, eoMaxLimit: 500_000 }), ['eo_limit_low']);
  assert.deepEqual(clearanceReasons({ ...ok, eoMaxLimit: 1, eoMin: 0 }), [], 'no minimum means any limit passes');
});
test('a short prior continuing-education term is flagged', () => { assert.deepEqual(clearanceReasons({ ...ok, cePriorShort: true }), ['ce_prior_term_short']); });
