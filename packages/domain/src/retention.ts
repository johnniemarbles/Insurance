// Retention periods and the lifecycle of a client file's records. Pure logic. Defaults are a starting point that counsel confirms; a company may lengthen them, never go below the minimum.
export const RETENTION_KINDS = ['advice', 'aml', 'consent', 'ce_certificate'] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];
export const RETENTION_DEFAULT: Record<RetentionKind, number> = { advice: 15, aml: 5, consent: 3, ce_certificate: 5 };
export const RETENTION_MIN: Record<RetentionKind, number> = { advice: 7, aml: 5, consent: 3, ce_certificate: 3 };
export const RETENTION_MAX = 30;
export const RETENTION_LABELS: Record<RetentionKind, { en: string; 'fr-CA': string }> = {
  advice: { en: 'Advice records and client paperwork', 'fr-CA': 'Dossiers de conseil et documents du client' },
  aml: { en: 'ID, screening and cash records (FINTRAC)', 'fr-CA': 'Dossiers d’identité, de vérification et d’espèces (CANAFE)' },
  consent: { en: 'Privacy and electronic-message consents', 'fr-CA': 'Consentements à la vie privée et aux messages électroniques' },
  ce_certificate: { en: 'CE certificates', 'fr-CA': 'Certificats de formation continue' },
};
const DOC_KIND: Record<string, RetentionKind> = { privacy_consent: 'consent', pink_slip_optin: 'consent', id_record: 'aml' };
/** Which clock a typed document follows. Anything else (advice, mandates, untyped) follows the longest one. */
export const retentionKindForDoc = (docType: string | null): RetentionKind => (docType ? DOC_KIND[docType] : undefined) ?? 'advice';

export const retentionYears = (kind: RetentionKind, custom: number | null | undefined): number =>
  Math.min(RETENTION_MAX, Math.max(RETENTION_MIN[kind], custom ?? RETENTION_DEFAULT[kind]));

export type LifecycleState = 'active' | 'retained' | 'held' | 'due';
/** Active until the file closes. After that it is retained until the period ends, then due for review. A legal hold stops the clock from mattering. */
export function lifecycleState(closedAt: Date | null, years: number, held: boolean, now = new Date()): { state: LifecycleState; retainUntil: Date | null } {
  if (!closedAt) return { state: held ? 'held' : 'active', retainUntil: null };
  const until = new Date(closedAt); until.setUTCFullYear(until.getUTCFullYear() + years);
  if (held) return { state: 'held', retainUntil: until };
  return { state: now.getTime() >= until.getTime() ? 'due' : 'retained', retainUntil: until };
}
