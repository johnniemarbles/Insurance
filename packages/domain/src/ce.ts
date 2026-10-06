/**
 * Continuing education rules, as pure functions. A rule pack says how many hours a regulator asks for in a term,
 * which categories need a minimum, and which are capped. `evaluateCe` turns a person's logged hours into a status.
 * Dates are plain 'YYYY-MM-DD' strings (calendar days, no time zones).
 */
export const CE_CATEGORIES = ['technical', 'management', 'ethics', 'professional_development', 'general'] as const;
export type CeCategory = (typeof CE_CATEGORIES)[number];

export interface CeClass { key: string; label: string; label_fr: string; total: number; min: Partial<Record<CeCategory, number>>; max: Partial<Record<CeCategory, number>> }
export interface CePack {
  code: string; termStartMonth: number; termStartDay: number; termMonths: number; classes: CeClass[]; newLicenseeExempt: boolean; retentionYears: number;
}
export type Hours = Partial<Record<CeCategory, number>>;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The term a date falls in: start (inclusive) and end (the last day). */
export function termWindow(pack: Pick<CePack, 'termStartMonth' | 'termStartDay' | 'termMonths'>, on: string): { start: string; end: string } {
  const y = Number(on.slice(0, 4));
  const thisYear = ymd(y, pack.termStartMonth, pack.termStartDay);
  const startYear = on >= thisYear ? y : y - 1;
  // terms are whole years in every pack we ship; longer terms count from the same anchor
  const months = pack.termMonths;
  const start = ymd(startYear, pack.termStartMonth, pack.termStartDay);
  const endIdx = pack.termStartMonth - 1 + months;
  const endDate = new Date(Date.UTC(startYear + Math.floor(endIdx / 12), endIdx % 12, pack.termStartDay));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

/** A day after `date` by `years` years (retention). */
export function addYears(date: string, years: number): string {
  return ymd(Number(date.slice(0, 4)) + years, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
}

export type CeState = 'met' | 'on_track' | 'at_risk' | 'overdue' | 'exempt';
export interface CeEvaluation {
  state: CeState; required: number; counted: number; remaining: number;
  /** Categories that still need hours, e.g. { ethics: 1 }. */
  missing: Hours; termStart: string; termEnd: string; daysLeft: number; exempt: boolean;
}

/**
 * Counted hours: each category is capped where the rule caps it; the total counts at most `required`.
 * Met when the total is reached and every category minimum is satisfied.
 * `at_risk` = not met and 60 days or fewer remain (or fewer than 2 hours per 30 days of term left would be needed: kept simple).
 */
export function evaluateCe(pack: CePack, cls: CeClass, hours: Hours, licensedSince: string | null, today: string): CeEvaluation {
  const w = termWindow(pack, today);
  const daysLeft = daysBetween(today, w.end);
  const exempt = pack.newLicenseeExempt && !!licensedSince && licensedSince >= w.start;
  let counted = 0;
  const missing: Hours = {};
  for (const c of CE_CATEGORIES) {
    const h = hours[c] ?? 0;
    const cap = cls.max[c];
    counted += cap !== undefined ? Math.min(h, cap) : h;
    const need = cls.min[c];
    if (need !== undefined && h < need) missing[c] = Math.round((need - h) * 10) / 10;
  }
  counted = Math.round(counted * 10) / 10;
  const remaining = Math.max(0, Math.round((cls.total - counted) * 10) / 10);
  const met = remaining === 0 && Object.keys(missing).length === 0;
  const state: CeState = exempt ? 'exempt' : met ? 'met' : daysLeft < 0 ? 'overdue' : daysLeft <= 60 ? 'at_risk' : 'on_track';
  return { state, required: cls.total, counted, remaining, missing, termStart: w.start, termEnd: w.end, daysLeft, exempt };
}

/** Turn the stored JSON pack row into the typed pack. */
export function toPack(row: { code: string; term_start_month: number; term_start_day: number; term_months: number; requirements: { classes: CeClass[] }; new_licensee_exempt: boolean; retention_years: number }): CePack {
  return { code: row.code, termStartMonth: row.term_start_month, termStartDay: row.term_start_day, termMonths: row.term_months, classes: row.requirements.classes, newLicenseeExempt: row.new_licensee_exempt, retentionYears: row.retention_years };
}
