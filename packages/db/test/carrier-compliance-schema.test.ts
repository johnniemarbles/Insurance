import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../src/testing.ts';

test('carrier compliance tables force tenant row-level security', async () => {
 const db=await createTestDb('ca-qc');
 const c=new pg.Client({connectionString:db.ownerUrl});
 await c.connect();
 try {
  const names=['carrier_contract_cases','carrier_contract_events','carrier_authorization_evidence','carrier_product_activations','carrier_compliance_holds','carrier_business_submissions'];
  const {rows}=await c.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>(
   'SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[names]);
  assert.equal(rows.length,names.length);
  for(const row of rows){
   assert.equal(row.relrowsecurity,true,row.relname);
   assert.equal(row.relforcerowsecurity,true,row.relname);
  }
  const view=(await c.query<{reloptions:string[]|null}>(
   "SELECT reloptions FROM pg_class WHERE oid='carrier_product_authorization_status'::regclass")).rows[0];
  assert.ok(view?.reloptions?.includes('security_invoker=true'),'carrier status view must use caller RLS');
  const definition=(await c.query<{definition:string}>("SELECT pg_get_viewdef('carrier_product_authorization_status'::regclass) AS definition")).rows[0]?.definition??'';
  assert.match(definition,/carrier_compliance_holds/);
  const submissionFunctions=(await c.query<{proname:string}>("SELECT proname FROM pg_proc WHERE proname IN ('carrier_product_submission_authorized','carrier_product_submission_authorized_locked')")).rows.map(x=>x.proname);
  assert.ok(submissionFunctions.includes('carrier_product_submission_authorized'));
  assert.ok(submissionFunctions.includes('carrier_product_submission_authorized_locked'));
  const sources=(await c.query<{checkdef:string}>("SELECT pg_get_constraintdef(oid) AS checkdef FROM pg_constraint WHERE conname='carrier_grant_revocation_provenance'")).rows;
  assert.equal(sources.length,1);
  assert.match(sources[0].checkdef,/revocation_source/);
  const staging=(await c.query<{indexname:string}>("SELECT indexname FROM pg_indexes WHERE tablename='carrier_business_submissions'")).rows.map(x=>x.indexname);
  assert.ok(staging.includes('carrier_business_submissions_tenant_id_contract_id_external_reference_key'));
  assert.ok(staging.includes('carrier_submission_queue_idx'));
  const indexNames=(await c.query<{indexname:string}>(
   "SELECT indexname FROM pg_indexes WHERE tablename IN ('carrier_product_activations','carrier_authorization_evidence')")).rows.map(x=>x.indexname);
  assert.ok(indexNames.includes('carrier_product_live_lookup_idx'));
  assert.ok(indexNames.includes('carrier_evidence_live_lookup_idx'));
  const triggers=(await c.query<{tgname:string}>(
   `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
     ('carrier_contract_events'::regclass,'carrier_contract_cases'::regclass,
      'carrier_authorization_evidence'::regclass,'carrier_product_activations'::regclass,'carrier_compliance_holds'::regclass,'carrier_business_submissions'::regclass)`)).rows.map(r=>r.tgname);
  for(const name of ['carrier_event_provenance','carrier_case_scope_guard','carrier_authorization_evidence_guard_trigger','carrier_product_scope_guard_trigger','carrier_product_revocation_immutable_trigger','carrier_evidence_revocation_effect_trigger','carrier_product_evidence_insert_guard_trigger','carrier_contract_state_revokes_grants_trigger','carrier_compliance_hold_guard_trigger','carrier_hold_revokes_product_grants_trigger','carrier_product_revocation_provenance_guard_trigger','carrier_business_submission_guard_trigger','carrier_business_submission_immutable_trigger'])
   assert.ok(triggers.includes(name),name);
 }finally{await c.end();await db.drop();}
});
