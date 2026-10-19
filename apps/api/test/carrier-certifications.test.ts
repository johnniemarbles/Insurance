import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import pg from 'pg';
import { bootstrapTenant } from '@pii/db';
import { createTestDb } from '@pii/db/testing';
import { registerCarrierCertificationRoutes } from '../src/routes-carrier-certifications.ts';
import type { AppDeps } from '../src/app.ts';
import { HttpError } from '../src/errors.ts';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

test('carrier certifications: input validation & role authorization', async () => {
  const app = Fastify();
  let currentRoles: Array<{ nodeId: string; role: any }> = [{ nodeId: 'n1', role: 'compliance' }];
  let isTenantAdmin = false;

  const deps = {
    authenticate: async () => ({
      ctx: {
        userId: USER_ID,
        tenantId: TENANT_ID,
        nodeIds: [],
        adminNodeIds: [],
        roles: currentRoles,
        isTenantAdmin,
        canWrite: true,
        canUseCrm: true,
      },
    }),
    appPool: undefined,
  } as unknown as AppDeps;

  registerCarrierCertificationRoutes(app, deps);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'unexpected', message: (error as Error).message } });
  });

  // 1. Unprivileged user gets 403
  currentRoles = [{ nodeId: 'n1', role: 'learner' }];
  isTenantAdmin = false;
  const unauthGateRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/gate',
    payload: { gateKey: 'gate1_legal_agreement', evidence: 'Signed DPA' },
  });
  assert.equal(unauthGateRes.statusCode, 403);

  const unauthTierRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/tier',
    payload: { tier: 'certified' },
  });
  assert.equal(unauthTierRes.statusCode, 403);

  // 2. Compliance officer with invalid gate key gets 422
  currentRoles = [{ nodeId: 'n1', role: 'compliance' }];
  const invalidGateRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/gate',
    payload: { gateKey: 'invalid_gate_key', evidence: 'Some evidence' },
  });
  assert.equal(invalidGateRes.statusCode, 422);

  // 3. Compliance officer with empty evidence gets 422
  const emptyEvidenceRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/gate',
    payload: { gateKey: 'gate1_legal_agreement', evidence: '   ' },
  });
  assert.equal(emptyEvidenceRes.statusCode, 422);

  // 4. Compliance officer attempting to set live tier gets 422 fail-closed
  const liveTierRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/tier',
    payload: { tier: 'live' },
  });
  assert.equal(liveTierRes.statusCode, 422);
  assert.match(liveTierRes.json().error.message, /Live electronic dispatch is disabled fail-closed/);

  // 5. Invalid tier name gets 422
  const invalidTierRes = await app.inject({
    method: 'POST',
    url: '/v1/compliance/carrier-certifications/ia-financial-group/tier',
    payload: { tier: 'non_existent_tier' },
  });
  assert.equal(invalidTierRes.statusCode, 422);
});

