import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import {
  canMoveCarrierContract,
  carrierAuthorizationBlocks,
  maySubmitCarrierBusiness,
  type CarrierContractState,
} from '@pii/domain';
import { revalidateOutboxDispatch, type CarrierConnection } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

// ---------------------------------------------------------------------------
// 1. Static & Schema Invariants
// ---------------------------------------------------------------------------

test('carrier lifecycle: canonical state machine transitions and invalid jumps', () => {
  assert.equal(canMoveCarrierContract('requested', 'documents_prepared'), true);
  assert.equal(canMoveCarrierContract('documents_prepared', 'broker_signed'), true);
  assert.equal(canMoveCarrierContract('broker_signed', 'submitted'), true);
  assert.equal(canMoveCarrierContract('submitted', 'carrier_review'), true);
  assert.equal(canMoveCarrierContract('carrier_review', 'approved'), true);
  assert.equal(canMoveCarrierContract('approved', 'appointment_verified'), true);
  assert.equal(canMoveCarrierContract('appointment_verified', 'active'), true);

  // Illegal jumps directly to active without carrier approval and appointment verification
  assert.equal(canMoveCarrierContract('requested', 'active'), false);
  assert.equal(canMoveCarrierContract('documents_prepared', 'active'), false);
  assert.equal(canMoveCarrierContract('broker_signed', 'active'), false);
  assert.equal(canMoveCarrierContract('submitted', 'active'), false);
  assert.equal(canMoveCarrierContract('declined', 'active'), false);
  assert.equal(canMoveCarrierContract('terminated', 'active'), false);
});

test('carrier lifecycle: fail-closed carrier authorization blocking logic', () => {
  const baseAuth = {
    brokerCleared: true,
    agencyAgreementCountersigned: true,
    licenceValid: true,
    eoValid: true,
    trainingCurrent: true,
    jurisdictionAllowed: true,
    productAllowed: true,
    carrierState: 'active' as CarrierContractState,
    appointmentEffective: true,
    appointmentNotExpired: true,
    complianceHold: false,
  };

  assert.equal(maySubmitCarrierBusiness(baseAuth), true);
  assert.deepEqual(carrierAuthorizationBlocks(baseAuth), []);

  // Fail closed if compliance hold is active
  const withHold = { ...baseAuth, complianceHold: true };
  assert.equal(maySubmitCarrierBusiness(withHold), false);
  assert.ok(carrierAuthorizationBlocks(withHold).includes('compliance_hold'));

  // Fail closed if licence is invalid or expired
  const withInvalidLicence = { ...baseAuth, licenceValid: false };
  assert.equal(maySubmitCarrierBusiness(withInvalidLicence), false);
  assert.ok(carrierAuthorizationBlocks(withInvalidLicence).includes('licence_invalid'));

  // Fail closed if appointment is expired
  const withExpiredAppt = { ...baseAuth, appointmentNotExpired: false };
  assert.equal(maySubmitCarrierBusiness(withExpiredAppt), false);
  assert.ok(carrierAuthorizationBlocks(withExpiredAppt).includes('appointment_expired'));
});

test('outbox schema migration: RLS tenant_wall policy and restrictive permissions', () => {
  const migration = readFileSync(
    new URL('../../../packages/db/migrations/0134_carrier_dispatch_outbox.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /CREATE TABLE( IF NOT EXISTS)? carrier_dispatch_outbox/, 'Outbox table declared');
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/, 'RLS enabled');
  assert.match(migration, /FORCE ROW LEVEL SECURITY/, 'RLS forced');
  assert.match(migration, /CREATE POLICY tenant_wall ON carrier_dispatch_outbox/, 'Restricted to tenant_wall');
  assert.match(migration, /REVOKE ALL ON carrier_dispatch_outbox FROM PUBLIC, app_auth/, 'Revoked from unprivileged roles');
  assert.match(migration, /CHECK \(status IN \('queued', 'processing', 'dispatched', 'failed', 'dead_letter'\)\)/, 'Status domain validated');
});

// ---------------------------------------------------------------------------
// 2. Integration Tests: Carrier Workflow, Outbox Queueing & Live Eligibility
// ---------------------------------------------------------------------------

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string };
let co2: { tenantId: string; rootNodeId: string };

const ADMIN = 'admin@apex-carrier.test';
const COMPLIANCE = 'compliance@apex-carrier.test';
const BROKER = 'broker@apex-carrier.test';
const T2_ADMIN = 'admin@beacon-carrier.test';

let agencyNodeId = '';
let onboardingCaseId = '';
let contractCaseId = '';

