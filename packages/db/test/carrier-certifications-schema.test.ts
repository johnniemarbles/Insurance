import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapTenant } from '../src/index.ts';
import { createTestDb } from '../src/testing.ts';

test('carrier_certifications schema: RLS, check constraints, and activation invariants', async () => {
  const db = await createTestDb('ca-qc');
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  const app = new pg.Client({ connectionString: db.appUrl });
  await owner.connect();
  await app.connect();

  try {
    // 1. Verify zero RLS drift
    const drift = await owner.query<{ table_name: string }>(
      "SELECT table_name FROM rls_drift WHERE table_name = 'carrier_certifications'"
    );
    assert.equal(drift.rowCount, 0, 'carrier_certifications must not have RLS drift');

    // 2. Bootstrap test tenant and user
    const t = await bootstrapTenant(db.ownerUrl, {
      name: 'Apex Brokerage',
      countryCode: 'CA',
      adminEmail: 'admin@apex-schema.test',
    });
    const tenantId = t.tenantId;
    const userId = t.adminUserId;

    // 3. Reject Gate 1 without evidence
    await assert.rejects(async () => {
      await owner.query(
        `INSERT INTO carrier_certifications (tenant_id, carrier_id, gate1_legal_agreement)
         VALUES ($1, 'ia-financial-group', true)`,
        [tenantId]
      );
    }, /violates check constraint/);

    // 4. Reject Gate 1 with whitespace-only evidence
    await assert.rejects(async () => {
      await owner.query(
        `INSERT INTO carrier_certifications (tenant_id, carrier_id, gate1_legal_agreement, gate1_legal_evidence)
         VALUES ($1, 'ia-financial-group', true, '   ')`,
        [tenantId]
      );
    }, /violates check constraint/);

    // 5. Successful insert with valid Gate 1 evidence
    await owner.query(
      `INSERT INTO carrier_certifications (tenant_id, carrier_id, gate1_legal_agreement, gate1_legal_evidence)
       VALUES ($1, 'ia-financial-group', true, 'DPA signed 2026-10-18 ref #IA-882')`,
      [tenantId]
    );

    // 6. Reject promotion to certified without Gate 2
    await assert.rejects(async () => {
      await owner.query(
        `UPDATE carrier_certifications
            SET tier = 'certified', certified_by = $1, certified_at = now()
          WHERE tenant_id = $2 AND carrier_id = 'ia-financial-group'`,
        [userId, tenantId]
      );
    }, /violates check constraint/);

    // 7. Reject promotion to live even if certified, when gates 3-5 are missing
    await assert.rejects(async () => {
      await owner.query(
        `UPDATE carrier_certifications
            SET tier = 'live', tier_expires_on = '2027-12-31'
          WHERE tenant_id = $1 AND carrier_id = 'ia-financial-group'`,
        [tenantId]
      );
    }, /violates check constraint/);

    // 8. RLS runtime verification for carrier_certifications
    // Set tenant session context on app client
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    const appRows = (
      await app.query<{ carrier_id: string; gate1_legal_agreement: boolean }>(
        "SELECT carrier_id, gate1_legal_agreement FROM carrier_certifications WHERE carrier_id = 'ia-financial-group'"
      )
    ).rows;
    assert.equal(appRows.length, 1);
    assert.equal(appRows[0]!.gate1_legal_agreement, true);

    // Switch to non-existent tenant: must return 0 rows
    const fakeTenant = '00000000-0000-0000-0000-000000000001';
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [fakeTenant]);
    const isolatedRows = (
      await app.query<{ carrier_id: string }>(
        "SELECT carrier_id FROM carrier_certifications WHERE carrier_id = 'ia-financial-group'"
      )
    ).rows;
    assert.equal(isolatedRows.length, 0, 'Must be isolated by RLS tenant wall');

    // 9. Verify zero RLS drift on carrier_certification_audit
    const auditDrift = await owner.query<{ table_name: string }>(
      "SELECT table_name FROM rls_drift WHERE table_name = 'carrier_certification_audit'"
    );
    assert.equal(auditDrift.rowCount, 0, 'carrier_certification_audit must not have RLS drift');

    // 10. Audit history triggered automatically by migration trigger
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    await app.query("SELECT set_config('app.user_id', $1, false)", [userId]);

    const auditRows = (
      await app.query<{
        carrier_id: string;
        revision: number;
        operation: string;
        actor_id: string | null;
        previous_record: Record<string, unknown> | null;
        current_record: Record<string, unknown> | null;
      }>(
        "SELECT carrier_id, revision, operation, actor_id, previous_record, current_record FROM carrier_certification_audit WHERE carrier_id = 'ia-financial-group' ORDER BY revision ASC"
      )
    ).rows;

    assert.ok(auditRows.length >= 1, 'Audit row must be created by trigger');
    assert.equal(auditRows[0]!.operation, 'INSERT');
    assert.equal(auditRows[0]!.revision, 1);
    assert.equal(auditRows[0]!.carrier_id, 'ia-financial-group');

    // 11. Immutability & append-only protection: app_runtime cannot write directly to audit table
    await assert.rejects(async () => {
      await app.query(
        `INSERT INTO carrier_certification_audit (tenant_id, carrier_id, revision, operation)
         VALUES ($1, 'ia-financial-group', 99, 'INSERT')`,
        [tenantId]
      );
    }, /permission denied for table carrier_certification_audit/);

    await assert.rejects(async () => {
      await app.query(
        "UPDATE carrier_certification_audit SET operation = 'UPDATE' WHERE carrier_id = 'ia-financial-group'"
      );
    }, /permission denied for table carrier_certification_audit/);

    await assert.rejects(async () => {
      await app.query(
        "DELETE FROM carrier_certification_audit WHERE carrier_id = 'ia-financial-group'"
      );
    }, /permission denied for table carrier_certification_audit/);

    // 12. Tenant isolation on audit history: other tenant sees 0 rows
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [fakeTenant]);
    const isolatedAuditRows = (
      await app.query(
        "SELECT * FROM carrier_certification_audit WHERE carrier_id = 'ia-financial-group'"
      )
    ).rows;
    assert.equal(isolatedAuditRows.length, 0, 'Audit history must be strictly tenant-isolated');
  } finally {
    await app.end();
    await owner.end();
    await db.drop();
  }
});
