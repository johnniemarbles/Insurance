import type { Locale } from './types.ts';
/** The kinds of paperwork a stage can require. Keys match the server's DOC_TYPES. */
export const DOC_TYPES: { k: string; l: Record<Locale, string> }[] = [
  { k: 'privacy_consent', l: { en: 'Privacy consent', 'fr-CA': 'Consentement à la vie privée' } },
  { k: 'brokerage_agreement', l: { en: 'Brokerage agreement', 'fr-CA': 'Contrat de courtage' } },
  { k: 'needs_analysis', l: { en: 'Needs analysis', 'fr-CA': 'Analyse des besoins' } },
  { k: 'id_record', l: { en: 'Client ID record', 'fr-CA': 'Dossier d’identité du client' } },
  { k: 'pink_slip_optin', l: { en: 'Electronic card opt-in', 'fr-CA': 'Consentement à la carte électronique' } },
  { k: 'beneficiary_designation', l: { en: 'Beneficiary designation', 'fr-CA': 'Désignation de bénéficiaire' } },
  { k: 'recommendation', l: { en: 'Recommendation', 'fr-CA': 'Recommandation' } },
  { k: 'replacement_disclosure', l: { en: 'Replacement disclosure', 'fr-CA': 'Divulgation de remplacement' } },
  { k: 'suitability_review', l: { en: 'Suitability review', 'fr-CA': 'Examen de la convenance' } },
];
/** Uploads can be typed as any of these; a suitability review is made in PII, never uploaded. */
export const UPLOAD_DOC_TYPES = DOC_TYPES.filter((d) => d.k !== 'suitability_review');
export const docLabel = (k: string, locale: Locale) => DOC_TYPES.find((d) => d.k === k)?.l[locale] ?? k;
