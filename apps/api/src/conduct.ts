// Conduct risk flags (roadmap Phase 3, feature 11): the rules. Each takes counts PII already holds and returns a flag
// with the numbers behind it, so a person can see exactly why. No model, no hidden score. No database here.
export const conductFlagsEnabled = (): boolean => ['1', 'true'].includes(String(process.env.CONDUCT_FLAGS_ENABLED ?? '').toLowerCase());

export type Severity = 'high' | 'medium' | 'low';
export interface Flag { subjectType: 'advisor' | 'client' | 'deal'; subjectId: string; subjectName: string; code: string; severity: Severity; numbers: Record<string, number>; fingerprint: string }

/** The thresholds, in one place, so the documentation and the screens can show them. */
export const RULES = {
  replacement_churn: { minCount: 3, minShare: 0.3, highShare: 0.5, months: 12 },
  early_lapse: { minCount: 2, minRate: 0.1, withinMonths: 24, lookbackMonths: 12 },
  many_policies: { minPolicies: 3, months: 24 },
  premium_to_income: { share: 0.15, highShare: 0.25 },
  complaints: { minCount: 2, months: 12, openDays: 30 },
  missing_review: { policyOlderMonths: 12, noAnalysisMonths: 24 },
} as const;

const fp = (code: string, n: Record<string, number>) => `${code}:${Object.keys(n).sort().map((k) => `${k}=${Math.round(n[k]! * 1000) / 1000}`).join(',')}`;
const make = (subjectType: Flag['subjectType'], subjectId: string, subjectName: string, code: string, severity: Severity, numbers: Record<string, number>): Flag =>
  ({ subjectType, subjectId, subjectName, code, severity, numbers, fingerprint: fp(code, numbers) });

export function replacementChurn(rows: { node: string; name: string; recs: number; replacements: number }[]): Flag[] {
  const r = RULES.replacement_churn;
  return rows.flatMap((x) => {
    const share = x.replacements / Math.max(1, x.recs);
    if (x.replacements < r.minCount || share < r.minShare) return [];
    return [make('advisor', x.node, x.name, 'replacement_churn', share >= r.highShare ? 'high' : 'medium', { replacements: x.replacements, recommendations: x.recs, share })];
  });
}

export function earlyLapses(rows: { node: string; name: string; issued: number; early: number }[]): Flag[] {
  const r = RULES.early_lapse;
  return rows.flatMap((x) => {
    const rate = x.early / Math.max(1, x.issued);
    if (x.early < r.minCount || rate < r.minRate) return [];
    return [make('advisor', x.node, x.name, 'early_lapse', rate >= 0.2 ? 'high' : 'medium', { early: x.early, issued: x.issued, rate })];
  });
}

export function manyPolicies(rows: { contact: string; name: string; policies: number }[]): Flag[] {
  return rows.filter((x) => x.policies >= RULES.many_policies.minPolicies).map((x) => make('client', x.contact, x.name, 'many_policies', x.policies >= 5 ? 'high' : 'medium', { policies: x.policies }));
}

export function premiumToIncome(rows: { box: string; name: string; monthlyPremium: number; annualIncome: number }[]): Flag[] {
  const r = RULES.premium_to_income;
  return rows.flatMap((x) => {
    if (!(x.annualIncome > 0) || !(x.monthlyPremium > 0)) return [];
    const share = (x.monthlyPremium * 12) / x.annualIncome;
    if (share <= r.share) return [];
    return [make('deal', x.box, x.name, 'premium_to_income', share > r.highShare ? 'high' : 'medium', { annualPremium: x.monthlyPremium * 12, income: x.annualIncome, share })];
  });
}

export function complaints(rows: { node: string; name: string; count: number; openLate: number }[]): Flag[] {
  return rows.flatMap((x) => [
    ...(x.count >= RULES.complaints.minCount ? [make('advisor', x.node, x.name, 'complaints', x.count >= 4 ? 'high' : 'medium', { complaints: x.count })] : []),
    ...(x.openLate > 0 ? [make('advisor', x.node, x.name, 'complaint_unresolved', 'high', { open: x.openLate })] : []),
  ]);
}

export function missingReviews(rows: { contact: string; name: string; policies: number }[]): Flag[] {
  return rows.filter((x) => x.policies > 0).map((x) => make('client', x.contact, x.name, 'missing_review', 'low', { policies: x.policies }));
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const sortFlags = (f: Flag[]) => [...f].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code) || a.subjectName.localeCompare(b.subjectName));
