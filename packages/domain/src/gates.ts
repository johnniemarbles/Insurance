// File-completeness gates: which kinds of document a record may be required to hold before it enters a stage.
// Pure logic, shared by the server and the screens.

export const DOC_TYPES = ['privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, { en: string; 'fr-CA': string }> = {
  privacy_consent: { en: 'Privacy consent', 'fr-CA': 'Consentement à la vie privée' },
  brokerage_agreement: { en: 'Brokerage agreement', 'fr-CA': 'Contrat de courtage' },
  needs_analysis: { en: 'Needs analysis', 'fr-CA': 'Analyse des besoins' },
  id_record: { en: 'Client ID record', 'fr-CA': 'Dossier d’identité du client' },
  pink_slip_optin: { en: 'Electronic card opt-in', 'fr-CA': 'Consentement à la carte électronique' },
  beneficiary_designation: { en: 'Beneficiary designation', 'fr-CA': 'Désignation de bénéficiaire' },
};

export const isDocType = (v: unknown): v is DocType => typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);

/** What a record is still missing for a stage: required types with no document filed, minus any covered by an override. */
export function missingDocs(required: readonly string[], filed: readonly string[], overridden: readonly string[]): string[] {
  const have = new Set(filed);
  const waived = new Set(overridden);
  return required.filter((t) => !have.has(t) && !waived.has(t));
}

export const MIN_OVERRIDE_REASON = 10;
