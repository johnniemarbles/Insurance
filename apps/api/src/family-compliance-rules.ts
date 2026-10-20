// Families, Gate C: pure rules for consent reuse, capacity ages, ID currency and review timing. No database access here,
// so every rule can be tested on its own.

export const PURPOSES = ['collection_use', 'carrier_sharing', 'electronic_comms', 'pink_slip_optin', 'marketing'] as const;
export type Purpose = (typeof PURPOSES)[number];
export const AUTHORITY_PURPOSES = [...PURPOSES, 'policy_changes'] as const;
export const AUTHORITY_KINDS = ['guardian_of_minor', 'poa_property', 'poa_personal_care', 'court_appointed', 'other_representative'] as const;
export const AUTHORITY_END_REASONS = ['expired', 'revoked', 'subject_came_of_age', 'subject_deceased', 'holder_deceased', 'entered_in_error', 'replaced'] as const;
export const LIFE_EVENT_KINDS = ['separation', 'death', 'guardianship_change', 'move', 'marriage_partnership', 'birth_adoption', 'other'] as const;
export const ID_METHODS = ['in_person', 'credit_file', 'dual_process'] as const;
export const ID_RESULTS = ['verified', 'failed', 'referred'] as const;
export const ID_DOCUMENTS = ['passport', 'drivers_licence', 'provincial_id', 'permanent_resident_card', 'citizenship_card',
  'birth_certificate', 'credit_file', 'utility_bill', 'bank_statement', 'government_letter', 'other'] as const;
export const DEAL_ROLES = ['applicant', 'co_applicant', 'insured', 'payor', 'beneficiary', 'representative'] as const;
export const CAPACITY_ACTIVITIES = ['age_of_majority', 'privacy_consent', 'apply_for_insurance', 'own_policy', 'receive_benefit'] as const;
export const CHANNELS = ['in_person', 'phone', 'email', 'esign'] as const;

/** Purposes whose withdrawal also stops email to the person (the existing opt-out flag that merges already respect). */
export const STOPS_EMAIL: readonly Purpose[] = ['electronic_comms', 'marketing'];

/**
 * Age of majority by province and territory, from each jurisdiction's age of majority statute. Seeded as unconfirmed:
 * counsel confirms each row, and adds the activity-specific rules (consent, applying, owning a policy, receiving a
 * benefit) that can differ from it.
 */
export const CA_AGE_OF_MAJORITY: Record<string, number> = {
  'CA-AB': 18, 'CA-MB': 18, 'CA-ON': 18, 'CA-PE': 18, 'CA-QC': 18, 'CA-SK': 18,
  'CA-BC': 19, 'CA-NB': 19, 'CA-NL': 19, 'CA-NS': 19, 'CA-NT': 19, 'CA-NU': 19, 'CA-YT': 19,
};
export const SEED_AUTHOR = 'PII default (provincial statute)';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

/** The date someone born on `dob` reaches `age`. A 29 February birthday reaches it on 1 March in a common year;
 *  the review this opens says so, because how a jurisdiction treats that day is for counsel. */
export function reachesAgeOn(dob: string, age: number): { on: string; leapDay: boolean } {
  const b = utc(dob);
  const leapDay = b.getUTCMonth() === 1 && b.getUTCDate() === 29;
  const d = new Date(Date.UTC(b.getUTCFullYear() + age, b.getUTCMonth(), b.getUTCDate()));
  return { on: iso(d), leapDay };
}

/** Whether a person is under a rule's age today: true, false, or null when the date of birth or the rule is missing. */
export function underAge(dob: string | null, ruleAge: number | null, today: string): boolean | null {
  if (!dob || ruleAge == null) return null;
  return reachesAgeOn(dob, ruleAge).on > today;
}

export type ConsentLike = {
  purpose: string; scope: 'all_dealings' | 'deal'; boxId: string | null; noticeVersion: string;
  withdrawnAt: string | null; givenBy: 'self' | 'authority'; authorityInEffect: boolean | null;
};
/**
 * Whether an existing person consent may be reused for a deal. All of purpose, scope, notice version and authority must
 * still match; each failure is named so the partner sees why a new consent is needed.
 */
export function reuseCheck(c: ConsentLike, want: { purpose: string; boxId: string; noticeVersion: string }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.withdrawnAt) reasons.push('withdrawn');
  if (c.purpose !== want.purpose) reasons.push('different purpose');
  if (c.scope === 'deal' && c.boxId !== want.boxId) reasons.push('given for another deal only');
  if (c.noticeVersion !== want.noticeVersion) reasons.push(`given under notice ${c.noticeVersion}; the current notice is ${want.noticeVersion}`);
  if (c.givenBy === 'authority' && !c.authorityInEffect) reasons.push('the authority it was given under is no longer in effect');
  return { ok: reasons.length === 0, reasons };
}

/** Whether a verified ID check is still current for a rule: `validMonths` null means it does not expire. */
export function idCurrent(checkedOn: string, validMonths: number | null, today: string): boolean {
  if (validMonths == null) return true;
  const c = utc(checkedOn);
  const until = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + validMonths, c.getUTCDate()));
  return iso(until) >= today;
}

export type IdStatus = 'current' | 'expired' | 'missing' | 'failed' | 'not_required' | 'no_rule';
/**
 * A person's ID status on a deal, from their roles there and the company's rules. Roles without a rule are "no rule
 * set", never silently "not required". The strictest applicable rule (shortest validity) decides.
 */
export function idStatus(
  roles: string[],
  rules: { dealRole: string; required: boolean; validMonths: number | null }[],
  latest: { result: string; checkedOn: string } | null,
  lastVerifiedOn: string | null,
  today: string,
): { status: IdStatus; validMonths: number | null } {
  const applicable = rules.filter((r) => roles.includes(r.dealRole));
  if (!applicable.length) return { status: 'no_rule', validMonths: null };
  const required = applicable.filter((r) => r.required);
  if (!required.length) return { status: 'not_required', validMonths: null };
  const months = required.map((r) => r.validMonths).filter((m): m is number => m != null);
  const validMonths = months.length ? Math.min(...months) : null;
  if (latest && latest.result !== 'verified' && (!lastVerifiedOn || latest.checkedOn >= lastVerifiedOn)) return { status: 'failed', validMonths };
  if (!lastVerifiedOn) return { status: 'missing', validMonths };
  return { status: idCurrent(lastVerifiedOn, validMonths, today) ? 'current' : 'expired', validMonths };
}

/** How long a partner has to work through a life-event review. Death and guardianship changes are the most urgent. */
export function lifeEventDueDays(kind: string): number {
  return kind === 'death' || kind === 'guardianship_change' ? 7 : 14;
}

/** A guardian-of-a-minor authority makes sense only while the person is (or may be) under the age of majority. */
export function guardianAllowed(kind: string, minor: boolean | null): boolean {
  return kind !== 'guardian_of_minor' || minor !== false;
}

/** Notes must not carry document numbers: a run of six or more digits is refused (the database refuses it too). */
export const looksLikeIdNumber = (s: string | null | undefined): boolean => !!s && /[0-9]{6,}/.test(s);

export const addDays = (today: string, n: number): string => { const d = utc(today); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
