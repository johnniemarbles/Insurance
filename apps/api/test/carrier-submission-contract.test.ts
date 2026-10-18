import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const route = readFileSync(new URL('../src/routes-carrier-submission-settings.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../packages/db/migrations/0132_carrier_submission_settings.sql', import.meta.url), 'utf8');

test('iA recipient settings: writes require tenant administrator', () => {
  assert.match(route, /!ctx\.isTenantAdmin \|\| !ctx\.canWrite/);
});
test('iA recipient settings: saves require revision and reject stale writes', () => {
  assert.match(route, /expectedRevision/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /Carrier settings changed/);
});
test('iA recipient settings: edits clear verification and disable sending', () => {
  assert.match(route, /recipient_verified_at=NULL/);
  assert.match(route, /sending_enabled=false/);
});
test('iA recipient settings: tenant RLS and default disabled sending', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = app_tenant_id\(\)/);
  assert.match(migration, /sending_enabled boolean NOT NULL DEFAULT false/);
});
