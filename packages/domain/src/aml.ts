// Client identity and anti-money-laundering records. Pure logic. PII records the checks; it never stores ID numbers and does not file with FINTRAC.
export const ID_METHODS = ['in_person', 'credit_file', 'dual_process'] as const;
export const SCREEN_LISTS = ['pep', 'sanctions'] as const;
export const SCREEN_RESULTS = ['clear', 'hit', 'cleared_after_review'] as const;
export type ScreenList = (typeof SCREEN_LISTS)[number];
export type ScreenResult = (typeof SCREEN_RESULTS)[number];
export const CASH_REPORT_THRESHOLD = 10000;
export const cashReportRequired = (amount: number): boolean => amount >= CASH_REPORT_THRESHOLD;

/** The latest screening per list decides. A hit stays open until a later row says it was cleared after review. */
export function openScreeningHits(rows: { list: string; result: string; createdAt: string | number }[]): ScreenList[] {
  const latest = new Map<string, { result: string; t: number }>();
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime();
    const c = latest.get(r.list);
    if (!c || t >= c.t) latest.set(r.list, { result: r.result, t });
  }
  return [...latest.entries()].filter(([, v]) => v.result === 'hit').map(([k]) => k as ScreenList);
}
