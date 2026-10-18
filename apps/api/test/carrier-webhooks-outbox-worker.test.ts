import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepCarrierOutbox } from '../src/carrier-outbox-worker.ts';
import { addBrokerFixture } from './support/broker.ts';

// ---------------------------------------------------------------------------
// 1. Static Schema & Security Invariants
// ---------------------------------------------------------------------------

test('carrier webhook schema migration: 0135 replay guard and 0136 reconciliation', () => {
  const m135 = readFileSync(
    new URL('../../../packages/db/migrations/0135_carrier_webhook_replay_guard.sql', import.meta.url),
    'utf8'
  );
  assert.match(m135, /CREATE TABLE IF NOT EXISTS carrier_webhook_receipts/);
  assert.match(m135, /ENABLE ROW LEVEL SECURITY/);
  assert.match(m135, /FORCE ROW LEVEL SECURITY/);
  assert.match(m135, /CREATE POLICY tenant_wall ON carrier_webhook_receipts/);
  assert.match(m135, /REVOKE ALL ON carrier_webhook_receipts FROM PUBLIC, app_auth/);
  assert.match(m135, /status text NOT NULL DEFAULT 'quarantined'/);
  assert.match(m135, /UNIQUE \(tenant_id,carrier_id,external_event_id\)/);

  const m136 = readFileSync(
    new URL('../../../packages/db/migrations/0136_carrier_webhook_reconciliation.sql', import.meta.url),
    'utf8'
  );
  assert.match(m136, /ALTER TABLE carrier_webhook_receipts/);
  assert.match(m136, /ADD COLUMN IF NOT EXISTS contract_id/);
  assert.match(m136, /ADD COLUMN IF NOT EXISTS payload jsonb/);
  assert.match(m136, /ADD COLUMN IF NOT EXISTS reviewed_by/);
  assert.match(m136, /GRANT SELECT, INSERT, UPDATE ON carrier_webhook_receipts TO app_runtime/);
});

// ---------------------------------------------------------------------------
// 2. Integration Tests: Inbound Webhooks, Quarantine & Reconciliation
// ---------------------------------------------------------------------------

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;
let co1: { tenantId: string; rootNodeId: string };
let co2: { tenantId: string; rootNodeId: string };

const ADMIN = 'admin@apex-webhook.test';
const COMPLIANCE = 'compliance@apex-webhook.test';
const BROKER = 'broker@apex-webhook.test';
const T2_ADMIN = 'admin@beacon-webhook.test';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

  // Tenant 1
  co1 = await bootstrapTenant(db.ownerUrl, { name: 'Apex Webhook Ops', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  // Tenant 2
  co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Webhook Ops', countryCode: 'CA', adminEmail: T2_ADMIN });
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');

  // Org & Users
  const locId = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Montreal HQ' })).json.id;
  agencyNodeId = await addBrokerFixture(call, db.ownerUrl, locId, 'Apex Financial Montreal');

  await owner(async (c) => {
    // Compliance user
    const cu = (
      await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1.tenantId, COMPLIANCE, 'Apex Compliance Officer', agencyNodeId]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'compliance')`,
      [co1.tenantId, cu, agencyNodeId]
    );

    // Broker user
    const bu = (
      await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1.tenantId, BROKER, 'Apex Montreal Broker', agencyNodeId]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'partner')`,
      [co1.tenantId, bu, agencyNodeId]
    );

    // Onboarding case
    const obRes = await c.query(
      `SELECT id FROM onboarding_cases WHERE tenant_id = $1 AND node_id = $2`,
      [co1.tenantId, agencyNodeId]
    );
    onboardingCaseId = obRes.rows[0].id;
    await c.query(
      `UPDATE onboarding_cases SET stage = 'active', standing = 'good_standing' WHERE id = $1`,
      [onboardingCaseId]
    );

    // Carrier contract case
    const ccRes = await c.query(
      `INSERT INTO carrier_contract_cases (
         tenant_id, onboarding_case_id, node_id, carrier_id, carrier_name, jurisdiction, state,
         template_version, signature_evidence_ref, signature_verified_by, signature_verified_at,
         carrier_approval_ref, carrier_approved_by, carrier_approved_at, created_by
       )
       VALUES (
         $1, $2, $3, 'ia-financial-group', 'iA Financial Group', 'QC', 'approved',
         'v1.0', 'sig-doc-001', $4, now(), 'carrier-appr-001', $4, now(), $4
       ) RETURNING id`,
      [co1.tenantId, onboardingCaseId, agencyNodeId, cu]
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

test('carrier webhooks: rejects unsupported carrier with 404', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/unknown-carrier',
    headers: { 'x-tenant-id': co1.tenantId },
    payload: { eventId: 'evt-001' },
  });
  assert.equal(res.statusCode, 404);
});

