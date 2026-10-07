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
