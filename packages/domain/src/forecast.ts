// What is coming up: one way to read every deadline (licence, E&O, CE term, course due date) and when to nudge someone about it.

export type DeadlineBucket = 'overdue' | 'd30' | 'd60' | 'd90';
export const BUCKETS: readonly DeadlineBucket[] = ['overdue', 'd30', 'd60', 'd90'];
export type DeadlineKind = 'licence' | 'eo' | 'ce' | 'course';

/** Which column of the 30/60/90 calendar a deadline falls in; null when it is further than 90 days away. Today counts as the first 30. */
export function deadlineBucket(daysLeft: number): DeadlineBucket | null {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 30) return 'd30';
  if (daysLeft <= 60) return 'd60';
  if (daysLeft <= 90) return 'd90';
  return null;
}

/** Credential status on a given day: valid until 30 days before it ends, then expiring, then expired. A missing date never expires. */
export type CredentialStatus = 'valid' | 'expiring' | 'expired' | 'no_date';
export function credentialStatus(daysLeft: number | null, renewalWindowDays = 30): CredentialStatus {
  if (daysLeft === null) return 'no_date';
  if (daysLeft < 0) return 'expired';
  return daysLeft <= renewalWindowDays ? 'expiring' : 'valid';
}

/** A course nudge: one a week out, and one once it is late. `stage` goes into the once-only key. */
export type CourseNudge = 'due7' | 'overdue';
export function courseNudge(daysLeft: number): CourseNudge | null {
  if (daysLeft < 0) return 'overdue';
  return daysLeft <= 7 ? 'due7' : null;
}

/** A CE nudge: when a term is at risk or overdue. Once per term per state, so a person is not told every day. */
export function ceNudge(state: string): 'at_risk' | 'overdue' | null {
  return state === 'at_risk' || state === 'overdue' ? state : null;
}

export interface Deadline { kind: DeadlineKind; id: string; label: string; who: string | null; dueOn: string; daysLeft: number; nodeId?: string | null }

/** Sort soonest first (overdue at the top) and group into columns. Anything beyond 90 days is dropped. */
export function groupDeadlines(items: Deadline[]): Record<DeadlineBucket, Deadline[]> {
  const out: Record<DeadlineBucket, Deadline[]> = { overdue: [], d30: [], d60: [], d90: [] };
  for (const i of [...items].sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label))) {
    const b = deadlineBucket(i.daysLeft);
    if (b) out[b].push(i);
  }
  return out;
}
