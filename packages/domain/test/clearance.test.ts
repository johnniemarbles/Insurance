import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearanceReasons, coverageFrozen } from '../src/index.ts';

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

// Expiry freeze (plan v6, section 2): a licence or E&O policy that has expired freezes the partner's carrier submissions.
// A missing one is "not yet on file", not a freeze, so a partner who has never filed a licence is not frozen by this rule.
test('an expired licence or E&O freezes; a missing one does not', () => {
  assert.equal(coverageFrozen({ licences: 1, validLicences: 0, eoPolicies: 1, validEo: 1 }), true, 'licence expired');
  assert.equal(coverageFrozen({ licences: 1, validLicences: 1, eoPolicies: 1, validEo: 0 }), true, 'E&O expired');
  assert.equal(coverageFrozen({ licences: 0, validLicences: 0, eoPolicies: 0, validEo: 0 }), false, 'nothing on file yet');
  assert.equal(coverageFrozen({ licences: 1, validLicences: 1, eoPolicies: 1, validEo: 1 }), false, 'all in force');
});
