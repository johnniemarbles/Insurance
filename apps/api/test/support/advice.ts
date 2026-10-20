// Test fixture: complete structured answers, so tests that are not about the fact-find can sign advice the way the product requires.
export const NEEDS_FULL = {
  productLine: 'life_health', maritalStatus: 'married', dependants: 2, occupation: 'Engineer',
  annualIncome: 90000, monthlyExpenses: 4000, liquidAssets: 20000, mortgage: 400000, otherDebts: 10000,
  existingIndividual: 100000, existingGroup: 90000, replacing: false,
  objectives: ['income_replacement', 'debt_payoff'], method: 'capital_needs', incomeYears: 10, finalExpenses: 15000, educationFund: 50000,
  monthlyBudget: 150, licenceDisclosed: true, insurersDisclosed: true, compensationDisclosed: true, conflictsDisclosed: true,
  advisorLicence: 'LLQP-123456', advisorProvince: 'ON', attestation: true,
};
export const REC_FULL = {
  product: 'Term 20', insurer: 'Maple Life', coverageAmount: 1_500_000, monthlyPremium: 120, reasons: 'Lowest premium that covers the gap',
  alternatives: 'Term 10 and whole life', clientDecision: 'accepted', illustrationDelivered: true, summaryDelivered: true, applicationCopyDelivered: true,
};
/** Adds the structured answers a needs analysis or recommendation needs, unless the test gave its own. */
export const withAnswers = (kind: string, extra: Record<string, unknown> = {}) =>
  kind === 'needs_analysis' ? { answers: NEEDS_FULL, ...extra } : kind === 'recommendation' ? { answers: REC_FULL, ...extra } : extra;
