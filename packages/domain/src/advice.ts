// Advice records and signing tiers. Pure logic.
export const ADVICE_KINDS = ['needs_analysis', 'recommendation', 'beneficiary_designation', 'replacement_disclosure'] as const;
export type AdviceKind = (typeof ADVICE_KINDS)[number];
export const ADVICE_LABELS: Record<AdviceKind, { en: string; 'fr-CA': string }> = {
  needs_analysis: { en: 'Needs analysis', 'fr-CA': 'Analyse des besoins' },
  recommendation: { en: 'Recommendation', 'fr-CA': 'Recommandation' },
  beneficiary_designation: { en: 'Beneficiary designation', 'fr-CA': 'Désignation de bénéficiaire' },
  replacement_disclosure: { en: 'Replacement disclosure', 'fr-CA': 'Divulgation de remplacement' },
};
export type SigningTier = 'builtin' | 'vendor';
/** Carriers generally require a certified third-party e-signature for beneficiary and replacement paperwork; the built-in one-time-code signature covers the rest. */
export function signingTierFor(kind: AdviceKind): SigningTier {
  return kind === 'beneficiary_designation' || kind === 'replacement_disclosure' ? 'vendor' : 'builtin';
}
/** A kind that also satisfies a file-completeness gate once signed. */
export function gateTypeFor(kind: AdviceKind): string | null {
  return kind === 'needs_analysis' || kind === 'beneficiary_designation' ? kind : null;
}
export const OTP_MINUTES = 15;
export const OTP_MAX_ATTEMPTS = 5;
