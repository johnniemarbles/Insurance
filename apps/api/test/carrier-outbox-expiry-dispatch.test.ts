import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapTenant, withRequestTx, type Tx } from '@pii/db';
import { createTestDb } from '@pii/db/testing';
import { assertExternalCarrierDispatch, CarrierConnectionUnavailable } from '@pii/platform';
import { sweepCarrierOutbox } from '../src/carrier-outbox-worker.ts';
import type { AppDeps } from '../src/app.ts';

test('carrier outbox worker: expiry enforcement and certification invariants', async () => {
  const db = await createTestDb('ca-qc');
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();

  const appPool = new pg.Pool({ connectionString: db.appUrl });

  try {
    // 1. Bootstrap test tenant
    const t = await bootstrapTenant(db.ownerUrl, {
      name: 'Apex Dispatch Test',
      countryCode: 'CA',
      adminEmail: 'admin@apex-dispatch.test',
    });
    const tenantId = t.tenantId;
    const userId = t.adminUserId;

    function workerTenantCtx(tId: string) {
      return {
        tenantId: tId,
        userId,
        nodeIds: [],
        adminNodeIds: [],
        isTenantAdmin: true,
        canWrite: true,
        canUseCrm: true,
        roles: [],
      };
    }

    // Helper to evaluate certification query as done by the outbox worker
    async function queryCertStatus(carrierId: string) {
      return withRequestTx(appPool, workerTenantCtx(tenantId), async (tx: Tx) => {
        return (
          await tx.query<{
            tier: string;
            gate1_legal_agreement: boolean;
            gate2_sandbox_certified: boolean;
            gate3_kms_secrets_provisioned: boolean;
            gate4_outbox_safety_verified: boolean;
            gate5_feature_flag_active: boolean;
            certified_by: string | null;
            certified_at: string | null;
            tier_expires_on: string | null;
            not_expired: boolean;
          }>(
            `SELECT
               tier,
               gate1_legal_agreement,
               gate2_sandbox_certified,
               gate3_kms_secrets_provisioned,
               gate4_outbox_safety_verified,
               gate5_feature_flag_active,
               certified_by,
               certified_at,
               tier_expires_on,
               tier_expires_on > CURRENT_DATE AS not_expired
             FROM carrier_certifications
             WHERE tenant_id = $1 AND carrier_id = $2`,
            [tenantId, carrierId]
          )
        ).rows[0];
      });
    }

    function isProductionCertified(cert: any) {
      return Boolean(
        cert &&
        cert.tier === 'live' &&
        cert.not_expired &&
        cert.gate1_legal_agreement &&
        cert.gate2_sandbox_certified &&
        cert.gate3_kms_secrets_provisioned &&
        cert.gate4_outbox_safety_verified &&
        cert.gate5_feature_flag_active &&
        cert.certified_by &&
        cert.certified_at
      );
    }

    // 2. Missing certification row fails closed
    const certNone = await queryCertStatus('ia-financial-group');
    assert.equal(isProductionCertified(certNone), false);

    // 3. Certification with yesterday's expiry must be rejected
    await owner.query(
      `INSERT INTO carrier_certifications (
         tenant_id, carrier_id, tier, adapter_status,
         gate1_legal_agreement, gate1_legal_evidence,
         gate2_sandbox_certified, gate2_sandbox_evidence,
         gate3_kms_secrets_provisioned, gate3_kms_evidence,
         gate4_outbox_safety_verified, gate4_outbox_evidence,
         gate5_feature_flag_active, gate5_approved_by, gate5_approved_at,
         certified_by, certified_at,
         tier_expires_on
       ) VALUES (
         $1, 'ia-financial-group', 'live', 'implemented',
         true, 'DPA signed',
         true, 'Sandbox 50/50',
         true, 'KMS provisioned',
         true, 'Outbox verified',
         true, $2, now(),
         $2, now(),
         CURRENT_DATE - INTERVAL '1 day'
       )`,
      [tenantId, userId]
    );

    const certYesterday = await queryCertStatus('ia-financial-group');
    assert.ok(certYesterday);
    assert.equal(certYesterday.not_expired, false, 'Yesterday expiry must be marked expired');
    assert.equal(isProductionCertified(certYesterday), false, 'Yesterday expiry must not be production certified');

    // 4. Certification expiring today must also be rejected
    await owner.query(
      `UPDATE carrier_certifications
          SET tier_expires_on = CURRENT_DATE,
              revision = revision + 1
        WHERE tenant_id = $1 AND carrier_id = 'ia-financial-group'`,
      [tenantId]
    );

    const certToday = await queryCertStatus('ia-financial-group');
    assert.ok(certToday);
    assert.equal(certToday.not_expired, false, 'Today expiry must be marked expired');
    assert.equal(isProductionCertified(certToday), false, 'Today expiry must not be production certified');

    // 5. Missing gate or non-live tier must fail closed even with future date
    await owner.query(
      `UPDATE carrier_certifications
          SET tier = 'sandbox_testing',
              tier_expires_on = CURRENT_DATE + INTERVAL '30 days',
              gate3_kms_secrets_provisioned = false,
              gate3_kms_evidence = NULL,
              revision = revision + 1
        WHERE tenant_id = $1 AND carrier_id = 'ia-financial-group'`,
      [tenantId]
    );

    const certMissingGate = await queryCertStatus('ia-financial-group');
    assert.ok(certMissingGate);
    assert.equal(certMissingGate.not_expired, true);
    assert.equal(isProductionCertified(certMissingGate), false, 'Missing Gate 3 must fail production certification');

    // 6. Complete valid future certification satisfies productionCertified
    await owner.query(
      `UPDATE carrier_certifications
          SET tier = 'live',
              gate3_kms_secrets_provisioned = true,
              gate3_kms_evidence = 'Dual-secret KMS provisioned',
              revision = revision + 1
        WHERE tenant_id = $1 AND carrier_id = 'ia-financial-group'`,
      [tenantId]
    );

    const certValidFuture = await queryCertStatus('ia-financial-group');
    assert.ok(certValidFuture);
    assert.equal(certValidFuture.not_expired, true);
    assert.equal(isProductionCertified(certValidFuture), true, 'All 5 gates + future expiry must be production certified');

    // 7. Fail-closed safety invariant: external carrier dispatch is hard-locked disabled under all conditions
    assert.throws(() => {
      assertExternalCarrierDispatch({
        environment: 'prod',
        allowExternalDispatch: false,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: true,
        productionApproved: isProductionCertified(certValidFuture),
        changeTicket: 'CHG-2026-001',
      });
    }, (err: any) => err instanceof CarrierConnectionUnavailable && /External carrier dispatch is disabled/.test(err.message));

    // 8. If external dispatch were theoretically evaluated in prod with unapproved cert, it refuses
    assert.throws(() => {
      assertExternalCarrierDispatch({
        environment: 'prod',
        allowExternalDispatch: true,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: true,
        productionApproved: isProductionCertified(certYesterday),
        changeTicket: 'CHG-2026-001',
      });
    }, (err: any) => err instanceof CarrierConnectionUnavailable && /Production carrier approval required/.test(err.message));

  } finally {
    await appPool.end();
    await owner.end();
    await db.drop();
  }
});
