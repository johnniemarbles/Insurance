import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineBucket, credentialStatus, courseNudge, ceNudge, groupDeadlines, type Deadline } from '../src/forecast.ts';

test('buckets: overdue, 30, 60, 90, then nothing', () => {
  assert.equal(deadlineBucket(-1), 'overdue'); assert.equal(deadlineBucket(0), 'd30'); assert.equal(deadlineBucket(30), 'd30');
  assert.equal(deadlineBucket(31), 'd60'); assert.equal(deadlineBucket(60), 'd60'); assert.equal(deadlineBucket(61), 'd90');
  assert.equal(deadlineBucket(90), 'd90'); assert.equal(deadlineBucket(91), null);
});
test('credential status', () => {
  assert.equal(credentialStatus(null), 'no_date'); assert.equal(credentialStatus(-1), 'expired'); assert.equal(credentialStatus(0), 'expiring');
  assert.equal(credentialStatus(30), 'expiring'); assert.equal(credentialStatus(31), 'valid'); assert.equal(credentialStatus(45, 60), 'expiring');
});
test('nudges', () => {
  assert.equal(courseNudge(-3), 'overdue'); assert.equal(courseNudge(0), 'due7'); assert.equal(courseNudge(7), 'due7'); assert.equal(courseNudge(8), null);
  assert.equal(ceNudge('at_risk'), 'at_risk'); assert.equal(ceNudge('overdue'), 'overdue'); assert.equal(ceNudge('on_track'), null); assert.equal(ceNudge('met'), null);
});
test('grouping sorts and drops far-off items', () => {
  const d = (label: string, daysLeft: number): Deadline => ({ kind: 'course', id: label, label, who: null, dueOn: '2026-01-01', daysLeft });
  const g = groupDeadlines([d('b', 50), d('a', 5), d('late', -2), d('far', 200), d('c', 80)]);
  assert.deepEqual(g.overdue.map((x) => x.id), ['late']); assert.deepEqual(g.d30.map((x) => x.id), ['a']);
  assert.deepEqual(g.d60.map((x) => x.id), ['b']); assert.deepEqual(g.d90.map((x) => x.id), ['c']);
});
