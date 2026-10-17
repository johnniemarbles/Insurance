import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier product reapproval preserves revoked history and limits live grants', async () => {
  const db = await createTestDb('ca-qc');
  const client = new pg.Client({ connectionString: db.ownerUrl });
  await client.connect();
  try {
    const index = (await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename='carrier_product_activations' AND indexname='carrier_product_one_live_grant_idx'",
    )).rows[0]?.indexdef ?? '';
    assert.match(index, /UNIQUE INDEX/);
    assert.match(index, /revoked_at IS NULL/);
    const obsolete = (await client.query(
      "SELECT 1 FROM pg_constraint WHERE conname='carrier_product_activations_contract_id_product_code_key'",
    )).rowCount;
    assert.equal(obsolete, 0);
    const lockTrigger = (await client.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid='carrier_compliance_holds'::regclass AND NOT tgisinternal AND tgname='carrier_hold_contract_lock_trigger'",
    )).rows;
    assert.equal(lockTrigger.length, 1);
    const triggerFunction = (await client.query<{ definition: string }>(
      "SELECT pg_get_functiondef('carrier_hold_contract_lock()'::regprocedure) AS definition",
    )).rows[0]?.definition ?? '';
    assert.match(triggerFunction, /FOR UPDATE/);
    assert.match(triggerFunction, /tenant_id/);
    assert.match(triggerFunction, /node_id/);
  } finally {
    await client.end();
    await db.drop();
  }
});
