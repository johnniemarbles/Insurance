import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = (name: string) => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');

test('carrier reapproval migrations do not drop the same constraint twice', () => {
  const original = migration('0090_carrier_product_activations.sql');
  const firstReapproval = migration('0092_carrier_product_reapproval.sql');
  const latestReapproval = migration('0129_carrier_product_reapproval.sql');
  assert.match(original, /UNIQUE\(contract_id,product_code\)/);
  assert.match(firstReapproval, /DROP CONSTRAINT carrier_product_activations_contract_id_product_code_key/);
  assert.doesNotMatch(latestReapproval, /DROP CONSTRAINT carrier_product_activations_contract_id_product_code_key/);
  assert.match(latestReapproval, /CREATE UNIQUE INDEX carrier_product_one_live_grant_idx/);
  assert.match(latestReapproval, /WHERE revoked_at IS NULL/);
  assert.match(latestReapproval, /DROP INDEX IF EXISTS carrier_product_one_live_grant/);
});
