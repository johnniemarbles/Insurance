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

import { lockedLessonIds, resumeLesson } from '../src/assessment.ts';
test('step-by-step lock: the first unfinished required lesson holds back the rest', () => {
  const ls = [{ id: 'a', required: true, done: true }, { id: 'b', required: false, done: false }, { id: 'c', required: true, done: false }, { id: 'd', required: true, done: false }];
  assert.deepEqual([...lockedLessonIds(ls)], ['d']);
  assert.deepEqual([...lockedLessonIds(ls.map((l) => ({ ...l, done: true })))], []);
  assert.deepEqual([...lockedLessonIds(ls.map((l) => ({ ...l, done: false })))].sort(), ['b', 'c', 'd']);
});
test('resume goes to the last lesson opened, else the first open one', () => {
  const ls = [{ id: 'a', done: true }, { id: 'b', done: false }, { id: 'c', done: false }];
  const locked = new Set(['c']);
  assert.equal(resumeLesson(ls, locked, 'b'), 'b');
  assert.equal(resumeLesson(ls, locked, 'c'), 'b', 'a locked lesson is never the resume point');
  assert.equal(resumeLesson(ls, locked, null), 'b');
  assert.equal(resumeLesson(ls.map((l) => ({ ...l, done: true })), new Set(), 'a'), null);
});
