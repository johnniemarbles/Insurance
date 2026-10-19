import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;

let tenantA: { tenantId: string; rootNodeId: string };
let tenantB: { tenantId: string; rootNodeId: string };

const ADMIN_A = 'admin@stress-tenant-a.test';
const ADMIN_B = 'admin@stress-tenant-b.test';

const SECRET_A_PRIMARY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET_A_SECONDARY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const SECRET_B = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const CARRIER = 'ia-financial-group';

function secretKey(tenantId: string, carrierId: string, suffix: 'PRIMARY' | 'SECONDARY') {
  return `CARRIER_WEBHOOK_SECRET_${tenantId.replace(/-/g, '_').toUpperCase()}_${carrierId.replace(/-/g, '_').toUpperCase()}_${suffix}`;
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

function signWebhook(secret: string, timestamp: number, eventId: string, bodyStr: string): string {
  const rawBody = Buffer.from(bodyStr, 'utf8');
  const prefix = Buffer.from(`${timestamp}.${eventId}.`, 'utf8');
  const message = Buffer.concat([prefix, rawBody]);
  return createHmac('sha256', secret).update(message).digest('hex');
}

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 10); // 10 connections for concurrency
  const authPool = createPool(db.authUrl, 4);
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
    keys: localKeyProvider('0123456789abcdef0123456789abcdef'),
  };
  app = buildApp(deps);
  await app.ready();

  // Bootstrap Tenant A & Tenant B
  tenantA = await bootstrapTenant(db.ownerUrl, {
    name: 'Apex Concurrency Carrier Inc',
    countryCode: 'CA',
    adminEmail: ADMIN_A,
  });

  tenantB = await bootstrapTenant(db.ownerUrl, {
    name: 'Beacon Alternative Brokerage',
    countryCode: 'CA',
    adminEmail: ADMIN_B,
  });

  // Set environment secrets
  process.env[secretKey(tenantA.tenantId, CARRIER, 'PRIMARY')] = SECRET_A_PRIMARY;
  process.env[secretKey(tenantA.tenantId, CARRIER, 'SECONDARY')] = SECRET_A_SECONDARY;
  process.env[secretKey(tenantB.tenantId, CARRIER, 'PRIMARY')] = SECRET_B;
});

