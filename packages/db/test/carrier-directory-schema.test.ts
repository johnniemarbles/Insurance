import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier directory is seeded with unverified manual mode and restricted against app_runtime mutations', async () => {
  const db = await createTestDb('ca-qc');
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  const app = new pg.Client({ connectionString: db.appUrl });
  await owner.connect();
  await app.connect();
  try {
    const { rows } = await app.query<{ id: string; display_name: string; country: string; connection_mode: string; connection_verified: boolean }>(
      'SELECT id, display_name, country, connection_mode, connection_verified FROM carrier_directory ORDER BY display_name'
    );
    assert.equal(rows.length, 4);
    const ids = rows.map(r => r.id).sort();
    assert.deepEqual(ids, ['canada-life', 'ia-financial-group', 'manulife', 'sun-life']);
    for (const r of rows) {
      assert.equal(r.country, 'CA');
      assert.equal(r.connection_mode, 'manual');
      assert.equal(r.connection_verified, false);
    }

    // Duplicate ID insertion is prevented
    await assert.rejects(async () => {
      await owner.query("INSERT INTO carrier_directory (id, display_name, country) VALUES ('ia-financial-group', 'Duplicate', 'CA')");
    }, /duplicate key value violates unique constraint/);

    // Invalid country is rejected
    await assert.rejects(async () => {
      await owner.query("INSERT INTO carrier_directory (id, display_name, country) VALUES ('other-carrier', 'Other', 'GB')");
    }, /violates check constraint/);

    // Manual mode cannot have connection_verified = true
    await assert.rejects(async () => {
      await owner.query("INSERT INTO carrier_directory (id, display_name, country, connection_mode, connection_verified) VALUES ('invalid-mode', 'Invalid', 'CA', 'manual', true)");
    }, /violates check constraint/);

    // app_runtime cannot insert, update, or delete
    await assert.rejects(async () => {
      await app.query("INSERT INTO carrier_directory (id, display_name, country) VALUES ('hacked', 'Hacked', 'CA')");
    }, /permission denied for table carrier_directory/);

    await assert.rejects(async () => {
      await app.query("UPDATE carrier_directory SET connection_verified = true WHERE id = 'ia-financial-group'");
    }, /permission denied for table carrier_directory/);

    await assert.rejects(async () => {
      await app.query("DELETE FROM carrier_directory WHERE id = 'ia-financial-group'");
    }, /permission denied for table carrier_directory/);
  } finally {
    await app.end();
    await owner.end();
    await db.drop();
  }
});
