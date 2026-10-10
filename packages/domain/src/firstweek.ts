// The first-week checklist for a new partner company: the compliance file plus the steps that make the company ready to sell.
// Pure logic; the server gathers the counts.
import { computeChecklist, type ChecklistInput } from './compliance.ts';

export const FIRST_WEEK_DAYS = 7;
export const FIRST_WEEK_STEPS = [
  'profile', 'licence', 'eo', 'attestation', 'agreement', 'submitted', 'approved',
  'carriers', 'team', 'ce', 'training', 'client',
] as const;
export type FirstWeekStepId = (typeof FIRST_WEEK_STEPS)[number];
export type FirstWeekGroup = 'file' | 'team' | 'learning' | 'selling';
export const FIRST_WEEK_GROUPS: Record<FirstWeekStepId, FirstWeekGroup> = {
  profile: 'file', licence: 'file', eo: 'file', attestation: 'file', agreement: 'file', submitted: 'file', approved: 'file',
  carriers: 'team', team: 'team', ce: 'learning', training: 'learning', client: 'selling',
};

export interface FirstWeekInput {
  file: ChecklistInput;
  /** compliance_profiles.status: incomplete, submitted, approved or rejected. */
  status: string | null;
  appointments: { total: number; appointed: number };
  /** People at the partner who are not switched off, including those still invited. */
  people: number;
  /** False when no continuing-education rules are loaded for this country; the step is then left out. */
  cePacks: boolean;
  /** People at the partner with a CE licence set up. */
  ceLicensees: number;
  /** Courses assigned to people at the partner, and how many are finished. */
  training: { assigned: number; completed: number };
  clients: number;
  /** Calendar days since the partner was created (0 on the first day). */
  daysSince: number;
}
export interface FirstWeekStep { id: FirstWeekStepId; group: FirstWeekGroup; done: boolean; hint?: 'limit_low' | 'requested' | 'none_assigned' | 'rejected' | 'waiting'; detail?: string }
export interface FirstWeek {
  steps: FirstWeekStep[]; done: number; total: number; percent: number; complete: boolean;
  /** The first step still open, or null. */
  next: FirstWeekStepId | null;
  day: number; daysLeft: number; late: boolean;
}

export function computeFirstWeek(i: FirstWeekInput): FirstWeek {
  const f = computeChecklist(i.file);
  const steps: FirstWeekStep[] = f.steps.map((s) => ({ id: s.id as FirstWeekStepId, group: 'file' as const, done: s.done, ...(s.hint ? { hint: s.hint } : {}) }));
  const st = i.status ?? 'incomplete';
  steps.push({ id: 'submitted', group: 'file', done: st === 'submitted' || st === 'approved', ...(st === 'rejected' ? { hint: 'rejected' as const } : {}) });
  steps.push({ id: 'approved', group: 'file', done: st === 'approved', ...(st === 'submitted' ? { hint: 'waiting' as const } : {}) });
  steps.push({ id: 'carriers', group: 'team', done: i.appointments.appointed >= 1, ...(i.appointments.appointed === 0 && i.appointments.total >= 1 ? { hint: 'requested' as const } : {}) });
  steps.push({ id: 'team', group: 'team', done: i.people >= 2 });
  if (i.cePacks) steps.push({ id: 'ce', group: 'learning', done: i.ceLicensees >= 1 });
  const t = i.training;
  steps.push({ id: 'training', group: 'learning', done: t.assigned > 0 && t.completed >= t.assigned, ...(t.assigned === 0 ? { hint: 'none_assigned' as const } : {}) });
  steps.push({ id: 'client', group: 'selling', done: i.clients >= 1 });
  const done = steps.filter((s) => s.done).length;
  const day = Math.min(Math.max(i.daysSince, 0) + 1, 999);
  const daysLeft = Math.max(0, FIRST_WEEK_DAYS - Math.max(i.daysSince, 0));
  const complete = done === steps.length;
  return {
    steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100), complete,
    next: steps.find((s) => !s.done)?.id ?? null,
    day, daysLeft, late: !complete && i.daysSince >= FIRST_WEEK_DAYS,
  };
}
