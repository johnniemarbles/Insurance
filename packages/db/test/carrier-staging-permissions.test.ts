import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier staging runtime grants do not permit evidence mutation', async () => {
  const db = await createTestDb('ca-qc');
  const app = new pg.Client({ connectionString: db.appUrl });
  await app.connect();
  try {
    const result = await app.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(`SELECT
      has_table_privilege(current_user,'carrier_business_submissions','SELECT') AS can_select,
      has_table_privilege(current_user,'carrier_business_submissions','INSERT') AS can_insert,
      has_table_privilege(current_user,'carrier_business_submissions','UPDATE') AS can_update,
      has_table_privilege(current_user,'carrier_business_submissions','DELETE') AS can_delete,
      has_table_privilege(current_user,'carrier_business_submissions','TRUNCATE') AS can_truncate`);
    assert.deepEqual(result.rows[0], {
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
      can_truncate: false,
    });
  } finally {
    await app.end();
    await db.drop();
  }
});
