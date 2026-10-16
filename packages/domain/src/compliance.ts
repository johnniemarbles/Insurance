// Partner compliance rules shared by the server and the screens. Pure logic: no database access here.
// PII records the status of sensitive paperwork. It never holds SSN or SIN numbers, bank details or signed tax forms.

export type Country = 'CA' | 'US';
export type ComplianceStatus = 'incomplete' | 'submitted' | 'approved' | 'rejected';
export type AgreementStatus = 'not_sent' | 'sent' | 'signed';
export type AppointmentStatus = 'requested' | 'in_progress' | 'appointed' | 'declined';
export type ItemKind = 'licence' | 'eo';

export const ENTITY_TYPES: Record<Country, readonly string[]> = {
  CA: ['sole_proprietor', 'partnership', 'corporation', 'other'],
  US: ['sole_proprietor', 'llc', 's_corp', 'partnership', 'corporation', 'other'],
};

/** Lines of authority a licence can cover. Free text is not accepted, so reports stay clean. */
export const LINES_OF_AUTHORITY: Record<Country, readonly string[]> = {
  CA: ['life', 'accident_sickness', 'property_casualty'],
  US: ['life', 'accident_health', 'property', 'casualty', 'variable'],
};

/** Extra profile fields that only one country asks for. Stored as JSON, so a new country is a new list, not a new column. */
export interface ProfileField { key: string; label: { en: string; 'fr-CA': string }; maxLength: number; options?: readonly string[] }
export const PROFILE_FIELDS: Record<Country, readonly ProfileField[]> = {
  CA: [
    { key: 'street', label: { en: 'Street address', 'fr-CA': 'Adresse' }, maxLength: 60 },
    { key: 'city', label: { en: 'City', 'fr-CA': 'Ville' }, maxLength: 60 },
    { key: 'province', label: { en: 'Province or territory', 'fr-CA': 'Province ou territoire' }, maxLength: 40, options: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] },
    { key: 'postal', label: { en: 'Postal code', 'fr-CA': 'Code postal' }, maxLength: 10 },
    { key: 'gst_hst', label: { en: 'GST/HST registration number', 'fr-CA': 'Numéro d’inscription TPS/TVH' }, maxLength: 40 },
    // BC supervision (optional for now). Counsel confirms the 24-month rule before go-live; nothing is required yet.
    { key: 'bc_supervisor_name', label: { en: 'BC supervising licensee name (optional, BC agents under 24 months)', 'fr-CA': 'Nom du titulaire de licence superviseur en C.-B. (facultatif, agents de moins de 24 mois)' }, maxLength: 60 },
    { key: 'bc_supervisor_licence', label: { en: 'BC supervising licensee licence number (optional)', 'fr-CA': 'Numéro de licence du titulaire superviseur en C.-B. (facultatif)' }, maxLength: 20 },
  ],
  US: [
    { key: 'state', label: { en: 'Home state', 'fr-CA': 'État d’origine' }, maxLength: 2 },
    { key: 'npn', label: { en: 'National Producer Number (NPN)', 'fr-CA': 'National Producer Number (NPN)' }, maxLength: 20 },
  ],
};

export const BUSINESS_NUMBER_LABEL: Record<Country, { en: string; 'fr-CA': string }> = {
  CA: { en: 'Business Number (BN)', 'fr-CA': 'Numéro d’entreprise (NE)' },
  US: { en: 'Employer Identification Number (EIN)', 'fr-CA': 'Numéro d’identification d’employeur (EIN)' },
};

export const STEP_IDS = ['profile', 'licence', 'eo', 'attestation', 'agreement'] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface ChecklistInput {
  profile: { entityType?: string | null; legalName?: string | null; businessNumber?: string | null; attestedAt?: string | null; agreementStatus?: string | null } | null;
  licences: number;
  eoCount: number;
  /** Highest coverage limit among E&O policies that have not run out. */
  eoMaxLimit: number | null;
  /** The smallest limit the company or country allows; 0 means no minimum. */
  eoMin: number;
}
export interface ChecklistStep { id: StepId; done: boolean; /** Why a step that has something entered is still not done. */ hint?: 'limit_low' }
export interface Checklist { steps: ChecklistStep[]; percent: number; complete: boolean }

export function computeChecklist(i: ChecklistInput): Checklist {
  const p = i.profile;
  const profileDone = !!p?.entityType && !!p.legalName?.trim() && (p.entityType === 'sole_proprietor' || !!p.businessNumber?.trim());
  const limitOk = i.eoMin <= 0 || (i.eoMaxLimit ?? 0) >= i.eoMin;
  const steps: ChecklistStep[] = [
    { id: 'profile', done: profileDone },
    { id: 'licence', done: i.licences >= 1 },
    { id: 'eo', done: i.eoCount >= 1 && limitOk, ...(i.eoCount >= 1 && !limitOk ? { hint: 'limit_low' as const } : {}) },
    { id: 'attestation', done: !!p?.attestedAt },
    { id: 'agreement', done: p?.agreementStatus === 'signed' },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, percent: Math.round((done / steps.length) * 100), complete: done === steps.length };
}

/** Reminders go out 90, 60, 30 and 0 days before an expiry date. Returns the tightest one that applies, or null if it is further out. */
export const REMINDER_DAYS = [90, 60, 30, 0] as const;
export function reminderThreshold(daysLeft: number): (typeof REMINDER_DAYS)[number] | null {
  if (daysLeft <= 0) return 0;
  if (daysLeft <= 30) return 30;
  if (daysLeft <= 60) return 60;
  if (daysLeft <= 90) return 90;
  return null;
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none';
export function expiryState(daysLeft: number | null): ExpiryState {
  if (daysLeft === null) return 'none';
  if (daysLeft < 0) return 'expired';
  return daysLeft <= 30 ? 'soon' : 'ok';
}

/** The effective E&O minimum: the country default can be raised by a company but never lowered. */
export function effectiveEoMin(countryDefault: number, companySetting: number | null | undefined): number {
  const a = Number.isFinite(countryDefault) && countryDefault > 0 ? countryDefault : 0;
  const b = typeof companySetting === 'number' && companySetting > 0 ? companySetting : 0;
  return Math.max(a, b);
}

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const MAX_DOCS_PER_PARTNER = 20;
export type DocMime = 'application/pdf' | 'image/png' | 'image/jpeg';

/** The first bytes decide what a file is, whatever its name or declared type says. */
export function sniffMime(bytes: Uint8Array): DocMime | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  return null;
}

/** A file name safe to store and to send back in a download header. */
export function safeFilename(name: string, mime: DocMime): string {
  const ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document';
  return base + ext;
}
