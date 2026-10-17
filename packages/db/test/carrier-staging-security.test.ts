import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier submission and staging security objects are installed', async () => {
  const db = await createTestDb('ca-qc');
  const client = new pg.Client({ connectionString: db.ownerUrl });
  await client.connect();
  try {
    const constraints = (await client.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid='carrier_business_submissions'::regclass",
    )).rows.map(r => r.conname);
    assert.ok(constraints.includes('carrier_submission_reference_canonical'));
    assert.ok(constraints.includes('carrier_submission_product_canonical'));
    assert.ok(constraints.includes('carrier_submission_reference_no_controls'));

    const referenceValidation = (await client.query<{ ordinary: boolean; newline: boolean; tab: boolean; delete_char: boolean }>(
      `SELECT 'BROKER-123' !~ '[[:cntrl:]]' AS ordinary,
              ('BROKER-' || chr(10) || '123') !~ '[[:cntrl:]]' AS newline,
              ('BROKER-' || chr(9) || '123') !~ '[[:cntrl:]]' AS tab,
              ('BROKER-' || chr(127) || '123') !~ '[[:cntrl:]]' AS delete_char`,
    )).rows[0];
    assert.deepEqual(referenceValidation, { ordinary: true, newline: false, tab: false, delete_char: false });

    const functions = (await client.query<{ proname: string; prosecdef: boolean }>(
      "SELECT proname,prosecdef FROM pg_proc WHERE proname IN ('carrier_product_submission_authorized','carrier_product_submission_authorized_locked')",
    )).rows;
    assert.equal(functions.length, 2);
    for (const fn of functions) assert.equal(fn.prosecdef, false, fn.proname);

    const policies = (await client.query<{ tablename: string; policyname: string; qual: string }>(
      "SELECT tablename,policyname,qual FROM pg_policies WHERE (tablename='carrier_business_submissions' AND policyname='carrier_submission_read') OR (tablename='carrier_product_activations' AND policyname='carrier_product_read')",
    )).rows;
    assert.equal(policies.length, 2);
    for (const policy of policies) {
      assert.match(policy.qual, /app_is_compliance_at_or_above/);
      assert.doesNotMatch(policy.qual, /user_node_roles/);
    }

    const triggers = (await client.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid='carrier_business_submissions'::regclass AND NOT tgisinternal",
    )).rows.map(r => r.tgname);
    assert.ok(triggers.includes('carrier_business_submission_guard_trigger'));
    assert.ok(triggers.includes('carrier_business_submission_immutable_trigger'));
  } finally {
    await client.end();
    await db.drop();
  }
});
