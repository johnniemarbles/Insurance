// External auditor engagements (annual-review plan, section C). An auditor is deputed for one named engagement with a scope and
// an end date. Access ends on the end date by itself; the inviter can end it earlier.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_SCOPE_AREAS, AUDIT_DEFAULT_DAYS, AUDIT_MAX_DAYS, engagementDateProblem, defaultEndsOn, engagementStatus } from '../src/index.ts';

test('the scope areas are the four the annual review samples and reads', () => {
  assert.deepEqual([...AUDIT_SCOPE_AREAS], ['policies', 'training_records', 'complaints_log', 'sampled_files']);
});

test('an engagement runs at most a year, and cannot end before it starts', () => {
  assert.equal(engagementDateProblem('2026-11-01', '2026-11-01'), null);
  assert.equal(engagementDateProblem('2026-11-01', '2027-11-01'), null, 'exactly one year is allowed');
  assert.match(engagementDateProblem('2026-11-01', '2026-10-31')!, /end/i);
  assert.match(engagementDateProblem('2026-11-01', '2027-11-02')!, /year/i);
  assert.equal(AUDIT_MAX_DAYS, 365);
});

test('the default length is thirty days from the start', () => {
  assert.equal(AUDIT_DEFAULT_DAYS, 30);
  assert.equal(defaultEndsOn('2026-11-01'), '2026-12-01');
  assert.equal(defaultEndsOn('2026-12-20'), '2027-01-19');
});

test('status follows the dates and any early ending', () => {
  const base = { startsOn: '2026-11-01', endsOn: '2026-12-01', endedAt: null, linked: true };
  assert.equal(engagementStatus({ ...base, linked: false }, '2026-10-15'), 'invited', 'not signed in yet');
  assert.equal(engagementStatus(base, '2026-10-15'), 'scheduled', 'signed in, starts later');
  assert.equal(engagementStatus(base, '2026-11-01'), 'active', 'starts on the start day');
  assert.equal(engagementStatus(base, '2026-12-01'), 'active', 'still active on the end day');
  assert.equal(engagementStatus(base, '2026-12-02'), 'ended', 'ends by itself the day after');
  assert.equal(engagementStatus({ ...base, endedAt: '2026-11-05T10:00:00Z' }, '2026-11-10'), 'ended', 'ended early');
});
