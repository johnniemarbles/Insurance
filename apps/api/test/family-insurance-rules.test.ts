// Gate B rules on their own: beneficiary groups, carrier profiles, required roles, currency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPolicyParties, currencyOf, DEFAULT_PROFILE, roleAllowed, type PartyLike } from '../src/family-insurance-rules.ts';

const P = (o: Partial<PartyLike>): PartyLike => ({ role: 'owner', contactId: 'c', outsideName: null, beneficiaryClass: null, insuredContactId: null, allocationMethod: null, shareBasisPoints: null, ...o });
const owner = P({ role: 'owner', contactId: 'raj' });
const insured = P({ role: 'insured', contactId: 'raj' });
const ben = (who: string, cls: 'primary' | 'contingent', bp: number | null, method: 'percentage' | 'equal' | 'estate' = 'percentage', life: string | null = null) =>
  P({ role: 'beneficiary', contactId: method === 'estate' ? null : who, beneficiaryClass: cls, allocationMethod: method, shareBasisPoints: bp, insuredContactId: life });
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code).sort();
const confirmed = { ...DEFAULT_PROFILE, confirmedWithCarrier: true };

test('owner and insured are required by default; joint roles need the main role', () => {
  assert.deepEqual(codes(checkPolicyParties([], confirmed)), ['missing_insured', 'missing_owner']);
  assert.deepEqual(codes(checkPolicyParties([P({ role: 'joint_owner', contactId: 'a' }), insured], confirmed)), ['joint_without_owner']);
  assert.equal(checkPolicyParties([owner, insured], { ...confirmed, requiresOwner: false }).ready, true);
});

test('primary and contingent shares each total 100%, checked separately', () => {
  const ok = checkPolicyParties([owner, insured, ben('a', 'primary', 6000), ben('b', 'primary', 4000), ben('c', 'contingent', 10000)], confirmed);
  assert.equal(ok.ready, true, JSON.stringify(ok.errors));
  const bad = checkPolicyParties([owner, insured, ben('a', 'primary', 6000), ben('b', 'primary', 3000), ben('c', 'contingent', 10000)], confirmed);
  assert.deepEqual(codes(bad), ['shares_total']);
  assert.match(bad.errors[0]!.message, /primary.*90%/);
  // A single, global 100% rule would wrongly accept this: 50% primary plus 50% contingent.
  assert.deepEqual(codes(checkPolicyParties([owner, insured, ben('a', 'primary', 5000), ben('b', 'contingent', 5000)], confirmed)), ['shares_total', 'shares_total']);
});

test('equal shares, the estate, and mixing', () => {
  assert.equal(checkPolicyParties([owner, insured, ben('a', 'primary', null, 'equal'), ben('b', 'primary', null, 'equal')], confirmed).ready, true);
  assert.deepEqual(codes(checkPolicyParties([owner, insured, ben('a', 'primary', 5000), ben('b', 'primary', null, 'equal')], confirmed)), ['mixed_split']);
  assert.equal(checkPolicyParties([owner, insured, ben('', 'primary', null, 'estate')], confirmed).ready, true);
  assert.deepEqual(codes(checkPolicyParties([owner, insured, ben('', 'primary', null, 'estate'), ben('a', 'primary', 10000)], confirmed)), ['estate_alone']);
});

test('more than one insured life: each beneficiary must say whose life; groups are per life', () => {
  const joint = [owner, P({ role: 'insured', contactId: 'raj' }), P({ role: 'joint_insured', contactId: 'simran' })];
  assert.deepEqual(codes(checkPolicyParties([...joint, ben('a', 'primary', 10000)], confirmed)), ['whose_life']);
  const perLife = checkPolicyParties([...joint, ben('simran', 'primary', 10000, 'percentage', 'raj'), ben('raj', 'primary', 10000, 'percentage', 'simran')], confirmed);
  assert.equal(perLife.ready, true, JSON.stringify(perLife.errors));
});

test('warnings never block: no beneficiary, contingent without primary, unconfirmed carrier rules', () => {
  const r = checkPolicyParties([owner, insured, ben('c', 'contingent', 10000)], DEFAULT_PROFILE);
  assert.equal(r.ready, true);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ['contingent_without_primary', 'rules_unconfirmed']);
});

test('carrier profile refuses roles it does not accept', () => {
  const strict = { ...DEFAULT_PROFILE, allowsEstateBeneficiary: false, allowsJointOwner: false, allowsOutsideBeneficiary: false, allowsEqualShares: false, allowsTrustee: false };
  assert.equal(roleAllowed(strict, { role: 'beneficiary', outsideName: null, allocationMethod: 'estate' })?.code, 'estate_not_allowed');
  assert.equal(roleAllowed(strict, { role: 'joint_owner', outsideName: null, allocationMethod: null })?.code, 'joint_owner_not_allowed');
  assert.equal(roleAllowed(strict, { role: 'beneficiary', outsideName: 'Aunt', allocationMethod: 'percentage' })?.code, 'outside_not_allowed');
  assert.equal(roleAllowed(strict, { role: 'beneficiary', outsideName: null, allocationMethod: 'equal' })?.code, 'equal_not_allowed');
  assert.equal(roleAllowed(strict, { role: 'trustee', outsideName: 'T', allocationMethod: null })?.code, 'trustee_not_allowed');
  assert.equal(roleAllowed(DEFAULT_PROFILE, { role: 'joint_owner', outsideName: null, allocationMethod: null }), null);
});

test('currency comes from the jurisdiction and is never assumed', () => {
  assert.equal(currencyOf('CA-ON'), 'CAD');
  assert.equal(currencyOf('US-CA'), 'USD');
  assert.equal(currencyOf('GB'), null);
  assert.equal(currencyOf(null), null);
});
