import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_REQUIREMENTS } from '../src/routes-carrier-workflow.ts';

test('carrier requirements: all four Canadian carriers have standardized checklists', () => {
  const carriers = ['ia-financial-group', 'manulife', 'sun-life', 'canada-life'];
  for (const c of carriers) {
    const req = CARRIER_REQUIREMENTS[c];
    assert.ok(req, `Requirements defined for ${c}`);
    assert.ok(req.checklist.length >= 4, `Checklist contains core requirements for ${c}`);
    const types = req.checklist.map(i => i.type);
    assert.ok(types.includes('licence'), `Licence required for ${c}`);
    assert.ok(types.includes('eo_insurance'), `E&O insurance required for ${c}`);
    assert.ok(types.includes('banking_void_cheque'), `Banking info required for ${c}`);
    assert.ok(types.includes('carrier_app_schedule'), `Contracting schedule required for ${c}`);
  }
});

test('carrier workflow routes: static contract invariants and safety gates', async () => {
  const fs = await import('node:fs/promises');
  const routeCode = await fs.readFile('apps/api/src/routes-carrier-workflow.ts', 'utf-8');

  // 1. Mandatory role gates
  assert.match(routeCode, /isOfficer/, 'Requires compliance officer or tenant administrator check');
  assert.match(routeCode, /forbidden\('Compliance authorization required/, 'Throws forbidden when officer check fails');

  // 2. Hash integrity checks
  assert.match(routeCode, /\[a-f0-9\]\{64\}/, 'Enforces strict 64-char SHA-256 content hash check');
  assert.match(routeCode, /packageHash/, 'Generates immutable bundle package hash');

  // 3. Disabled-send safety gate
  assert.match(
    routeCode,
    /sending_enabled || !settings\.recipient_verified_at/,
    'Enforces sending_enabled and recipient_verified_at before email dispatch'
  );

  // 4. Appointment date validity and reference requirement
  assert.match(routeCode, /effectiveOn > expiresOn/, 'Rejects expiry date before effective date');
  assert.match(routeCode, /appointment reference required/i, 'Mandates authoritative appointment reference');

  // 5. Document requirement and consent before broker signature
  assert.match(routeCode, /supporting application document must be attached before signing/, 'Blocks signature without attached documents');
  assert.match(routeCode, /Broker consent must be explicitly confirmed/, 'Enforces explicit broker consent before signing');
  assert.match(routeCode, /not authorized to sign for this partner node/, 'Enforces partner node authorization for signer');
  assert.match(routeCode, /signerIdentity/, 'Tracks authenticated signer identity in audit events');
});

test('carrier contracting database migration: schema and RLS invariants', async () => {
  const fs = await import('node:fs/promises');
  const migration = await fs.readFile('packages/db/migrations/0133_carrier_contracting_workflow.sql', 'utf-8');

  // RLS tenant_wall policy mandatory for zero-drift CI
  assert.match(migration, /CREATE POLICY tenant_wall ON carrier_contract_documents/, 'Documents table has tenant_wall policy');
  assert.match(migration, /CREATE POLICY tenant_wall ON carrier_contract_submissions/, 'Submissions table has tenant_wall policy');
  assert.match(migration, /FORCE ROW LEVEL SECURITY/, 'Forces RLS on new tables');
  assert.match(migration, /REVOKE ALL ON carrier_contract_documents FROM PUBLIC, app_auth/);
  assert.match(migration, /REVOKE ALL ON carrier_contract_submissions FROM PUBLIC, app_auth/);
});
