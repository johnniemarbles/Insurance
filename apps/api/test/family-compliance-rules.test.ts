// Families, Gate C: the pure rules behind consent reuse, ages, ID currency and review timing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CA_AGE_OF_MAJORITY, addDays, guardianAllowed, idCurrent, idStatus, lifeEventDueDays, looksLikeIdNumber, reachesAgeOn, reuseCheck, underAge,
} from '../src/family-compliance-rules.ts';

test('ages of majority cover every province and territory, 18 or 19', () => {
  assert.equal(Object.keys(CA_AGE_OF_MAJORITY).length, 13);
  for (const j of ['CA-AB', 'CA-MB', 'CA-ON', 'CA-PE', 'CA-QC', 'CA-SK']) assert.equal(CA_AGE_OF_MAJORITY[j], 18, j);
  for (const j of ['CA-BC', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-YT']) assert.equal(CA_AGE_OF_MAJORITY[j], 19, j);
});

test('reaching an age, including a 29 February birthday', () => {
  assert.deepEqual(reachesAgeOn('2008-05-10', 19), { on: '2027-05-10', leapDay: false });
  assert.deepEqual(reachesAgeOn('2008-02-29', 19), { on: '2027-03-01', leapDay: true });
  assert.deepEqual(reachesAgeOn('2008-02-29', 20), { on: '2028-02-29', leapDay: true });
  assert.equal(underAge('2008-05-10', 19, '2027-05-09'), true);
  assert.equal(underAge('2008-05-10', 19, '2027-05-10'), false);
  assert.equal(underAge(null, 19, '2027-05-10'), null);
  assert.equal(underAge('2008-05-10', null, '2027-05-10'), null);
});

test('a consent is reused only when purpose, scope, notice version and authority all match', () => {
  const base = { purpose: 'collection_use', scope: 'all_dealings' as const, boxId: null, noticeVersion: 'v2', withdrawnAt: null, givenBy: 'self' as const, authorityInEffect: true };
  const want = { purpose: 'collection_use', boxId: 'B2', noticeVersion: 'v2' };
  assert.deepEqual(reuseCheck(base, want), { ok: true, reasons: [] });
  assert.deepEqual(reuseCheck({ ...base, purpose: 'marketing' }, want).reasons, ['different purpose']);
  assert.deepEqual(reuseCheck({ ...base, scope: 'deal', boxId: 'B1' }, want).reasons, ['given for another deal only']);
  assert.equal(reuseCheck({ ...base, scope: 'deal', boxId: 'B2' }, want).ok, true);
  assert.match(reuseCheck({ ...base, noticeVersion: 'v1' }, want).reasons[0]!, /notice v1; the current notice is v2/);
  assert.deepEqual(reuseCheck({ ...base, givenBy: 'authority', authorityInEffect: false }, want).reasons, ['the authority it was given under is no longer in effect']);
  assert.ok(reuseCheck({ ...base, withdrawnAt: '2026-01-01' }, want).reasons.includes('withdrawn'));
});

test('ID checks: current by the strictest rule; no rule is never "not required"', () => {
  assert.equal(idCurrent('2024-10-20', 24, '2026-10-20'), true);
  assert.equal(idCurrent('2024-10-19', 24, '2026-10-20'), false);
  assert.equal(idCurrent('2000-01-01', null, '2026-10-20'), true);
  const rules = [{ dealRole: 'applicant', required: true, validMonths: 24 }, { dealRole: 'payor', required: true, validMonths: 12 }, { dealRole: 'beneficiary', required: false, validMonths: null }];
  assert.deepEqual(idStatus(['insured'], rules, null, null, '2026-10-20'), { status: 'no_rule', validMonths: null });
  assert.deepEqual(idStatus(['beneficiary'], rules, null, null, '2026-10-20'), { status: 'not_required', validMonths: null });
  assert.deepEqual(idStatus(['applicant'], rules, null, null, '2026-10-20'), { status: 'missing', validMonths: 24 });
  assert.equal(idStatus(['applicant', 'payor'], rules, null, '2025-06-01', '2026-10-20').status, 'expired'); // payor's 12 months decide
  assert.equal(idStatus(['applicant'], rules, null, '2025-06-01', '2026-10-20').status, 'current');
  assert.equal(idStatus(['applicant'], rules, { result: 'failed', checkedOn: '2026-10-01' }, '2025-06-01', '2026-10-20').status, 'failed');
  assert.equal(idStatus(['applicant'], rules, { result: 'failed', checkedOn: '2025-01-01' }, '2025-06-01', '2026-10-20').status, 'current');
});

test('guardians, document numbers, review timing', () => {
  assert.equal(guardianAllowed('guardian_of_minor', true), true);
  assert.equal(guardianAllowed('guardian_of_minor', null), true); // age unknown: allowed, compliance verifies the evidence
  assert.equal(guardianAllowed('guardian_of_minor', false), false);
  assert.equal(guardianAllowed('poa_property', false), true);
  assert.equal(looksLikeIdNumber('Passport seen, expires 2030'), false);
  assert.equal(looksLikeIdNumber('Licence D1234567'), true);
  assert.equal(lifeEventDueDays('death'), 7);
  assert.equal(lifeEventDueDays('move'), 14);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});
