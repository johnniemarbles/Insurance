import type { SortKey } from './types.ts';

export type SortField = SortKey | 'stage' | 'owner' | 'openTasks' | 'nextTaskDue' | 'emailCount' | 'lastInteraction';
export type GroupBy = 'none' | 'stage' | 'owner';
export interface SortSpec { key: SortField; dir: 'asc' | 'desc' }

/** Everything the person can narrow the list by. Empty means "no restriction". */
export interface Filters {
  q: string;
  stageIds: string[];
  assigneeIds: string[];
  unassigned: boolean;
  emailOlder: number | null;
  emailWithin: number | null;
  noEmail: boolean;
  stuckDays: number | null;
  valueMin: number | null;
  valueMax: number | null;
}

export const emptyFilters: Filters = {
  q: '', stageIds: [], assigneeIds: [], unassigned: false, emailOlder: null, emailWithin: null, noEmail: false, stuckDays: null, valueMin: null, valueMax: null,
};

export const hasFilters = (f: Filters): boolean =>
  !!(f.q || f.stageIds.length || f.assigneeIds.length || f.unassigned || f.emailOlder != null || f.emailWithin != null || f.noEmail || f.stuckDays != null || f.valueMin != null || f.valueMax != null);

export const defaultSorts: SortSpec[] = [{ key: 'updated', dir: 'desc' }];

/** Query-string pieces the boxes endpoint understands. */
export function filterParams(f: Filters, into = new URLSearchParams()): URLSearchParams {
  if (f.q) into.set('q', f.q);
  if (f.stageIds.length) into.set('stageIds', f.stageIds.join(','));
  if (f.assigneeIds.length) into.set('assigneeIds', f.assigneeIds.join(','));
  if (f.unassigned) into.set('unassigned', 'true');
  if (f.emailOlder != null) into.set('emailOlderThanDays', String(f.emailOlder));
  if (f.emailWithin != null) into.set('emailWithinDays', String(f.emailWithin));
  if (f.noEmail) into.set('noEmail', 'true');
  if (f.stuckDays != null) into.set('minDaysInStage', String(f.stuckDays));
  if (f.valueMin != null) into.set('valueMin', String(f.valueMin));
  if (f.valueMax != null) into.set('valueMax', String(f.valueMax));
  return into;
}

/** Grouping always sorts by the group first, so rows of one group sit together. */
export function sortParam(sorts: SortSpec[], groupBy: GroupBy): string {
  const list = groupBy === 'none' ? sorts : [{ key: groupBy as SortField, dir: 'asc' as const }, ...sorts.filter((s) => s.key !== groupBy)];
  return list.slice(0, 4).map((s) => `${s.key}:${s.dir}`).join(',');
}

/** Older saved views stored a single sort and loose fields; accept both shapes. */
export function migrateView(v: any): { filters: Filters; sorts: SortSpec[]; groupBy: GroupBy } {
  if (v?.filters) return { filters: { ...emptyFilters, ...v.filters }, sorts: v.sorts ?? defaultSorts, groupBy: v.groupBy ?? 'none' };
  return {
    filters: { ...emptyFilters, q: v?.q ?? '', stageIds: v?.stageFilter ? [v.stageFilter] : [], assigneeIds: v?.assignee ? [v.assignee] : [], stuckDays: v?.stuck ? 14 : null },
    sorts: v?.sort ? [v.sort] : defaultSorts,
    groupBy: 'none',
  };
}
