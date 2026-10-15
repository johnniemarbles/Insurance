// Broker self-report clock (plan v6, section 7; decided 15 Oct 2026: the clock starts when the broker records the event).
// The deadline is the last business day of the five, counted in Toronto time; a report recorded on a weekend starts from Monday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDueOn, isSelfReportOverdue, SELF_REPORT_KINDS } from '../src/self-report.ts';

test('five business days after a Monday is the next Monday', () => {
  assert.equal(reportDueOn(new Date('2026-10-19T15:00:00Z')), '2026-10-26');
});

test('a Friday report is due the Friday of the next week', () => {
  assert.equal(reportDueOn(new Date('2026-10-16T15:00:00Z')), '2026-10-23');
});

test('a Saturday report counts from Monday, so it is due the same Friday as a Friday report', () => {
  assert.equal(reportDueOn(new Date('2026-10-17T15:00:00Z')), '2026-10-23');
});

test('Toronto time decides the day: 23:30 on a Friday in Toronto is still a Friday', () => {
  // 23:30 EDT on Friday 16 October is 03:30 UTC on Saturday 17 October.
  assert.equal(reportDueOn(new Date('2026-10-17T03:30:00Z')), '2026-10-23');
});

test('overdue only after the end of the due day in Toronto', () => {
  assert.equal(isSelfReportOverdue('2026-10-23', new Date('2026-10-23T22:00:00Z')), false, 'still Friday afternoon');
  assert.equal(isSelfReportOverdue('2026-10-23', new Date('2026-10-24T03:30:00Z')), false, '23:30 on the Friday in Toronto is still the due day');
  assert.equal(isSelfReportOverdue('2026-10-23', new Date('2026-10-24T05:00:00Z')), true, '01:00 on the Saturday in Toronto is overdue');
});

test('the kinds are the five events the plan names', () => {
  assert.deepEqual([...SELF_REPORT_KINDS], ['bankruptcy', 'consumer_proposal', 'investigation', 'sanction', 'criminal_charge']);
});
