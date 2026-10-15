import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedStanding, keepsAccessWhile, standingWarning, nextCheckDue, recheckStatus, stageMoveBlock, carrierPacketBlocks } from '../src/index.ts';

test('credit 600 and above passes when the background is clear', () => {
  assert.equal(suggestedStanding({ creditScore: 600, backgroundAdverse: false }), 'good_standing');
  assert.equal(suggestedStanding({ creditScore: 780, backgroundAdverse: false }), 'good_standing');
});
test('credit 575 to 599 goes to review, below 575 is not in good standing', () => {
  assert.equal(suggestedStanding({ creditScore: 599, backgroundAdverse: false }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 575, backgroundAdverse: false }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 574, backgroundAdverse: false }), 'not_in_good_standing');
});
test('an adverse background report sends the partner to review whatever the credit score', () => {
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: true }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 400, backgroundAdverse: true }), 'needs_review');
});
test('a missing result keeps the decision pending', () => {
  assert.equal(suggestedStanding({ creditScore: null, backgroundAdverse: false }), 'pending');
  assert.equal(suggestedStanding({ creditScore: 700, backgroundAdverse: null }), 'pending');
});
test('thresholds can be changed per country without touching the rules', () => {
  assert.equal(suggestedStanding({ creditScore: 650, backgroundAdverse: false }, { creditPassMin: 700, creditReviewMin: 650 }), 'needs_review');
});
test('review keeps access; only not in good standing removes it', () => {
  assert.equal(keepsAccessWhile('needs_review'), true);
  assert.equal(keepsAccessWhile('good_standing'), true);
  assert.equal(keepsAccessWhile('not_in_good_standing'), true, 'access continues, with a warning');
  assert.equal(standingWarning('not_in_good_standing'), true);
  assert.equal(standingWarning('good_standing'), false);
});
test('rechecks fall due every six months and warn 30 days ahead', () => {
  const last = new Date('2026-01-15T00:00:00Z');
  assert.equal(nextCheckDue(last).toISOString().slice(0, 10), '2026-07-15');
  assert.equal(recheckStatus(last, new Date('2026-06-01T00:00:00Z')), 'current');
  assert.equal(recheckStatus(last, new Date('2026-06-20T00:00:00Z')), 'due_soon');
  assert.equal(recheckStatus(last, new Date('2026-07-15T00:00:00Z')), 'overdue');
});
test('stages move one step at a time, and agency agreement needs good standing', () => {
  assert.equal(stageMoveBlock('invited', 'form_submitted', 'pending'), null);
  assert.equal(stageMoveBlock('invited', 'checks_requested', 'pending'), 'only_next_stage');
  assert.equal(stageMoveBlock('standing_decided', 'agency_agreement_sent', 'needs_review'), 'standing_not_good');
  assert.equal(stageMoveBlock('standing_decided', 'agency_agreement_sent', 'good_standing'), null);
});
test('a carrier packet waits for the agency agreement, activation, good standing and a current check', () => {
  const now = new Date('2026-10-13T00:00:00Z');
  const ok = { agencyAgreementSigned: true, stage: 'active' as const, standing: 'good_standing' as const, lastChecked: new Date('2026-09-01T00:00:00Z'), now };
  assert.deepEqual(carrierPacketBlocks(ok), []);
  assert.deepEqual(carrierPacketBlocks({ ...ok, agencyAgreementSigned: false }), ['agency_agreement_not_signed']);
  assert.deepEqual(carrierPacketBlocks({ ...ok, stage: 'agency_agreement_signed' }), ['not_active']);
  assert.deepEqual(carrierPacketBlocks({ ...ok, standing: 'needs_review' }), ['standing_not_good']);
  assert.deepEqual(carrierPacketBlocks({ ...ok, lastChecked: new Date('2026-01-01T00:00:00Z') }), ['check_overdue']);
  assert.deepEqual(carrierPacketBlocks({ ...ok, lastChecked: null }), ['check_overdue']);
});

// Onboarding plan, section 2 (adopted from the external review): a credit score alone never passes a broker.
test('an undischarged bankruptcy, proposal, arrangement or judgment goes to review, whatever the score', () => {
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: true }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 300, backgroundAdverse: false, insolvencyOrJudgment: true }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: false }), 'good_standing');
});

