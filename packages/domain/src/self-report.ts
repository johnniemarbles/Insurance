// Broker self-report: the five events a broker must report, and the business-day deadline for the Compliance Manager's queue
// (plan v6, section 7; decided 15 Oct 2026: the clock starts when the broker records the event).
// Days are counted in Toronto time. Statutory holidays are not yet excluded; to confirm with counsel before go-live.

export const SELF_REPORT_KINDS = ['bankruptcy', 'consumer_proposal', 'investigation', 'sanction', 'criminal_charge'] as const;
export type SelfReportKind = (typeof SELF_REPORT_KINDS)[number];

const TZ = 'America/Toronto';
const BUSINESS_DAYS = 5;
const localFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The calendar date (YYYY-MM-DD) of an instant in Toronto. */
function localDate(d: Date): string {
  return localFmt.format(d);
}

function addDays(ymd: string, n: number): string {
  const [y, m, day] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day + n, 12)).toISOString().slice(0, 10);
}

function isWeekend(ymd: string): boolean {
  const [y, m, day] = ymd.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** The last day of the five business days that follow the recording. A weekend recording counts from the following Monday. */
export function reportDueOn(recordedAt: Date): string {
  let cur = localDate(recordedAt);
  let count = 0;
  while (count < BUSINESS_DAYS) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) count++;
  }
  return cur;
}

/** Overdue once the due day has ended in Toronto. */
export function isSelfReportOverdue(dueOn: string, now: Date): boolean {
  return localDate(now) > dueOn;
}
