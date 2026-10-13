import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('partner onboarding tables exist with row-level security forced on', async () => {
  const db = await createTestDb('ca-qc');
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try {
    const { rows } = await c.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('onboarding_cases','onboarding_consents','onboarding_checks','onboarding_decisions','carrier_packets')`);
    assert.equal(rows.length, 5);
    for (const r of rows) { assert.equal(r.relrowsecurity, true, r.relname); assert.equal(r.relforcerowsecurity, true, r.relname); }
  } finally { await c.end(); await db.drop(); }
});
