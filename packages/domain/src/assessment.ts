// Quiz attempt rules, in one place so the server and the screens agree.

export interface AttemptRecord { attemptedAt: string | Date; passed: boolean }
export interface AttemptRules { maxAttempts: number | null; cooldownMinutes: number | null }
export type AttemptBlock = 'passed' | 'no_attempts_left' | 'cooldown';
export interface AttemptStatus { allowed: boolean; reason: AttemptBlock | null; used: number; left: number | null; nextAt: string | null }

/** May this person take the quiz now? Passed means done; a limit ends it; a cool-down after a miss makes them wait. */
export function attemptStatus(rules: AttemptRules, attempts: AttemptRecord[], now: Date = new Date()): AttemptStatus {
  const used = attempts.length;
  const left = rules.maxAttempts ? Math.max(0, rules.maxAttempts - used) : null;
  if (attempts.some((a) => a.passed)) return { allowed: false, reason: 'passed', used, left, nextAt: null };
  if (left === 0) return { allowed: false, reason: 'no_attempts_left', used, left, nextAt: null };
  if (rules.cooldownMinutes && used > 0) {
    const last = Math.max(...attempts.map((a) => new Date(a.attemptedAt).getTime()));
    const next = last + rules.cooldownMinutes * 60_000;
    if (next > now.getTime()) return { allowed: false, reason: 'cooldown', used, left, nextAt: new Date(next).toISOString() };
  }
  return { allowed: true, reason: null, used, left, nextAt: null };
}

/** In a step-by-step course a lesson opens once every required lesson before it is done. Optional lessons never hold anyone back. */
export function lockedLessonIds(lessons: { id: string; required: boolean; done: boolean }[]): Set<string> {
  const locked = new Set<string>();
  let blocked = false;
  for (const l of lessons) {
    if (blocked) locked.add(l.id);
    if (l.required && !l.done) blocked = true;
  }
  return locked;
}

/** Where "Continue" goes: the lesson last opened if it is still open and unfinished, else the first unfinished lesson that is not locked. */
export function resumeLesson(lessons: { id: string; done: boolean }[], locked: Set<string>, lastId: string | null): string | null {
  const open = lessons.filter((l) => !l.done && !locked.has(l.id));
  return open.find((l) => l.id === lastId)?.id ?? open[0]?.id ?? null;
}