test('carrier webhooks: rejects request missing tenant identifier with 422', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    payload: { eventId: 'evt-001' },
  });
  assert.equal(res.statusCode, 422);
});

test('carrier webhooks: rejects invalid HMAC signature or expired timestamp with 401', async () => {
  const now = Date.now();
  const body = { eventType: 'appointment_acknowledged', brokerId: 'brk-100' };
  const bodyStr = JSON.stringify(body);

  // 1. Invalid signature
  const resInvalid = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'x-tenant-id': co1.tenantId,
      'x-carrier-secret': TEST_SECRET,
      'x-carrier-event-id': 'evt-bad-sig',
      'x-carrier-timestamp': String(now),
      'x-carrier-signature': '0000000000000000000000000000000000000000000000000000000000000000',
    },
    payload: body,
  });
  assert.equal(resInvalid.statusCode, 401);

  // 2. Expired timestamp (> 300,000ms old)
  const expiredTime = now - 400_000;
  const expiredSig = computeSignature(TEST_SECRET, expiredTime, 'evt-expired', bodyStr);
  const resExpired = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'x-tenant-id': co1.tenantId,
      'x-carrier-secret': TEST_SECRET,
      'x-carrier-event-id': 'evt-expired',
      'x-carrier-timestamp': String(expiredTime),
      'x-carrier-signature': expiredSig,
    },
    payload: body,
  });
  assert.equal(resExpired.statusCode, 401);
});

let recordedReceiptId = '';

test('carrier webhooks: accepts signed event, quarantines it, and enforces replay protection', async () => {
  const now = Date.now();
  const eventId = 'evt-ia-prod-9988';
  const body = {
    eventType: 'appointment.confirmed',
    reference: 'IA-QC-2026-9988',
    issuedAt: '2026-10-18T10:00:00Z',
    effectiveDate: '2026-10-18',
  };
  const bodyStr = JSON.stringify(body);
  const sig = computeSignature(TEST_SECRET, now, eventId, bodyStr);

  // 1. Initial valid signed submission -> 201 Created and Quarantined
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'x-tenant-id': co1.tenantId,
      'x-carrier-secret': TEST_SECRET,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(now),
      'x-carrier-signature': sig,
    },
    payload: body,
  });

  assert.equal(res1.statusCode, 201);
  const j1 = JSON.parse(res1.body);
  assert.equal(j1.ok, true);
  assert.equal(j1.status, 'quarantined');
  assert.equal(j1.quarantined, true);
  assert.ok(j1.id);
  recordedReceiptId = j1.id;

  // 2. Replay of identical event -> 200 Duplicate (idempotent, does not duplicate)
  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'x-tenant-id': co1.tenantId,
      'x-carrier-secret': TEST_SECRET,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(now),
      'x-carrier-signature': sig,
    },
    payload: body,
  });

  assert.equal(res2.statusCode, 200);
  const j2 = JSON.parse(res2.body);
  assert.equal(j2.ok, true);
  assert.equal(j2.duplicate, true);
  assert.equal(j2.id, recordedReceiptId);
  assert.equal(j2.status, 'quarantined');
});

