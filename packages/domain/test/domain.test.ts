import { test } from "node:test";
import assert from "node:assert/strict";

import { computeChecklist, reminderThreshold, expiryState, effectiveEoMin, sniffMime, safeFilename } from '../src/index.ts';

test('compliance checklist: each step needs its own proof', () => {
  const empty = computeChecklist({ profile: null, licences: 0, eoCount: 0, eoMaxLimit: null, eoMin: 0 });
  assert.equal(empty.percent, 0); assert.equal(empty.complete, false);
  const full = computeChecklist({ profile: { entityType: 'corporation', legalName: 'Acme Ltd', businessNumber: '123', attestedAt: '2026-01-01', agreementStatus: 'signed' }, licences: 1, eoCount: 1, eoMaxLimit: 1_000_000, eoMin: 500_000 });
  assert.equal(full.complete, true); assert.equal(full.percent, 100);
});
test('compliance checklist: a corporation needs a business number, a sole proprietor does not', () => {
  const base = { licences: 0, eoCount: 0, eoMaxLimit: null, eoMin: 0 };
  assert.equal(computeChecklist({ ...base, profile: { entityType: 'corporation', legalName: 'A' } }).steps[0]!.done, false);
  assert.equal(computeChecklist({ ...base, profile: { entityType: 'sole_proprietor', legalName: 'A' } }).steps[0]!.done, true);
});
test('compliance checklist: E&O below the minimum is not done and says why', () => {
  const r = computeChecklist({ profile: null, licences: 0, eoCount: 1, eoMaxLimit: 250_000, eoMin: 1_000_000 });
  const eo = r.steps.find((s) => s.id === 'eo')!;
  assert.equal(eo.done, false); assert.equal(eo.hint, 'limit_low');
  assert.equal(computeChecklist({ profile: null, licences: 0, eoCount: 1, eoMaxLimit: null, eoMin: 0 }).steps.find((s) => s.id === 'eo')!.done, true);
});
test('expiry reminders at 30, 15 and 0 days', () => {
  assert.equal(reminderThreshold(45), null); assert.equal(reminderThreshold(30), 30); assert.equal(reminderThreshold(16), 30);
  assert.equal(reminderThreshold(15), 15); assert.equal(reminderThreshold(1), 15); assert.equal(reminderThreshold(0), 0); assert.equal(reminderThreshold(-9), 0);
  assert.equal(expiryState(-1), 'expired'); assert.equal(expiryState(30), 'soon'); assert.equal(expiryState(31), 'ok'); assert.equal(expiryState(null), 'none');
});
test('the country E&O minimum can be raised by a company but never lowered', () => {
  assert.equal(effectiveEoMin(1_000_000, 500_000), 1_000_000); assert.equal(effectiveEoMin(1_000_000, 2_000_000), 2_000_000);
  assert.equal(effectiveEoMin(0, null), 0); assert.equal(effectiveEoMin(Number.NaN, 5), 5);
});
test('files are recognised by their first bytes, not their names', () => {
  assert.equal(sniffMime(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), 'application/pdf');
  assert.equal(sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(new TextEncoder().encode('<script>alert(1)</script>')), null);
  assert.equal(safeFilename('../../etc/passwd.exe', 'application/pdf'), 'etcpasswd.pdf');
});