test('carrier certifications: authoritative registry database roundtrip and tenant isolation', async () => {
  const db = await createTestDb('ca-qc');
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();

  const appPool = new pg.Pool({ connectionString: db.appUrl });

  try {
    // 1. Bootstrap seed tenant and user
    const t = await bootstrapTenant(db.ownerUrl, {
      name: 'Apex API Test',
      countryCode: 'CA',
      adminEmail: 'admin@apex-api.test',
    });
    const tenantId = t.tenantId;
    const userId = t.adminUserId;

    const app = Fastify();
    let authTenantId = tenantId;
    let authUserId = userId;

    const deps = {
      authenticate: async () => ({
        ctx: {
          userId: authUserId,
          tenantId: authTenantId,
          nodeIds: [],
          adminNodeIds: [],
          roles: [{ nodeId: 'n1', role: 'compliance' }],
          isTenantAdmin: true,
          canWrite: true,
          canUseCrm: true,
        },
      }),
      appPool,
    } as unknown as AppDeps;

    registerCarrierCertificationRoutes(app, deps);

    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      return reply.code(500).send({ error: { code: 'unexpected', message: (error as Error).message } });
    });

    // 2. Query initial certification registry: returns all carriers with isAuthoritative = false
    const initialGet = await app.inject({
      method: 'GET',
      url: '/v1/compliance/carrier-certifications',
    });
    assert.equal(initialGet.statusCode, 200);
    const initialList = initialGet.json().certifications;
    assert.equal(initialList.length, 4);
    for (const c of initialList) {
      assert.equal(c.isAuthoritative, false);
      assert.equal(c.currentTier, 'manual_portal');
      assert.equal(c.dispatchLocked, true);
    }

    // 3. Record Gate 1 evidence
    const gate1Res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/carrier-certifications/ia-financial-group/gate',
      payload: {
        gateKey: 'gate1_legal_agreement',
        evidence: 'Bilateral DPA signed 2026-10-18 ref #IA-2026-001',
      },
    });
    assert.equal(gate1Res.statusCode, 200);
    assert.equal(gate1Res.json().ok, true);

    // 4. Query registry: ia-financial-group is now authoritative
    const updatedGet = await app.inject({
      method: 'GET',
      url: '/v1/compliance/carrier-certifications',
    });
    const updatedList = updatedGet.json().certifications;
    const ia = updatedList.find((c: any) => c.carrierId === 'ia-financial-group');
    assert.ok(ia);
    assert.equal(ia.isAuthoritative, true);
    assert.equal(ia.gates.gate1LegalAgreement, true);
    assert.equal(ia.gates.gate1LegalEvidence, 'Bilateral DPA signed 2026-10-18 ref #IA-2026-001');
    assert.equal(ia.gates.gate2SandboxCertified, false);

    // 5. Attempt promotion to certified before Gate 2: must fail with 422
    const prematureCertRes = await app.inject({
      method: 'POST',
      url: '/v1/compliance/carrier-certifications/ia-financial-group/tier',
      payload: { tier: 'certified' },
    });
    assert.equal(prematureCertRes.statusCode, 422);
    assert.match(prematureCertRes.json().error.message, /requires Gate 1 .* and Gate 2/);

    // 6. Record Gate 2 evidence
    const gate2Res = await app.inject({
      method: 'POST',
      url: '/v1/compliance/carrier-certifications/ia-financial-group/gate',
      payload: {
        gateKey: 'gate2_sandbox_certified',
        evidence: 'Sandbox certification completed 2026-10-19 50/50 roundtrips zero error',
      },
    });
    assert.equal(gate2Res.statusCode, 200);

    // 7. Successful promotion to certified
    const certPromotionRes = await app.inject({
      method: 'POST',
      url: '/v1/compliance/carrier-certifications/ia-financial-group/tier',
      payload: {
        tier: 'certified',
        tierExpiresOn: '2027-10-19',
        notes: 'Passed annual compliance and sandbox technical evaluation',
      },
    });
    assert.equal(certPromotionRes.statusCode, 200);
    assert.equal(certPromotionRes.json().certification.tier, 'certified');
    assert.equal(certPromotionRes.json().certification.certified_by, userId);

    // 8. Re-query: ia is certified with certifiedBy and expiry set
    const certifiedGet = await app.inject({
      method: 'GET',
      url: '/v1/compliance/carrier-certifications',
    });
    const certifiedIa = certifiedGet.json().certifications.find((c: any) => c.carrierId === 'ia-financial-group');
    assert.equal(certifiedIa.currentTier, 'certified');
    assert.equal(certifiedIa.certifiedBy, userId);
    assert.ok(certifiedIa.certifiedAt);

    // 9. Multi-tenant isolation: switch to another tenant
    authTenantId = '00000000-0000-0000-0000-000000000002';
    authUserId = '00000000-0000-0000-0000-000000000003';
    const isolatedGet = await app.inject({
      method: 'GET',
      url: '/v1/compliance/carrier-certifications',
    });
    const isolatedIa = isolatedGet.json().certifications.find((c: any) => c.carrierId === 'ia-financial-group');
    assert.equal(isolatedIa.isAuthoritative, false, 'Tenant B must see uncertified default status');
    assert.equal(isolatedIa.currentTier, 'manual_portal');
    assert.equal(isolatedIa.gates.gate1LegalAgreement, false);
  } finally {
    await appPool.end();
    await owner.end();
    await db.drop();
  }
});