test('carrier webhooks: compliance console listing and quarantine adjudication', async () => {
  // 1. Regular broker cannot access compliance receipt console
  const forbiddenList = await call(BROKER, 'GET', '/v1/compliance/carrier-webhook-receipts');
  assert.equal(forbiddenList.status, 403);

  // 2. Compliance officer lists quarantined receipts
  const complianceList = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-webhook-receipts?status=quarantined');
  assert.equal(complianceList.status, 200);
  assert.ok(Array.isArray(complianceList.json.receipts));
  const found = complianceList.json.receipts.find((r: any) => r.id === recordedReceiptId);
  assert.ok(found, 'Recorded receipt must appear in compliance quarantine queue');
  assert.equal(found.status, 'quarantined');
  assert.equal(found.carrierId, 'ia-financial-group');

  // 3. Adjudicate quarantine: broker forbidden
  const forbiddenReview = await call(BROKER, 'POST', `/v1/compliance/carrier-webhook-receipts/${recordedReceiptId}/review`, {
    decision: 'reviewed',
  });
  assert.equal(forbiddenReview.status, 403);

  // 4. Compliance officer reviews receipt
  const reviewRes = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-webhook-receipts/${recordedReceiptId}/review`, {
    decision: 'reviewed',
    notes: 'Verified against iA portal dispatch receipt; ready for appointment reconciliation.',
    contractId: contractCaseId,
  });
  assert.equal(reviewRes.status, 200);
  assert.equal(reviewRes.json.status, 'reviewed');
});

test('carrier reconciliation refuses quarantined and cross-carrier evidence', async () => {
  const receiptIds = await owner(async c => {
    const result = await c.query<{ id: string; carrier_id: string }>(
      `INSERT INTO carrier_webhook_receipts
        (tenant_id, carrier_id, external_event_id, payload, payload_digest, status)
       VALUES ($1, 'ia-financial-group', 'test-quarantined-guard', '{}'::jsonb, $2, 'quarantined'),
              ($1, 'manulife', 'test-cross-carrier-guard', '{}'::jsonb, $2, 'reviewed')
       RETURNING id, carrier_id`,
      [co1.tenantId, 'a'.repeat(64)]
    );
    return result.rows;
  });
  const quarantinedId = receiptIds.find(r => r.carrier_id === 'ia-financial-group')!.id;
  const wrongCarrierId = receiptIds.find(r => r.carrier_id === 'manulife')!.id;
  const url = `/v1/compliance/carrier-contracts/${contractCaseId}/reconcile-appointment`;
  for (const receiptId of [quarantinedId, wrongCarrierId]) {
    const res = await call(COMPLIANCE, 'POST', url, {
      appointmentReference: 'IA-QC-2026-9988',
      verifiedWithCarrierOn: '2026-10-18',
      receiptId,
    });
    assert.equal(res.status, 403);
  }
  const crossReview = await call(COMPLIANCE, 'POST',
    `/v1/compliance/carrier-webhook-receipts/${quarantinedId}/review`,
    { decision: 'reviewed', contractId: contractCaseId });
  assert.equal(crossReview.status, 200);
  const repeatReview = await call(COMPLIANCE, 'POST',
    `/v1/compliance/carrier-webhook-receipts/${quarantinedId}/review`,
    { decision: 'rejected' });
  assert.equal(repeatReview.status, 403);
});

test('carrier appointment reconciliation: links external evidence and updates contract', async () => {
  // 1. Broker cannot reconcile appointment
  const forbiddenReconcile = await call(
    BROKER,
    'POST',
    `/v1/compliance/carrier-contracts/${contractCaseId}/reconcile-appointment`,
    {
      appointmentReference: 'IA-QC-2026-9988',
      verifiedWithCarrierOn: '2026-10-18',
    }
  );
  assert.equal(forbiddenReconcile.status, 403);

  // 2. Compliance officer reconciles appointment with receipt reference
  const reconcileRes = await call(
    COMPLIANCE,
    'POST',
    `/v1/compliance/carrier-contracts/${contractCaseId}/reconcile-appointment`,
    {
      appointmentReference: 'IA-QC-2026-9988',
      verifiedWithCarrierOn: '2026-10-18',
      receiptId: recordedReceiptId,
      notes: 'Confirmed by compliance inspection of reviewed carrier webhook event.',
    }
  );

  assert.equal(reconcileRes.status, 200);
  assert.equal(reconcileRes.json.reconciled, true);
  assert.equal(reconcileRes.json.appointmentReference, 'IA-QC-2026-9988');

  // 3. Verify audit trail logged for appointment reconciliation
  const auditRes = await owner(async (c) => {
    return (
      await c.query(
        `SELECT action, entity_type, entity_id, detail
           FROM audit_log
          WHERE tenant_id = $1 AND entity_id = $2 AND action = 'carrier.appointment_reconciled'`,
        [co1.tenantId, contractCaseId]
      )
    ).rows;
  });
  assert.equal(auditRes.length, 1);
  assert.equal(auditRes[0].detail.appointmentReference, 'IA-QC-2026-9988');
});

test('carrier outbox worker: leases row, revalidates fail-closed, handles retries and dead-letter routing', async () => {
  // 1. Insert a queued outbox row for Tenant 1
  const outboxId = await owner(async (c) => {
    return (
      await c.query(
        `INSERT INTO carrier_dispatch_outbox
           (tenant_id, contract_id, carrier_id, operation, jurisdiction, idempotency_key, evidence_reference, payload, status, retry_count, max_retries)
         VALUES ($1, $2, 'ia-financial-group', 'contract_packet', 'QC', 'test-idem-worker-1', 'doc-ref-worker-1', '{}'::jsonb, 'queued', 0, 2)
         RETURNING id`,
        [co1.tenantId, contractCaseId]
      )
    ).rows[0].id;
  });

  // 2. Run sweepCarrierOutbox directly
  const sweep1 = await sweepCarrierOutbox(deps, 10, co1.tenantId);
  assert.equal(sweep1.processed, 1);
  // Fails closed because external carrier dispatch is disabled until production-approved interface is connected
  assert.equal(sweep1.failed, 1);
  assert.equal(sweep1.deadLetter, 0);

  // 3. Verify row was updated with failure and retry_count incremented to 1
  const rowAfter1 = await owner(async (c) => {
    return (
      await c.query(`SELECT status, retry_count, last_error FROM carrier_dispatch_outbox WHERE id = $1`, [outboxId])
    ).rows[0];
  });
  assert.equal(rowAfter1.status, 'failed');
  assert.equal(rowAfter1.retry_count, 1);
  assert.match(rowAfter1.last_error, /Contract must be signed or submitted|Carrier external dispatch disabled/i);

  // 4. Force row to exceed max_retries on next run (simulate backoff expiration and retry_count = 1 with max_retries = 2)
  await owner(async (c) => {
    await c.query(
      `UPDATE carrier_dispatch_outbox
          SET retry_count = 1,
              updated_at = now() - interval '1 minute'
        WHERE id = $1`,
      [outboxId]
    );
  });

  // 5. Sweep again via immediate drain endpoint POST /v1/compliance/carrier-outbox/process-batch
  const batchRes = await call(COMPLIANCE, 'POST', '/v1/compliance/carrier-outbox/process-batch');
  assert.equal(batchRes.status, 200);
  assert.equal(batchRes.json.ok, true);
  assert.equal(batchRes.json.processed, 1);
  assert.equal(batchRes.json.deadLetter, 1);

  // 6. Verify row transitioned to dead_letter
  const rowAfter2 = await owner(async (c) => {
    return (
      await c.query(`SELECT status, retry_count, last_error FROM carrier_dispatch_outbox WHERE id = $1`, [outboxId])
    ).rows[0];
  });
  assert.equal(rowAfter2.status, 'dead_letter');
  assert.equal(rowAfter2.retry_count, 2);
});
