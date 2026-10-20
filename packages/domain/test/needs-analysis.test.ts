import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcNeed, adviceFlags, missingNeeds, missingRecommendation, validUntil, isNaCurrent, reviewReasonFor,
  NEEDS_SECTIONS, type NeedsAnswers, type RecommendationAnswers,
} from '../src/needs-analysis.ts';

const full: NeedsAnswers = {
  productLine: 'life_health', maritalStatus: 'married', dependants: 2, occupation: 'Engineer',
  annualIncome: 90000, monthlyExpenses: 4000, liquidAssets: 20000, mortgage: 400000, otherDebts: 10000,
  existingIndividual: 100000, existingGroup: 90000, existingPolicies: 'Group life at work', replacing: false,
  objectives: ['income_replacement', 'debt_payoff'], method: 'capital_needs', incomeYears: 10, finalExpenses: 15000, educationFund: 50000, otherNeeds: 0,
  monthlyBudget: 150, licenceDisclosed: true, insurersDisclosed: true, compensationDisclosed: true, conflictsDisclosed: true,
  advisorLicence: 'LLQP-123456', advisorProvince: 'ON', attestation: true,
};

test('the need is income for the years chosen plus debts and costs, less what is already in place', () => {
  const c = calcNeed(full);
  assert.equal(c.totalNeed, 90000 * 10 + 400000 + 10000 + 15000 + 50000);
  assert.equal(c.existing, 100000 + 90000 + 20000);
  assert.equal(c.gap, c.totalNeed - c.existing);
  assert.equal(calcNeed({ ...full, annualIncome: 0, mortgage: 0, otherDebts: 0, finalExpenses: 0, educationFund: 0 }).gap, 0, 'never negative');
  assert.equal(calcNeed({ ...full, needOverride: 500000, needOverrideReason: 'Client wants a round figure' }).totalNeed, 500000);
});

test('a complete life needs analysis has nothing missing; gaps are named', () => {
  assert.deepEqual(missingNeeds(full), []);
  const m = missingNeeds({ ...full, annualIncome: undefined, objectives: [], licenceDisclosed: false, attestation: false, replacing: undefined });
  for (const k of ['annualIncome', 'objectives', 'licenceDisclosed', 'attestation', 'replacing']) assert.ok(m.includes(k), k);
  assert.ok(missingNeeds({ ...full, replacing: true }).includes('replacingNote'), 'a replacement needs the details');
  assert.ok(missingNeeds({ ...full, needOverride: 1 }).includes('needOverrideReason'), 'an override needs a reason');
  assert.ok(missingNeeds({ ...full, conflictsDisclosed: true, hasConflict: true }).includes('conflictNote'));
});

test('investment-linked or annuity sales need a risk and suitability profile', () => {
  const ul = { ...full, objectives: ['savings_retirement' as const] };
  for (const k of ['riskTolerance', 'horizonYears']) assert.ok(missingNeeds(ul).includes(k), k);
  const ann: NeedsAnswers = { ...full, productLine: 'annuity' };
  for (const k of ['riskTolerance', 'horizonYears', 'liquidityNeeds', 'taxStatus', 'sourceOfFunds', 'financialExperience']) assert.ok(missingNeeds(ann).includes(k), k);
  assert.deepEqual(missingNeeds({ ...ann, riskTolerance: 'low', horizonYears: 10, liquidityNeeds: 'Needs 10% access', taxStatus: 'non_qualified', sourceOfFunds: 'Savings', financialExperience: 'moderate' }), []);
});

test('every field the checks name is drawn on the form', () => {
  const drawn = new Set(NEEDS_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));
  const all = missingNeeds({ productLine: 'annuity', objectives: ['savings_retirement'], replacing: true, needOverride: 1, hasConflict: true } as NeedsAnswers);
  for (const k of all) assert.ok(drawn.has(k), `${k} is on the form`);
});

const rec: RecommendationAnswers = {
  product: 'Term 20', insurer: 'Maple Life', coverageAmount: 1000000, monthlyPremium: 120, reasons: 'Lowest premium that covers the gap', alternatives: 'Term 10 and whole life',
  clientDecision: 'accepted', illustrationDelivered: true, summaryDelivered: true, applicationCopyDelivered: true,
};

test('a recommendation needs reasons, alternatives, a decision and point-of-sale delivery', () => {
  assert.deepEqual(missingRecommendation(rec), []);
  const m = missingRecommendation({ ...rec, reasons: '', alternatives: ' ', illustrationDelivered: false });
  for (const k of ['reasons', 'alternatives', 'illustrationDelivered']) assert.ok(m.includes(k), k);
  assert.ok(missingRecommendation({ ...rec, clientDecision: 'accepted_less' }).includes('clientAcknowledgement'));
});

test('flags: below the need, over budget, replacing, client took less; and they force a review', () => {
  const gap = calcNeed(full).gap;
  assert.deepEqual(adviceFlags(full, { ...rec, coverageAmount: gap }), []);
  const f = adviceFlags({ ...full, replacing: true, replacingNote: 'Replacing old term' }, { ...rec, coverageAmount: gap - 1, monthlyPremium: 200, clientDecision: 'accepted_less', clientAcknowledgement: 'I chose less' });
  assert.deepEqual(f.sort(), ['below_need', 'client_chose_less', 'over_budget', 'replacement'].sort());
  assert.deepEqual(adviceFlags({ ...full, replacing: true }, null), ['replacement']);
  assert.equal(reviewReasonFor({ flags: ['replacement'], advisorDays: 400, samplePct: 0, roll: 0.99 }), 'flagged');
  assert.equal(reviewReasonFor({ flags: [], advisorDays: 30, samplePct: 0, roll: 0.99, newAdvisorDays: 90 }), 'new_advisor');
  assert.equal(reviewReasonFor({ flags: [], advisorDays: 400, samplePct: 10, roll: 0.05 }), 'random');
  assert.equal(reviewReasonFor({ flags: [], advisorDays: 400, samplePct: 10, roll: 0.5 }), null);
});

test('a needs analysis is current until its validity runs out', () => {
  assert.equal(validUntil(new Date('2026-03-31T12:00:00Z'), 12), '2027-03-31');
  assert.equal(validUntil(new Date('2026-01-31T12:00:00Z'), 1), '2026-02-28', 'month ends clamp');
  assert.equal(isNaCurrent('2027-03-31', new Date('2027-03-31T23:00:00Z')), true);
  assert.equal(isNaCurrent('2027-03-31', new Date('2027-04-01T01:00:00Z')), false);
  assert.equal(isNaCurrent(null, new Date()), true, 'older records with no date are not expired by this rule');
});

test('answers are cleaned: unknown keys, wrong types and negative money are dropped', async () => {
  const { cleanNeeds, cleanRecommendation } = await import('../src/needs-analysis.ts');
  const a = cleanNeeds({ annualIncome: '85000.4', mortgage: -5, dependants: 2.6, maritalStatus: 'pirate', objectives: ['estate', 'estate', 'bogus'], replacing: 'yes', evil: '<script>', licenceDisclosed: true });
  assert.deepEqual(a, { annualIncome: 85000.4, dependants: 3, objectives: ['estate'], licenceDisclosed: true, productLine: 'life_health' });
  assert.deepEqual(cleanRecommendation({ product: '  Term 20 ', clientDecision: 'maybe', coverageAmount: 1e12 }), { product: 'Term 20' });
});
