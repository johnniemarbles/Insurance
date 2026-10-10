import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFirstWeek, type FirstWeekInput } from '../src/index.ts';

const empty: FirstWeekInput = {
  file: { profile: null, licences: 0, eoCount: 0, eoMaxLimit: null, eoMin: 0 },
  status: null, appointments: { total: 0, appointed: 0 }, people: 1, cePacks: true, ceLicensees: 0, training: { assigned: 0, completed: 0 }, clients: 0, daysSince: 0,
};

test('first week: a brand new partner has nothing done and the first step is the profile', () => {
  const w = computeFirstWeek(empty);
  assert.equal(w.total, 12); assert.equal(w.done, 0); assert.equal(w.next, 'profile');
  assert.equal(w.day, 1); assert.equal(w.daysLeft, 7); assert.equal(w.late, false);
});
test('first week: carriers need an appointment, a request alone is only a hint', () => {
  let w = computeFirstWeek({ ...empty, appointments: { total: 2, appointed: 0 } });
  assert.deepEqual(w.steps.find((s) => s.id === 'carriers'), { id: 'carriers', group: 'team', done: false, hint: 'requested' });
  w = computeFirstWeek({ ...empty, appointments: { total: 2, appointed: 1 } });
  assert.equal(w.steps.find((s) => s.id === 'carriers')!.done, true);
});
test('first week: submitted and approved follow the review status', () => {
  const at = (status: string) => computeFirstWeek({ ...empty, status }).steps.filter((s) => s.id === 'submitted' || s.id === 'approved').map((s) => `${s.id}:${s.done}`);
  assert.deepEqual(at('submitted'), ['submitted:true', 'approved:false']);
  assert.deepEqual(at('approved'), ['submitted:true', 'approved:true']);
  assert.deepEqual(at('rejected'), ['submitted:false', 'approved:false']);
});
test('first week: the CE step is left out where no rules are loaded, and training needs every assigned course finished', () => {
  const w = computeFirstWeek({ ...empty, cePacks: false, training: { assigned: 3, completed: 2 } });
  assert.equal(w.total, 11); assert.equal(w.steps.some((s) => s.id === 'ce'), false);
  assert.equal(w.steps.find((s) => s.id === 'training')!.done, false);
  assert.equal(computeFirstWeek({ ...empty, training: { assigned: 3, completed: 3 } }).steps.find((s) => s.id === 'training')!.done, true);
  assert.equal(computeFirstWeek(empty).steps.find((s) => s.id === 'training')!.hint, 'none_assigned');
});
test('first week: late after seven days, complete when every step is done', () => {
  assert.equal(computeFirstWeek({ ...empty, daysSince: 7 }).late, true);
  assert.equal(computeFirstWeek({ ...empty, daysSince: 6 }).late, false);
  const full = computeFirstWeek({
    file: { profile: { entityType: 'corporation', legalName: 'X Inc', businessNumber: '1', attestedAt: 'x', agreementStatus: 'signed' }, licences: 1, eoCount: 1, eoMaxLimit: 2_000_000, eoMin: 1_000_000 },
    status: 'approved', appointments: { total: 1, appointed: 1 }, people: 3, cePacks: true, ceLicensees: 2, training: { assigned: 2, completed: 2 }, clients: 5, daysSince: 40,
  });
  assert.equal(full.complete, true); assert.equal(full.late, false); assert.equal(full.next, null); assert.equal(full.percent, 100);
});
