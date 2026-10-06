import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termWindow, evaluateCe, addYears, type CePack } from '../src/index.ts';

const ribo: CePack = { code: 'ribo', termStartMonth: 10, termStartDay: 1, termMonths: 12, newLicenseeExempt: true, retentionYears: 7, classes: [
  { key: 'principal', label: 'P', label_fr: 'P', total: 10, min: { management: 5, ethics: 1 }, max: { professional_development: 0 } },
  { key: 'broker', label: 'B', label_fr: 'B', total: 8, min: { technical: 3, ethics: 1 }, max: { professional_development: 2 } }] };

test('CE term windows follow the regulator calendar', () => {
  assert.deepEqual(termWindow(ribo, '2026-10-07'), { start: '2026-10-01', end: '2027-09-30' });
  assert.deepEqual(termWindow(ribo, '2027-09-30'), { start: '2026-10-01', end: '2027-09-30' });
  assert.deepEqual(termWindow(ribo, '2026-09-30'), { start: '2025-10-01', end: '2026-09-30' });
  assert.deepEqual(termWindow({ termStartMonth: 6, termStartDay: 1, termMonths: 12 }, '2026-03-15'), { start: '2025-06-01', end: '2026-05-31' });
});
test('CE: category minimums and caps decide whether hours count', () => {
  const b = ribo.classes[1]!;
  // 8 hours but no ethics: not met, and ethics is named
  let e = evaluateCe(ribo, b, { technical: 5, general: 3 }, null, '2027-01-10');
  assert.equal(e.state, 'on_track'); assert.deepEqual(e.missing, { ethics: 1 });
  // professional development is capped at 2 for a broker
  e = evaluateCe(ribo, b, { technical: 3, ethics: 1, professional_development: 6 }, null, '2027-01-10');
  assert.equal(e.counted, 6); assert.equal(e.remaining, 2);
  e = evaluateCe(ribo, b, { technical: 3, ethics: 1, general: 4 }, null, '2027-01-10');
  assert.equal(e.state, 'met');
  // a principal gets no credit for professional development
  const p = ribo.classes[0]!;
  e = evaluateCe(ribo, p, { management: 5, ethics: 1, professional_development: 4 }, null, '2027-01-10');
  assert.equal(e.counted, 6); assert.notEqual(e.state, 'met');
});
test('CE: at risk in the last 60 days, overdue after the term, exempt in the first term', () => {
  const b = ribo.classes[1]!;
  assert.equal(evaluateCe(ribo, b, {}, null, '2027-08-15').state, 'at_risk');
  assert.equal(evaluateCe(ribo, b, {}, null, '2027-09-30').daysLeft, 0);
  assert.equal(evaluateCe(ribo, b, {}, '2026-11-01', '2027-01-10').state, 'exempt');
  assert.equal(evaluateCe(ribo, b, {}, '2025-11-01', '2027-01-10').state, 'on_track');
});
test('retention dates add whole years', () => assert.equal(addYears('2027-09-30', 7), '2034-09-30'));