after(async () => {
  delete process.env[secretKey(tenantA.tenantId, CARRIER, 'PRIMARY')];
  delete process.env[secretKey(tenantA.tenantId, CARRIER, 'SECONDARY')];
  delete process.env[secretKey(tenantB.tenantId, CARRIER, 'PRIMARY')];

  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

test('Webhook Stress: 25 concurrent requests with identical eventId maintain strict idempotency', async () => {
  const timestamp = Date.now();
  const eventId = `evt-concurrent-stress-${randomUUID()}`;
  const payload = {
    eventType: 'policy.status_change',
    policyNumber: 'POL-IA-CONCURRENT-99',
    carrierReference: 'REF-IA-2026-X1',
    status: 'active',
    issuedDate: '2026-10-19',
    details: {
      underwriter: 'iA Financial Service Center',
      riskCategory: 'standard',
    },
  };
  const bodyStr = JSON.stringify(payload);
  const signature = signWebhook(SECRET_A_PRIMARY, timestamp, eventId, bodyStr);

  const CONCURRENCY = 25;
  const dispatchTimes = Array.from({ length: CONCURRENCY });

  // Fire 25 parallel requests simultaneously
  const results = await Promise.all(
    dispatchTimes.map(async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/webhooks/carrier/${CARRIER}`,
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantA.tenantId,
          'x-carrier-event-id': eventId,
          'x-carrier-timestamp': String(timestamp),
          'x-carrier-signature': signature,
        },
        payload: bodyStr,
      });
      return {
        statusCode: res.statusCode,
        json: JSON.parse(res.body),
      };
    })
  );

  // Assert exactly 1 Created (201) and 24 Duplicate (200)
  const created = results.filter((r) => r.statusCode === 201);
  const duplicates = results.filter((r) => r.statusCode === 200);

  assert.equal(created.length, 1, 'Exactly one concurrent request must win the race and receive 201 Created');
  assert.equal(duplicates.length, CONCURRENCY - 1, 'All remaining concurrent requests must receive 200 Duplicate');

  const winner = created[0]!;
  const createdId = winner.json.id;
  assert.ok(createdId, 'Created receipt must have an ID');
  assert.equal(winner.json.quarantined, true);
  assert.equal(winner.json.status, 'quarantined');

  // Assert all duplicate responses reference the same created ID
  for (const dup of duplicates) {
    assert.equal(dup.json.ok, true);
    assert.equal(dup.json.duplicate, true);
    assert.equal(dup.json.id, createdId, 'Duplicate responses must reference identical receipt ID');
    assert.equal(dup.json.status, 'quarantined');
  }

  // Verify PostgreSQL database state: exactly 1 record inserted
  await owner(async (c) => {
    const rows = (
      await c.query(
        `SELECT id, tenant_id, carrier_id, external_event_id, status
           FROM carrier_webhook_receipts
          WHERE tenant_id = $1 AND carrier_id = $2 AND external_event_id = $3`,
        [tenantA.tenantId, CARRIER, eventId]
      )
    ).rows;

    assert.equal(rows.length, 1, 'Database must contain exactly 1 receipt record despite 25 parallel insertions');
    assert.equal(rows[0].id, createdId);
    assert.equal(rows[0].status, 'quarantined');
  });
});

test('Webhook Stress: 10 parallel distinct events followed by concurrent bulk re-delivery', async () => {
  const timestamp = Date.now();
  const COUNT = 10;
  const eventIds = Array.from({ length: COUNT }, (_, i) => `evt-bulk-distinct-${i}-${randomUUID()}`);

  // Phase 1: 10 distinct events in parallel -> all 10 must succeed with 201
  const firstPass = await Promise.all(
    eventIds.map(async (eventId, i) => {
      const payload = { eventType: 'underwriting.requirement_cleared', requirementId: `REQ-${i}` };
      const bodyStr = JSON.stringify(payload);
      const signature = signWebhook(SECRET_A_PRIMARY, timestamp, eventId, bodyStr);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/webhooks/carrier/${CARRIER}`,
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantA.tenantId,
          'x-carrier-event-id': eventId,
          'x-carrier-timestamp': String(timestamp),
          'x-carrier-signature': signature,
        },
        payload: bodyStr,
      });

      return { eventId, statusCode: res.statusCode, json: JSON.parse(res.body) };
    })
  );

  for (const item of firstPass) {
    assert.equal(item.statusCode, 201, `Event ${item.eventId} should be accepted with 201`);
    assert.equal(item.json.quarantined, true);
  }

  const receiptIds = new Map(firstPass.map((item) => [item.eventId, item.json.id]));

  // Phase 2: Simultaneous replay of all 10 events -> all 10 must return 200 Duplicate
  const secondPass = await Promise.all(
    eventIds.map(async (eventId, i) => {
      const payload = { eventType: 'underwriting.requirement_cleared', requirementId: `REQ-${i}` };
      const bodyStr = JSON.stringify(payload);
      const signature = signWebhook(SECRET_A_PRIMARY, timestamp, eventId, bodyStr);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/webhooks/carrier/${CARRIER}`,
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantA.tenantId,
          'x-carrier-event-id': eventId,
          'x-carrier-timestamp': String(timestamp),
          'x-carrier-signature': signature,
        },
        payload: bodyStr,
      });

      return { eventId, statusCode: res.statusCode, json: JSON.parse(res.body) };
    })
  );

  for (const item of secondPass) {
    assert.equal(item.statusCode, 200, `Replayed event ${item.eventId} should return 200 Duplicate`);
    assert.equal(item.json.duplicate, true);
    assert.equal(item.json.id, receiptIds.get(item.eventId));
  }
});

test('Tamper Resistance: 1-byte payload tampering or signature bit-flip is rejected with 401', async () => {
  const timestamp = Date.now();
  const eventId = `evt-tamper-${randomUUID()}`;
  const validPayload = { eventType: 'payment.received', amountCents: 100000 };
  const validBodyStr = JSON.stringify(validPayload);
  const validSig = signWebhook(SECRET_A_PRIMARY, timestamp, eventId, validBodyStr);

  // 1. Single character payload tampering
  const tamperedPayload = { eventType: 'payment.received', amountCents: 900000 };
  const tamperedBodyStr = JSON.stringify(tamperedPayload);

  const resPayloadTamper = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': validSig, // Valid for original, invalid for tampered body
    },
    payload: tamperedBodyStr,
  });

  assert.equal(resPayloadTamper.statusCode, 401, 'Tampered payload must be rejected with 401 Unauthorized');

  // 2. Signature bit-flip / modification
  const corruptedSig =
    validSig.slice(0, 10) +
    (validSig[10] === 'a' ? 'b' : 'a') +
    validSig.slice(11);

  const resSigTamper = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': corruptedSig,
    },
    payload: validBodyStr,
  });

  assert.equal(resSigTamper.statusCode, 401, 'Tampered signature must be rejected with 401 Unauthorized');

  // Verify no records inserted
  await owner(async (c) => {
    const count = (
      await c.query(
        `SELECT COUNT(*) FROM carrier_webhook_receipts WHERE external_event_id = $1`,
        [eventId]
      )
    ).rows[0].count;
    assert.equal(Number(count), 0, 'No receipts should be written for tampered requests');
  });
});

test('Replay Attack & Clock Drift Protection: Skew > 300,000ms is strictly rejected with 401', async () => {
  const now = Date.now();
  const payload = { eventType: 'advisor.appointment_confirmed', code: 'ADV-QC-01' };
  const bodyStr = JSON.stringify(payload);

  // 1. Past replay attack (> 300,000ms in the past)
  const pastTimestamp = now - 400_000;
  const pastEventId = `evt-past-${randomUUID()}`;
  const pastSig = signWebhook(SECRET_A_PRIMARY, pastTimestamp, pastEventId, bodyStr);

  const pastRes = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': pastEventId,
      'x-carrier-timestamp': String(pastTimestamp),
      'x-carrier-signature': pastSig,
    },
    payload: bodyStr,
  });
  assert.equal(pastRes.statusCode, 401, 'Past expired timestamp must be rejected with 401');

  // 2. Future skew attack (> 300,000ms in the future)
  const futureTimestamp = now + 400_000;
  const futureEventId = `evt-future-${randomUUID()}`;
  const futureSig = signWebhook(SECRET_A_PRIMARY, futureTimestamp, futureEventId, bodyStr);

  const futureRes = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': futureEventId,
      'x-carrier-timestamp': String(futureTimestamp),
      'x-carrier-signature': futureSig,
    },
    payload: bodyStr,
  });
  assert.equal(futureRes.statusCode, 401, 'Future skewed timestamp must be rejected with 401');
});

test('Multi-Tenant Secret Isolation & Dual Key Rotation Acceptance', async () => {
  const timestamp = Date.now();
  const bodyStr = JSON.stringify({ eventType: 'test.isolation' });

  // 1. Tenant B secret used with Tenant A header -> rejected with 401
  const crossTenantEventId = `evt-cross-tenant-${randomUUID()}`;
  const crossTenantSig = signWebhook(SECRET_B, timestamp, crossTenantEventId, bodyStr);

  const crossRes = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': crossTenantEventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': crossTenantSig,
    },
    payload: bodyStr,
  });
  assert.equal(crossRes.statusCode, 401, 'Cross-tenant signature verification must fail');

  // 2. Key rotation: Secondary secret is accepted for Tenant A
  const secondaryEventId = `evt-secondary-key-${randomUUID()}`;
  const secondarySig = signWebhook(SECRET_A_SECONDARY, timestamp, secondaryEventId, bodyStr);

  const secRes = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': secondaryEventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': secondarySig,
    },
    payload: bodyStr,
  });
  assert.equal(secRes.statusCode, 201, 'Secondary rotated key must be accepted');
  assert.equal(JSON.parse(secRes.body).ok, true);
});

test('Malformed Body and Protocol Constraints', async () => {
  const timestamp = Date.now();
  const eventId = `evt-malformed-${randomUUID()}`;

  // 1. Invalid JSON body signed correctly as raw bytes
  const badJson = '{ "broken": [ }';
  const badJsonSig = signWebhook(SECRET_A_PRIMARY, timestamp, eventId, badJson);

  const badJsonRes = await app.inject({
    method: 'POST',
    url: `/v1/webhooks/carrier/${CARRIER}`,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': badJsonSig,
    },
    payload: badJson,
  });
  assert.equal(badJsonRes.statusCode, 422, 'Malformed JSON must return 422 Unprocessable/Invalid');

  // 2. Unsupported carrier
  const badCarrierRes = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/unknown-carrier-xyz',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantA.tenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': '0'.repeat(64),
    },
    payload: '{}',
  });
  assert.equal(badCarrierRes.statusCode, 404, 'Unknown carrier must return 404');
});
