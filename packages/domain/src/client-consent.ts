// Client consents and their wording. Pure logic. Wording is a DRAFT until counsel signs it off; the version string is stored with every consent.
export const CONSENT_KINDS = ['collection_use', 'carrier_sharing', 'electronic_comms', 'pink_slip_optin'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const CONSENT_CHANNELS = ['in_person', 'phone', 'email', 'esign'] as const;
export const WORDING_VERSION = 'draft-1';
export const CONSENT_WORDING: Record<ConsentKind, { en: string; 'fr-CA': string }> = {
  collection_use: { en: 'Collection and use of my personal information to give insurance advice and arrange cover.', 'fr-CA': 'Collecte et utilisation de mes renseignements personnels pour fournir des conseils en assurance et organiser ma protection.' },
  carrier_sharing: { en: 'Sharing my personal information with the insurance companies named to me, for quotes and applications.', 'fr-CA': 'Communication de mes renseignements personnels aux assureurs qui m’ont été nommés, pour des soumissions et des demandes.' },
  electronic_comms: { en: 'Receiving commercial electronic messages from this brokerage, including email. I can withdraw at any time.', 'fr-CA': 'Réception de messages électroniques commerciaux de ce cabinet, y compris par courriel. Je peux me retirer en tout temps.' },
  pink_slip_optin: { en: 'Receiving my proof of insurance card electronically instead of on paper.', 'fr-CA': 'Réception de ma carte de preuve d’assurance par voie électronique plutôt que sur papier.' },
};
/** A consent kind that, while active, satisfies a paperwork gate. A withdrawal re-opens the gate. */
export const CONSENT_GATE_TYPE: Partial<Record<ConsentKind, string>> = { collection_use: 'privacy_consent', pink_slip_optin: 'pink_slip_optin' };

/** The latest row of each kind decides: active when it has not been withdrawn, withdrawn otherwise. */
export function consentStates(rows: { kind: string; createdAt: string | number; withdrawnAt: string | null }[]): { active: string[]; withdrawn: string[] } {
  const latest = new Map<string, { t: number; w: boolean }>();
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime(); const c = latest.get(r.kind);
    if (!c || t >= c.t) latest.set(r.kind, { t, w: !!r.withdrawnAt });
  }
  const e = [...latest.entries()];
  return { active: e.filter(([, v]) => !v.w).map(([k]) => k), withdrawn: e.filter(([, v]) => v.w).map(([k]) => k) };
}