type M = 'GET' | 'POST' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];

  const config = loadConfig({
    APP_ENV: 'test',
    REGION: 'ca-qc',
    DATABASE_URL: db.ownerUrl,
    APP_DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true',
  });

  deps = {
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  };
  app = buildApp(deps);

  // Tenant 1
  co = await bootstrapTenant(db.ownerUrl, { name: 'Apex Carrier Ops', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  // Tenant 2
  co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Carrier Ops', countryCode: 'CA', adminEmail: T2_ADMIN });
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');

  // Org structure & users in Tenant 1
  const locId = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto HQ' })).json.id;
  agencyNodeId = await addBrokerFixture(call, db.ownerUrl, locId, 'Apex Financial Toronto');

  await owner(async (c) => {
    // Compliance user
    const cu = (
      await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co.tenantId, COMPLIANCE, 'Apex Compliance', agencyNodeId]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'compliance')`,
      [co.tenantId, cu, agencyNodeId]
    );

    // Broker user
    const bu = (
      await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co.tenantId, BROKER, 'Apex Broker', agencyNodeId]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'partner')`,
      [co.tenantId, bu, agencyNodeId]
    );

    // Retrieve and update existing onboarding case created by broker fixture
    const obRes = await c.query(
      `SELECT id FROM onboarding_cases WHERE tenant_id = $1 AND node_id = $2`,
      [co.tenantId, agencyNodeId]
    );
    onboardingCaseId = obRes.rows[0].id;
    await c.query(
      `UPDATE onboarding_cases SET stage = 'active', standing = 'good_standing' WHERE id = $1`,
      [onboardingCaseId]
    );

    // Seed onboarding agreement (signed by officer)
    await c.query(
      `INSERT INTO onboarding_agreements (tenant_id, case_id, node_id, title, body, version, body_hash, typed_name, sealed_pdf, officer_signed_at)
       VALUES ($1, $2, $3, 'Agency Agreement', 'body text', 'v1.0', repeat('a', 64), 'Apex Broker', decode('', 'hex'), now())`,
      [co.tenantId, onboardingCaseId, agencyNodeId]
    );

    // Seed carrier contract case for iA Financial Group in requested state
    const ccRes = await c.query(
      `INSERT INTO carrier_contract_cases (tenant_id, onboarding_case_id, node_id, carrier_id, carrier_name, jurisdiction, state, created_by)
       VALUES ($1, $2, $3, 'ia-financial-group', 'iA Financial Group', 'ON', 'requested', $4) RETURNING id`,
      [co.tenantId, onboardingCaseId, agencyNodeId, cu]
    );
    contractCaseId = ccRes.rows[0].id;
  });

  await call(COMPLIANCE, 'POST', '/v1/consent/first-login');
  await call(BROKER, 'POST', '/v1/consent/first-login');
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map((p) => p.end()));
  if (db) await db.drop();
});

test('carrier workflow: prepare packet and attach supporting application document', async () => {
  // 1. Prepare packet
  const prep = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/prepare-packet`, {
    templateVersion: '2026-Q1-v2',
  });
  assert.equal(prep.status, 200);
  assert.equal(prep.json.state, 'documents_prepared');

  // 2. Attach application schedule document
  const doc = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/documents`, {
    documentType: 'carrier_app_schedule',
    title: 'iA Contracting Application Schedule',
    fileName: 'schedule.pdf',
    fileSizeBytes: 1024,
    contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  });
  assert.equal(doc.status, 201);
  assert.ok(doc.json.id, 'Document ID returned');
});

test('carrier workflow: broker signs packet with explicit consent confirmation', async () => {
  // Signing requires explicit consent confirmation
  const failSign = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/sign-packet`, {
    consentRecorded: false,
    signerName: 'Apex Broker',
  });
  assert.equal(failSign.status, 422);

  // Successful signature
  const sign = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/sign-packet`, {
    consentRecorded: true,
    signerName: 'Apex Broker',
  });
  assert.equal(sign.status, 200);
  assert.equal(sign.json.state, 'broker_signed');
});

