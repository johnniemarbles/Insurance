// "Cleared to transact": whether a partner may sell today, from the paperwork PII holds. Pure logic.
export const CLEARANCE_REASONS = ['not_approved', 'no_licence', 'licence_expired', 'no_eo', 'eo_expired', 'eo_limit_low'] as const;
export type ClearanceReason = (typeof CLEARANCE_REASONS)[number];

export const CLEARANCE_LABELS: Record<ClearanceReason, { en: string; 'fr-CA': string }> = {
  not_approved: { en: 'File not approved', 'fr-CA': 'Dossier non approuvé' },
  no_licence: { en: 'No licence on file', 'fr-CA': 'Aucun permis au dossier' },
  licence_expired: { en: 'Licence expired', 'fr-CA': 'Permis expiré' },
  no_eo: { en: 'No E&O policy on file', 'fr-CA': 'Aucune police E&O au dossier' },
  eo_expired: { en: 'E&O policy expired', 'fr-CA': 'Police E&O expirée' },
  eo_limit_low: { en: 'E&O limit below the minimum', 'fr-CA': 'Limite E&O sous le minimum' },
};

export interface ClearanceInput {
  status: string | null;
  licences: number; validLicences: number;
  eoPolicies: number; validEo: number;
  /** Highest limit among E&O policies still in force. */
  eoMaxLimit: number | null;
  eoMin: number;
}

/** Empty list means cleared. A licence or policy with no expiry date counts as in force. */
export function clearanceReasons(i: ClearanceInput): ClearanceReason[] {
  const r: ClearanceReason[] = [];
  if (i.status !== 'approved') r.push('not_approved');
  if (i.licences === 0) r.push('no_licence'); else if (i.validLicences === 0) r.push('licence_expired');
  if (i.eoPolicies === 0) r.push('no_eo'); else if (i.validEo === 0) r.push('eo_expired');
  else if (i.eoMin > 0 && (i.eoMaxLimit ?? 0) < i.eoMin) r.push('eo_limit_low');
  return r;
}
