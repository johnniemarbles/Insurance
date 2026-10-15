import { test } from "node:test";
import assert from "node:assert/strict";

import { PROFILE_FIELDS, computeChecklist } from '../src/index.ts';

// BC supervising licensee: captured as optional fields for now. Counsel confirms the 24-month rule before go-live,
// so nothing here is required and no checklist step depends on it.
test('Canada has optional BC supervising-licensee fields, labelled as optional and BC-only', () => {
  const keys = PROFILE_FIELDS.CA.map((f) => f.key);
  assert.ok(keys.includes('bc_supervisor_name'), 'supervising licensee name');
  assert.ok(keys.includes('bc_supervisor_licence'), 'supervising licensee licence number');
  for (const k of ['bc_supervisor_name', 'bc_supervisor_licence']) {
    const f = PROFILE_FIELDS.CA.find((x) => x.key === k)!;
    assert.equal(f.options, undefined, `${k} is free text`);
    assert.ok(f.maxLength > 0 && f.maxLength <= 60, `${k} fits the 60-character profile limit`);
    assert.match(f.label.en, /optional/i);
    assert.match(f.label.en, /BC/);
    assert.match(f.label['fr-CA'], /facultatif/i);
  }
});

test('the supervising licensee is not a checklist requirement', () => {
  const base = { profile: { entityType: 'corporation', legalName: 'Acme Ltd', businessNumber: '123', attestedAt: '2026-01-01', agreementStatus: 'signed' }, licences: 1, eoCount: 1, eoMaxLimit: 1_000_000, eoMin: 0 };
  assert.equal(computeChecklist(base).complete, true, 'complete without any supervising licensee');
});
