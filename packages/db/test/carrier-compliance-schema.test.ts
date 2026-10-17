import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier compliance tables force tenant row-level security', async () => {
 const db=await createTestDb('ca-qc');
 const c=new pg.Client({connectionString:db.ownerUrl});
 await c.connect();
 try {
  const names=['carrier_contract_cases','carrier_contract_events','carrier_authorization_evidence','carrier_product_activations'];
  const {rows}=await c.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>(
   'SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[names]);
  assert.equal(rows.length,names.length);
  for(const row of rows){
   assert.equal(row.relrowsecurity,true,row.relname);
   assert.equal(row.relforcerowsecurity,true,row.relname);
  }
  const triggers=(await c.query<{tgname:string}>(
   `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
     ('carrier_contract_events'::regclass,'carrier_contract_cases'::regclass,
      'carrier_authorization_evidence'::regclass,'carrier_product_activations'::regclass)`)).rows.map(r=>r.tgname);
  for(const name of ['carrier_event_provenance','carrier_case_scope_guard','carrier_authorization_evidence_guard_trigger','carrier_product_scope_guard_trigger','carrier_product_revocation_immutable_trigger','carrier_evidence_revocation_effect_trigger','carrier_product_evidence_insert_guard_trigger','carrier_contract_state_revokes_grants_trigger'])
   assert.ok(triggers.includes(name),name);
 }finally{await c.end();await db.drop();}
});
