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
