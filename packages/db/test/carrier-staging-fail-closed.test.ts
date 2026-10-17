import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier staging fails closed without an authenticated tenant context', async () => {
  const db = await createTestDb('ca-qc');
  const app = new pg.Client({ connectionString: db.appUrl });
  await app.connect();
  try {
    const result = await app.query('SELECT id FROM carrier_business_submissions');
    assert.equal(result.rowCount, 0);

    const allowed = await app.query<{ allowed: boolean }>(
      "SELECT carrier_product_submission_authorized_locked($1::uuid,$2::text) AS allowed",
      ['00000000-0000-0000-0000-000000000000', 'TEST'],
    );
    assert.equal(allowed.rows[0]?.allowed, false);

    const mutation = await app.query<{ can_update: boolean; can_delete: boolean }>(
      "SELECT has_table_privilege(current_user,'carrier_business_submissions','UPDATE') AS can_update, has_table_privilege(current_user,'carrier_business_submissions','DELETE') AS can_delete",
    );
    assert.equal(mutation.rows[0]?.can_update, false);
    assert.equal(mutation.rows[0]?.can_delete, false);
  } finally {
    await app.end();
    await db.drop();
  }
});
