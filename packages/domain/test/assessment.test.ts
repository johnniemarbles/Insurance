import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptStatus } from '../src/assessment.ts';

const now = new Date('2026-01-01T12:00:00Z');
const at = (min: number, passed = false) => ({ attemptedAt: new Date(now.getTime() - min * 60_000), passed });
test('first attempt is always allowed; unlimited when no cap', () => {
  assert.deepEqual(attemptStatus({ maxAttempts: null, cooldownMinutes: null }, [], now), { allowed: true, reason: null, used: 0, left: null, nextAt: null });
  assert.equal(attemptStatus({ maxAttempts: null, cooldownMinutes: null }, [at(1), at(2), at(3)], now).allowed, true);
});
test('a pass ends the quiz; the cap counts misses', () => {
  assert.equal(attemptStatus({ maxAttempts: 3, cooldownMinutes: null }, [at(5), at(1, true)], now).reason, 'passed');
  const s = attemptStatus({ maxAttempts: 2, cooldownMinutes: null }, [at(5), at(1)], now);
  assert.equal(s.reason, 'no_attempts_left'); assert.equal(s.left, 0);
  assert.equal(attemptStatus({ maxAttempts: 3, cooldownMinutes: null }, [at(1)], now).left, 2);
});
test('cool-down waits from the latest attempt, then opens', () => {
  const s = attemptStatus({ maxAttempts: null, cooldownMinutes: 60 }, [at(10)], now);
  assert.equal(s.reason, 'cooldown'); assert.equal(s.nextAt, new Date(now.getTime() + 50 * 60_000).toISOString());
  assert.equal(attemptStatus({ maxAttempts: null, cooldownMinutes: 60 }, [at(61)], now).allowed, true);
  assert.equal(attemptStatus({ maxAttempts: 1, cooldownMinutes: 60 }, [at(10)], now).reason, 'no_attempts_left', 'the cap wins over the wait');
});