test('carrier workflow: submit package enqueues outbox record and enforces tenant isolation', async () => {
  const sub = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/submit-package`, {
    notes: 'Submitting finalized package for carrier review',
  });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.status, 'submitted');
  assert.ok(sub.json.packageHash, 'Contains immutable package bundle SHA-256');

  // Verify outbox queueing
  const outboxRes = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-outbox');
  assert.equal(outboxRes.status, 200);
  assert.ok(Array.isArray(outboxRes.json.outbox));
  assert.ok(outboxRes.json.outbox.length >= 1);

  const entry = outboxRes.json.outbox.find((o: { contractId: string }) => o.contractId === contractCaseId);
  assert.ok(entry, 'Found outbox entry for submitted carrier contract');
  assert.equal(entry.carrierId, 'ia-financial-group');
  assert.equal(entry.operation, 'contract_packet');
  assert.equal(entry.jurisdiction, 'ON');
  assert.ok(['queued', 'dispatched'].includes(entry.status));

  // Multi-tenant isolation: Tenant 2 cannot see Tenant 1's outbox entries
  const t2Outbox = await call(T2_ADMIN, 'GET', '/v1/compliance/carrier-outbox');
  assert.equal(t2Outbox.status, 200);
  assert.equal(
    t2Outbox.json.outbox.filter((o: { contractId: string }) => o.contractId === contractCaseId).length,
    0,
    'Tenant 2 cannot view Tenant 1 outbox entries'
  );
});

test('carrier outbox: retry revalidates live context and blocks when compliance hold active', async () => {
  // Get outbox entry id
  const outboxRes = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-outbox');
  const entry = outboxRes.json.outbox.find((o: { contractId: string }) => o.contractId === contractCaseId);
  assert.ok(entry);

  // Apply a carrier compliance hold
  await owner(async (c) => {
    await c.query(
      `INSERT INTO carrier_compliance_holds (tenant_id, node_id, contract_id, reason, created_by)
       VALUES ($1, $2, $3, 'Pending annual E&O audit verification', (SELECT id FROM app_users WHERE email = $4))`,
      [co.tenantId, agencyNodeId, contractCaseId, COMPLIANCE]
    );
  });

  // Attempting to retry while hold is active fails revalidation
  const retryRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-outbox/${entry.id}/retry`);
  assert.equal(retryRes.status, 200);
  assert.equal(retryRes.json.dispatched, false);
  assert.ok(
    retryRes.json.reason.includes('compliance hold') || retryRes.json.reason.includes('Compliance hold active'),
    `Expected hold error but got: ${retryRes.json.reason}`
  );

  // Release the compliance hold
  await owner(async (c) => {
    await c.query(
      `UPDATE carrier_compliance_holds
          SET released_at = now(),
              released_by = (SELECT id FROM app_users WHERE email = $1),
              release_reason = 'Verified active insurance'
        WHERE contract_id = $2`,
      [COMPLIANCE, contractCaseId]
    );
  });
});

test('carrier workflow: appointment verification fails closed when licence or E&O missing', async () => {
  // Transition contract to approved via record-response
  const resp = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${contractCaseId}/record-response`, {
    responseStatus: 'carrier_approved',
    reference: 'IA-2026-APP-8841',
  });
  assert.equal(resp.status, 200);
  assert.equal(resp.json.state, 'approved');

  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  // Try to verify appointment with activateNow: true, but no licence or E&O exists
  const verifyWithoutCredentials = await call(
    COMPLIANCE,
    'POST',
    `/v1/compliance/carrier-contracts/${contractCaseId}/verify-appointment`,
    {
      appointmentReference: 'APPT-IA-99201',
      effectiveOn: today,
      expiresOn: nextYear,
      activateNow: true,
    }
  );

  assert.equal(verifyWithoutCredentials.status, 200);
  assert.equal(
    verifyWithoutCredentials.json.state,
    'appointment_verified',
    'State must remain appointment_verified, NOT active'
  );
  assert.equal(verifyWithoutCredentials.json.activated, false);
  assert.ok(verifyWithoutCredentials.json.blocks?.includes('licence_invalid'));
  assert.ok(verifyWithoutCredentials.json.blocks?.includes('eo_invalid'));
});

test('carrier workflow: appointment verification activates when all credentials and gates satisfied', async () => {
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  // Add valid Ontario licence and valid E&O items
  await owner(async (c) => {
    await c.query(
      `INSERT INTO compliance_items (tenant_id, node_id, kind, label, jurisdiction, expires_on)
       VALUES ($1, $2, 'licence', 'ON Life Insurance Licence', 'ON', $3)`,
      [co.tenantId, agencyNodeId, nextYear]
    );
    await c.query(
      `INSERT INTO compliance_items (tenant_id, node_id, kind, label, jurisdiction, expires_on)
       VALUES ($1, $2, 'eo', 'Provincial E&O Coverage', 'ON', $3)`,
      [co.tenantId, agencyNodeId, nextYear]
    );
  });

  const today = new Date().toISOString().slice(0, 10);

  // Re-run verify appointment with activateNow: true
  const verifyWithCredentials = await call(
    COMPLIANCE,
    'POST',
    `/v1/compliance/carrier-contracts/${contractCaseId}/verify-appointment`,
    {
      appointmentReference: 'APPT-IA-99201',
      effectiveOn: today,
      expiresOn: nextYear,
      activateNow: true,
    }
  );

  assert.equal(verifyWithCredentials.status, 200);
  assert.equal(verifyWithCredentials.json.state, 'active', 'Contract state transitions to active');
  assert.equal(verifyWithCredentials.json.activated, true);
  assert.equal(verifyWithCredentials.json.blocks, undefined);
});
