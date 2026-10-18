import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;

const ADMIN = 'admin@apex-e2e.test';
const HO = 'ho@apex-e2e.test';
const MGR = 'manager@apex-e2e.test';
const BROKER = 'broker@apex-e2e.test';
const COMPLIANCE = 'compliance@apex-e2e.test';
const AUDITOR = 'auditor@apex-e2e.test';
const TRAINER = 'trainer@apex-e2e.test';
const LEARNER = 'learner@apex-e2e.test';
const STAFF = 'staff@apex-e2e.test';
const MGR_B2 = 'manager-b2@apex-e2e.test';
const T2_ADMIN = 'admin@beacon-e2e.test';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let co1TenantId = '';
let co2TenantId = '';
let branch1Id = '';
let branch2Id = '';
let brokerNodeId = '';
let pipelineId = '';
let caseId = '';
let receiptId = '';

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
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

function computeSignature(secret: string, timestamp: number, eventId: string, body: string): string {
  const canonical = `${timestamp}.${eventId}.${body}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
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

  // 1. Tenant 1 Setup (Apex Financial)
  const co1 = await bootstrapTenant(db.ownerUrl, { name: 'Apex Financial E2E', countryCode: 'CA', adminEmail: ADMIN });
  co1TenantId = co1.tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  branch1Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto Branch' })).json.id;
  branch2Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Montreal Branch' })).json.id;

  // Create broker partner agency under branch 1
  brokerNodeId = await addBrokerFixture(call, db.ownerUrl, branch1Id, 'Downtown Brokerage Inc.');

  // 2. Tenant 2 Setup (Beacon Financial)
  const co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Financial E2E', countryCode: 'CA', adminEmail: T2_ADMIN });
  co2TenantId = co2.tenantId;
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');

  // 3. Provision Role Users for Tenant 1
  await owner(async c => {
    await c.query('UPDATE tenants SET is_head_office = true WHERE id = $1', [co1TenantId]);

    const roles = [
      { email: HO, role: 'admin', node: co1.rootNodeId },
      { email: MGR, role: 'manager', node: branch1Id },
      { email: BROKER, role: 'partner', node: brokerNodeId },
      { email: COMPLIANCE, role: 'compliance', node: branch1Id },
      { email: AUDITOR, role: 'auditor', node: branch1Id },
      { email: TRAINER, role: 'trainer', node: branch1Id },
      { email: LEARNER, role: 'learner', node: brokerNodeId },
      { email: STAFF, role: 'staff', node: branch1Id },
      { email: MGR_B2, role: 'manager', node: branch2Id },
    ];
    for (const item of roles) {
      const uRes = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1TenantId, item.email, item.email.split('@')[0], item.node]
      );
      const uid = uRes.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [co1TenantId, uid, item.node, item.role]
      );
    }

    // Set carrier webhook secret scoped to tenant and carrier
    const co1IaEnvKey = `CARRIER_WEBHOOK_SECRET_${co1TenantId.replace(/-/g, '_').toUpperCase()}_IA_FINANCIAL_GROUP_PRIMARY`;
    process.env[co1IaEnvKey] = TEST_SECRET;

  });

  for (const e of [HO, MGR, BROKER, COMPLIANCE, AUDITOR, TRAINER, LEARNER, STAFF, MGR_B2]) {
    await call(e, 'POST', '/v1/consent/first-login');
  }

  const pipe = await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life & Living Benefits', sharedDown: true });
  pipelineId = pipe.json.id;
});

after(async () => {
  const co1IaEnvKey = `CARRIER_WEBHOOK_SECRET_${co1TenantId.replace(/-/g, '_').toUpperCase()}_IA_FINANCIAL_GROUP_PRIMARY`;
  delete process.env[co1IaEnvKey];
  delete process.env[`CARRIER_WEBHOOK_SECRET_${co1TenantId.replace(/-/g, '_').toUpperCase()}_IA_FINANCIAL_GROUP`];
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map(p => p.end()));
  if (db) await db.drop();
});

// ---------------------------------------------------------------------------
// P0 Audit 1: Role Perspectives & Unified Workspace Discovery (9 Roles)
// ---------------------------------------------------------------------------

test('P0 Audit: All 9 user roles receive authorized workspace perspective and card targets', async () => {
  // 1. Executive / Admin
  const adminWs = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(adminWs.status, 200);
  assert.equal(adminWs.json.perspective, 'admin');
  assert.equal(adminWs.json.cards.length, 8);
  for (const card of adminWs.json.cards) {
    assert.ok(card.drilldown.page, `Card ${card.id} must define a valid drilldown page`);
  }

  // 2. Head Office
  const hoWs = await call(HO, 'GET', '/v1/workspace/dashboard?perspective=ho');
  assert.equal(hoWs.status, 200);
  assert.equal(hoWs.json.perspective, 'ho');
  assert.equal(hoWs.json.cards.length, 7);

  // 3. Branch Manager
  const mgrWs = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=manager');
  assert.equal(mgrWs.status, 200);
  assert.equal(mgrWs.json.perspective, 'manager');
  assert.deepEqual(mgrWs.json.cards.map((c: any) => c.module).sort(), ['crm', 'learning', 'notifications', 'onboarding', 'training'].sort());

  // 4. Broker / Partner
  const brokerWs = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(brokerWs.status, 200);
  assert.equal(brokerWs.json.perspective, 'partner');
  assert.deepEqual(brokerWs.json.cards.map((c: any) => c.module).sort(), ['carriers', 'crm', 'learning', 'notifications', 'onboarding'].sort());
  const brokerCarrierCard = brokerWs.json.cards.find((c: any) => c.module === 'carriers');
  assert.equal(brokerCarrierCard.drilldown.page, 'compliance');
  assert.equal(brokerCarrierCard.drilldown.routeId, 'carriers');

  // 5. Compliance Officer
  const compWs = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(compWs.status, 200);
  assert.equal(compWs.json.perspective, 'compliance');
  assert.deepEqual(compWs.json.cards.map((c: any) => c.module).sort(), ['audit', 'carriers', 'compliance', 'notifications', 'onboarding'].sort());

  // 6. Auditor (Read-Only)
  const auditWs = await call(AUDITOR, 'GET', '/v1/workspace/dashboard?perspective=auditor');
  assert.equal(auditWs.status, 200);
  assert.equal(auditWs.json.perspective, 'auditor');
  assert.deepEqual(auditWs.json.cards.map((c: any) => c.module).sort(), ['audit', 'notifications'].sort());

  // 7. Trainer
  const trainerWs = await call(TRAINER, 'GET', '/v1/workspace/dashboard?perspective=trainer');
  assert.equal(trainerWs.status, 200);
  assert.equal(trainerWs.json.perspective, 'trainer');
  assert.deepEqual(trainerWs.json.cards.map((c: any) => c.module).sort(), ['learning', 'notifications', 'training'].sort());

  // 8. Learner
  const learnerWs = await call(LEARNER, 'GET', '/v1/workspace/dashboard?perspective=learner');
  assert.equal(learnerWs.status, 200);
  assert.equal(learnerWs.json.perspective, 'learner');
  assert.deepEqual(learnerWs.json.cards.map((c: any) => c.module).sort(), ['learning', 'notifications'].sort());

  // 9. Operations Staff
  const staffWs = await call(STAFF, 'GET', '/v1/workspace/dashboard?perspective=staff');
  assert.equal(staffWs.status, 200);
  assert.equal(staffWs.json.perspective, 'staff');
  assert.deepEqual(staffWs.json.cards.map((c: any) => c.module).sort(), ['crm', 'learning', 'notifications'].sort());
});

// ---------------------------------------------------------------------------
// P0 Audit 2: Role Access Boundaries & Sibling Branch Isolation
// ---------------------------------------------------------------------------

test('P0 Audit: Sibling branch and auditor role boundaries are strictly enforced', async () => {
  // Auditor cannot perform mutating carrier packet preparation or submission
  const auditPrep = await call(AUDITOR, 'POST', '/v1/compliance/carrier-contracts/00000000-0000-0000-0000-000000000001/prepare-packet', {});
  assert.equal(auditPrep.status, 403, 'Auditor must be forbidden from carrier packet preparation');

  // Branch 2 Manager cannot access Branch 1 boxes
  const mgr2Boxes = await call(MGR_B2, 'GET', `/v1/boxes?pipelineId=${pipelineId}`);
  assert.equal(mgr2Boxes.status, 200);
  assert.equal(mgr2Boxes.json.boxes.length, 0, 'Branch 2 manager must not see records from Branch 1');

  // Tenant 2 Admin cannot access Tenant 1 pipeline
  const t2Pipe = await call(T2_ADMIN, 'GET', `/v1/pipelines/${pipelineId}`);
  assert.equal(t2Pipe.status, 404, 'Cross-tenant pipeline access must return 404 not found');

  const t2Boxes = await call(T2_ADMIN, 'GET', `/v1/boxes?pipelineId=${pipelineId}`);
  assert.equal(t2Boxes.json.boxes.length, 0, 'Cross-tenant boxes query must return 0 boxes');
});

// ---------------------------------------------------------------------------
// P1 Workflow: Complete Insurance Lifecycle
// ---------------------------------------------------------------------------

test('P1 Lifecycle: Complete Carrier Contracting, E-Signature, Outbox, Quarantined Webhook & Reconciliation', async () => {
  // Step 1: Initiate Carrier Contract Case for Broker in Ontario
  const onbId = await caseOfBroker(db.ownerUrl, brokerNodeId);
  await owner(async c => {
    const caseRes = await c.query(
      `INSERT INTO carrier_contract_cases (tenant_id, onboarding_case_id, node_id, carrier_id, carrier_name, jurisdiction, state, created_by)
       VALUES ($1, $2, $3, 'ia-financial-group', 'iA Financial Group', 'ON', 'requested', (SELECT id FROM app_users WHERE email = $4)) RETURNING id`,
      [co1TenantId, onbId, brokerNodeId, COMPLIANCE]
    );
    caseId = caseRes.rows[0].id;
  });

  // Step 2: Compliance Officer views contracting dashboard
  const compDash = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-dashboard');
  assert.equal(compDash.status, 200);
  assert.ok(compDash.json.cases.some((c: any) => c.id === caseId), 'Compliance officer must see carrier contracting case');

  // Broker is denied direct access to compliance carrier dashboard with 403
  const brokerDash = await call(BROKER, 'GET', '/v1/compliance/carrier-dashboard');
  assert.equal(brokerDash.status, 403, 'Broker is denied direct compliance carrier-dashboard with 403');

  // Broker views their contracting status through authorized workspace card
  const brokerWs = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(brokerWs.status, 200);
  const brokerCarriers = brokerWs.json.cards.find((c: any) => c.module === 'carriers');
  assert.ok(brokerCarriers.items.some((c: any) => c.id === caseId), 'Broker sees case in authorized workspace card');

  // Step 3: Broker uploads valid licence document
  const docHash = 'a'.repeat(64);
  const uploadRes = await call(BROKER, 'POST', `/v1/compliance/carrier-contracts/${caseId}/documents`, {
    documentType: 'licence',
    title: 'Ontario Life & Accident Licence',
    fileName: 'on_life_licence.pdf',
    contentHash: docHash,
    fileSizeBytes: 2048,
    mimeType: 'application/pdf',
    notes: 'Uploaded by broker for iA contracting',
  });
  assert.equal(uploadRes.status, 201);
  assert.ok(uploadRes.json.id, 'Document ID must be returned');

  // Step 4: Compliance Officer prepares contracting packet
  const prepRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/prepare-packet`, {
    templateVersion: 'v2026.1-ia-on',
  });
  assert.equal(prepRes.status, 200);
  assert.equal(prepRes.json.state, 'documents_prepared');

  // Step 5: Record Broker E-Signature with explicit broker consent
  const signRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/sign-packet`, {
    consentRecorded: true,
    signerName: 'Jane Smith, Licensed Agent',
  });
  assert.equal(signRes.status, 200);
  assert.equal(signRes.json.state, 'broker_signed');

  // Step 6: Compliance submits signed packet and inspects carrier outbox
  const submitRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/submit-package`, {
    mode: 'manual',
  });
  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.json.status, 'submitted');

  // Verify carrier_dispatch_outbox has idempotent entry
  await owner(async c => {
    const outboxRow = (
      await c.query(`SELECT * FROM carrier_dispatch_outbox WHERE contract_id = $1 AND tenant_id = $2`, [caseId, co1TenantId])
    ).rows[0];
    assert.ok(outboxRow, 'Outbox row must be enqueued');
    assert.equal(outboxRow.carrier_id, 'ia-financial-group');
    assert.equal(outboxRow.jurisdiction, 'ON');
    assert.ok(outboxRow.evidence_reference.startsWith('sha256:'));
  });

  // Step 7: Authorized Carrier Webhook arrives, passes HMAC validation, and is quarantined
  const timestamp = Date.now();
  const eventId = `ia-evt-${Date.now()}`;
  const webhookBody = JSON.stringify({
    tenantId: co1TenantId,
    eventId,
    timestamp,
    carrierId: 'ia-financial-group',
    contractId: caseId,
    eventType: 'appointment.confirmed',
    appointmentReference: 'IA-APPT-ON-889922',
    effectiveDate: '2026-02-01',
    expiryDate: '2027-02-01',
  });
  const sig = computeSignature(TEST_SECRET, timestamp, eventId, webhookBody);

  const webhookRes = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': co1TenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': sig,
    },
    payload: webhookBody,
  });

  assert.equal(webhookRes.statusCode, 201);
  const webhookJson = JSON.parse(webhookRes.body);
  assert.equal(webhookJson.status, 'quarantined');
  receiptId = webhookJson.id;
  assert.ok(receiptId, 'Receipt ID must be returned');

  // Step 8: Compliance reviews quarantined webhook receipt
  const reviewReceiptRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-webhook-receipts/${receiptId}/review`, {
    decision: 'reviewed',
    contractId: caseId,
    notes: 'Authoritative appointment confirmation verified with carrier liaison',
  });
  assert.equal(reviewReceiptRes.status, 200);
  assert.equal(reviewReceiptRes.json.status, 'reviewed');

  // Step 9: Compliance records carrier response (approved)
  const respRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/record-response`, {
    responseStatus: 'carrier_approved',
    reference: 'IA-RESP-REF-0012',
    notes: 'Formal approval received from carrier contracting desk',
  });
  assert.equal(respRes.status, 200);
  assert.equal(respRes.json.state, 'approved');

  // Step 10: Compliance verifies appointment dates
  const verifyRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/verify-appointment`, {
    appointmentReference: 'IA-APPT-ON-889922',
    effectiveOn: '2026-02-01',
    expiresOn: '2027-02-01',
  });
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.json.state, 'appointment_verified');

  // Step 11: Compliance reconciles appointment linking the verified webhook receipt
  const reconcileRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-contracts/${caseId}/reconcile-appointment`, {
    appointmentReference: 'IA-APPT-ON-889922',
    verifiedWithCarrierOn: '2026-02-02',
    receiptId,
    notes: 'Reconciled against verified webhook receipt',
  });
  assert.equal(reconcileRes.status, 200);
  assert.equal(reconcileRes.json.reconciled, true);

  // Step 12: Broker creates CRM box in pipeline
  const boxRes = await call(BROKER, 'POST', '/v1/boxes', {
    pipelineId,
    name: 'Estate Term Policy — Smith Family',
    valueAmount: 150000,
  });
  assert.equal(boxRes.status, 201);

  // Step 13: Final Workspace verification
  const finalBrokerWs = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(finalBrokerWs.status, 200);
  const carrierCard = finalBrokerWs.json.cards.find((c: any) => c.module === 'carriers');
  assert.ok(carrierCard);
  assert.equal(carrierCard.metrics.find((m: any) => m.id === 'total')?.value, 1);
});
