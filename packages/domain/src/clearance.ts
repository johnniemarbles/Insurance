// "Cleared to transact": whether a partner may sell today, from the paperwork PII holds. Pure logic.
export const CLEARANCE_REASONS = ['not_approved', 'no_licence', 'licence_expired', 'no_eo', 'eo_expired', 'eo_limit_low', 'ce_prior_term_short', 'licence_register_problem'] as const;
export type ClearanceReason = (typeof CLEARANCE_REASONS)[number];

export const CLEARANCE_LABELS: Record<ClearanceReason, { en: string; 'fr-CA': string }> = {
  not_approved: { en: 'File not approved', 'fr-CA': 'Dossier non approuvé' },
  no_licence: { en: 'No licence on file', 'fr-CA': 'Aucun permis au dossier' },
  licence_expired: { en: 'Licence expired', 'fr-CA': 'Permis expiré' },
  no_eo: { en: 'No E&O policy on file', 'fr-CA': 'Aucune police E&O au dossier' },
  eo_expired: { en: 'E&O policy expired', 'fr-CA': 'Police E&O expirée' },
  eo_limit_low: { en: 'E&O limit below the minimum', 'fr-CA': 'Limite E&O sous le minimum' },
  ce_prior_term_short: { en: 'Continuing education short for the last term (check the rules)', 'fr-CA': 'Formation continue insuffisante pour la dernière période (vérifier les règles)' },
  licence_register_problem: { en: 'Regulator register shows a licence problem', 'fr-CA': 'Le registre de l’organisme de réglementation signale un problème de permis' },
};

export interface ClearanceInput {
  status: string | null;
  licences: number; validLicences: number;
  eoPolicies: number; validEo: number;
  /** Highest limit among E&O policies still in force. */
  eoMaxLimit: number | null;
  eoMin: number;
  /** True when someone PII tracked fell short of continuing education in the term that just ended. */
  cePriorShort?: boolean;
  /** True when the latest regulator register check of a licence was adverse (suspended, revoked, lapsed, not found). */
  registerProblem?: boolean;
}

/** Empty list means cleared. A licence or policy with no expiry date counts as in force. */
export function clearanceReasons(i: ClearanceInput): ClearanceReason[] {
  const r: ClearanceReason[] = [];
  if (i.status !== 'approved') r.push('not_approved');
  if (i.licences === 0) r.push('no_licence'); else if (i.validLicences === 0) r.push('licence_expired');
  if (i.eoPolicies === 0) r.push('no_eo'); else if (i.validEo === 0) r.push('eo_expired');
  else if (i.eoMin > 0 && (i.eoMaxLimit ?? 0) < i.eoMin) r.push('eo_limit_low');
  if (i.cePriorShort) r.push('ce_prior_term_short');
  if (i.registerProblem) r.push('licence_register_problem');
  return r;
}

/**
 * Frozen by expiry: a licence or an E&O policy is on file but none is still in force. A partner with nothing on file yet is
 * not frozen by this rule; it is simply not cleared (clearanceReasons). Used to stop carrier submissions (plan v6, section 2).
 */
export function coverageFrozen(i: { licences: number; validLicences: number; eoPolicies: number; validEo: number }): boolean {
  return (i.licences > 0 && i.validLicences === 0) || (i.eoPolicies > 0 && i.validEo === 0);
}
