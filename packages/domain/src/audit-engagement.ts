// External auditor engagements (annual-review plan, section C). Pure rules: no database access here.

/** What an engagement may cover. Nothing outside these four areas is open to an auditor. */
export const AUDIT_SCOPE_AREAS = ['policies', 'training_records', 'complaints_log', 'sampled_files'] as const;
export type AuditScopeArea = (typeof AUDIT_SCOPE_AREAS)[number];

export const AUDIT_DEFAULT_DAYS = 30;
export const AUDIT_MAX_DAYS = 365;

const DAY_MS = 86_400_000;
const toMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number): string => new Date(toMs(d) + n * DAY_MS).toISOString().slice(0, 10);

/** The end date when the inviter gives none: thirty days from the start. */
export function defaultEndsOn(startsOn: string): string {
  return addDays(startsOn, AUDIT_DEFAULT_DAYS);
}

/** Null when the dates are fine; otherwise the reason in plain words. */
export function engagementDateProblem(startsOn: string, endsOn: string): string | null {
  const days = (toMs(endsOn) - toMs(startsOn)) / DAY_MS;
  if (days < 0) return 'The end date comes before the start date';
  if (days > AUDIT_MAX_DAYS) return 'An engagement can run for at most one year';
  return null;
}

export type EngagementStatus = 'invited' | 'scheduled' | 'active' | 'ended';

/**
 * Where an engagement stands today. It ends on its end date by itself, or earlier when the inviter ends it.
 * Until the auditor signs in it is only an invitation.
 */
export function engagementStatus(
  i: { startsOn: string; endsOn: string; endedAt: string | null; linked: boolean },
  today: string,
): EngagementStatus {
  if (i.endedAt || today > i.endsOn) return 'ended';
  if (!i.linked) return 'invited';
  if (today < i.startsOn) return 'scheduled';
  return 'active';
}