test('a yes to any red-flag screening question goes to review', () => {
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: false, redFlag: true }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: false, redFlag: false }), 'good_standing');
});

test('a red flag never turns a low score into a pass, and a missing answer is pending once the questionnaire is required', () => {
  assert.equal(suggestedStanding({ creditScore: 500, backgroundAdverse: false, insolvencyOrJudgment: false, redFlag: true }), 'needs_review');
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: null }), 'pending');
  assert.equal(suggestedStanding({ creditScore: 800, backgroundAdverse: false, insolvencyOrJudgment: false, redFlag: null }), 'pending');
});

// Ownership tiers for a corporate broker (onboarding plan, section 7): directors and holders of 25% or more are identified;
// holders of 10% or more sign personal guarantees; every person gets a PEP and HIO determination; if nobody holds 25% or more,
// the steps taken to reach that conclusion are recorded.
import { ownershipProblems, type OwnerRecord } from '../src/onboarding.ts';
const person = (over: Partial<OwnerRecord> = {}): OwnerRecord => ({ isDirector: false, sharePercent: 0, identified: false, pepHioDetermined: false, guaranteeSigned: false, ...over });

test('a broker type must be recorded before ownership is judged', () => {
  assert.deepEqual(ownershipProblems(null, [], false), ['type_missing']);
});

test('an individual broker needs no ownership tiers', () => {
  assert.deepEqual(ownershipProblems('individual', [], false), []);
});

test('a corporate broker needs at least one director', () => {
  assert.ok(ownershipProblems('corporate', [person({ sharePercent: 30, identified: true, pepHioDetermined: true, guaranteeSigned: true })], true).includes('directors_missing'));
});

test('a corporate broker with a complete, verified file has no problems', () => {
  const owners = [
    person({ isDirector: true, sharePercent: 40, identified: true, pepHioDetermined: true, guaranteeSigned: true }),
    person({ sharePercent: 30, identified: true, pepHioDetermined: true, guaranteeSigned: true }),
    person({ isDirector: true, sharePercent: 8, identified: true, pepHioDetermined: true }),
    person({ sharePercent: 22, pepHioDetermined: true, guaranteeSigned: true }),
  ];
  assert.deepEqual(ownershipProblems('corporate', owners, false), []);
});

test('a director or a holder of 25% or more must be identified', () => {
  const owners = [person({ isDirector: true, sharePercent: 40, pepHioDetermined: true, guaranteeSigned: true })];
  assert.ok(ownershipProblems('corporate', owners, false).includes('identity_missing'));
});

test('a holder of 10% or more signs a personal guarantee', () => {
  const owners = [person({ isDirector: true, sharePercent: 12, identified: true, pepHioDetermined: true })];
  assert.ok(ownershipProblems('corporate', owners, false).includes('guarantee_missing'));
});

test('a holder under 10% does not need a guarantee', () => {
  const owners = [person({ isDirector: true, sharePercent: 9, identified: true, pepHioDetermined: true }), person({ sharePercent: 91, identified: true, pepHioDetermined: true, guaranteeSigned: true })];
  assert.ok(!ownershipProblems('corporate', owners, false).includes('guarantee_missing'));
});

test('every person needs a PEP and HIO determination', () => {
  const owners = [person({ isDirector: true, sharePercent: 40, identified: true, guaranteeSigned: true })];
  assert.ok(ownershipProblems('corporate', owners, false).includes('pep_hio_missing'));
});

test('with nobody at 25% or more, the steps taken must be recorded', () => {
  const owners = [person({ isDirector: true, sharePercent: 20, identified: true, pepHioDetermined: true, guaranteeSigned: false })];
  assert.ok(ownershipProblems('corporate', owners, false).includes('steps_missing'));
  assert.ok(!ownershipProblems('corporate', owners, true).includes('steps_missing'));
});

test('an expired licence or E&O freezes carrier submissions, and the freeze is named', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const clear = { agencyAgreementSigned: true, stage: 'active' as const, standing: 'good_standing' as const, lastChecked: new Date('2026-09-01T00:00:00Z'), now };
  assert.deepEqual(carrierPacketBlocks({ ...clear, frozenForExpiry: false }), []);
  assert.deepEqual(carrierPacketBlocks({ ...clear, frozenForExpiry: true }), ['licence_or_eo_expired']);
});
