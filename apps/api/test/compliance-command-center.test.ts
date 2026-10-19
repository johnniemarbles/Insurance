// Integration & security tests for the Compliance Command Center endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string };

type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  let json: any = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* html */
  }
  return { status: res.statusCode, json };
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

async function seedUser(tenantId: string, email: string, home: string, role: string) {
  await owner(async (o) => {
    const u = (
      await o.query(
        `INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [tenantId, email, home],
      )
    ).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [
      tenantId,
      u,
      home,
      role,
    ]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}

const ADMIN = 'admin@ccc.test';
const COMPLIANCE = 'officer@ccc.test';
const PARTNER = 'partner@ccc.test';
let locId = '';
let brokerId = '';
let pipelineId = '';
let boxId = '';
let sBoundId = '';

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

  co = await bootstrapTenant(db.ownerUrl, { name: 'Command Center Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  locId = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Montreal Branch' })).json.id;
  brokerId = await addBrokerFixture(call, db.ownerUrl, locId, 'Alpha Brokerage');

  await seedUser(co.tenantId, COMPLIANCE, locId, 'compliance');
  await seedUser(co.tenantId, PARTNER, brokerId, 'partner');

  pipelineId = (
    await call(ADMIN, 'POST', '/v1/pipelines', {
      name: 'Commercial',
      sharedDown: true,
      stages: [{ name: 'Intake' }, { name: 'Bound', isWon: true }],
    })
  ).json.id;

  const pipe = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipelineId);
  sBoundId = pipe.stages.find((s: any) => s.name === 'Bound').id;

  boxId = (await call(PARTNER, 'POST', '/v1/boxes', { pipelineId, name: 'Acme Corp File' })).json.id;
});

after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

test('command center: all 8 sources respond with valid status and shape for compliance officer', async () => {
  const overview = await call(COMPLIANCE, 'GET', '/v1/compliance/overview');
  assert.equal(overview.status, 200);
  assert.equal(typeof overview.json.expired, 'number');
  assert.equal(typeof overview.json.expiring90, 'number');
  assert.equal(typeof overview.json.openScreeningHits, 'number');
  assert.equal(typeof overview.json.cashReportsDue, 'number');
  assert.equal(typeof overview.json.openHolds, 'number');

  const clearance = await call(COMPLIANCE, 'GET', '/v1/compliance/clearance');
  assert.equal(clearance.status, 200);
  assert.ok(Array.isArray(clearance.json.notCleared));

  const risk = await call(COMPLIANCE, 'GET', '/v1/compliance/files-at-risk');
  assert.equal(risk.status, 200);
  assert.ok(Array.isArray(risk.json.files));
  assert.ok(Array.isArray(risk.json.aml));

  const onboarding = await call(COMPLIANCE, 'GET', '/v1/onboarding/dashboard');
  assert.equal(onboarding.status, 200);

  const carriers = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(carriers.status, 200);

  const retention = await call(COMPLIANCE, 'GET', '/v1/compliance/retention');
  assert.equal(retention.status, 200);
  assert.ok(retention.json.summary);
  assert.ok(Array.isArray(retention.json.holds));

  const audit = await call(COMPLIANCE, 'GET', '/v1/audit/engagements');
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray(audit.json.engagements));

  const notifications = await call(COMPLIANCE, 'GET', '/v1/notifications');
  assert.equal(notifications.status, 200);
  assert.ok(Array.isArray(notifications.json.notifications));
});

test('security & RLS: partner role cannot access privileged retention endpoints or manage audits', async () => {
  // A partner cannot read retention dashboard
  const retention = await call(PARTNER, 'GET', '/v1/compliance/retention');
  assert.equal(retention.status, 403, 'partner cannot read retention dashboard');

  // A partner cannot invite an external auditor
  const auditInvite = await call(PARTNER, 'POST', '/v1/audit/engagements', {
    title: 'Unauthorized Audit',
    email: 'auditor@external.test',
    deputedBy: 'regulator',
    scope: ['policies'],
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
  });
  assert.equal(auditInvite.status, 403, 'partner cannot create auditor engagement');
});

test('truthful AML aggregation: screening hits and cash transactions surface in overview and risk aml list', async () => {
  // Add a screening hit to boxId
  await call(PARTNER, 'POST', `/v1/boxes/${boxId}/screenings`, {
    list: 'pep',
    result: 'hit',
    note: 'Matches foreign PEP watch list',
  });

  // Add a large cash transaction (> $10,000) with past date (> 15 days ago)
  await call(PARTNER, 'POST', `/v1/boxes/${boxId}/cash`, {
    amount: 15000,
    currency: 'CAD',
    occurredOn: '2026-01-01',
  });

  const overview = await call(COMPLIANCE, 'GET', '/v1/compliance/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.json.openScreeningHits >= 1, 'screening hit counted in overview');
  assert.ok(overview.json.cashReportsDue >= 1, 'cash report due counted in overview');

  const risk = await call(COMPLIANCE, 'GET', '/v1/compliance/files-at-risk');
  assert.equal(risk.status, 200);
  const boxAml = risk.json.aml.filter((a: any) => a.boxId === boxId);
  assert.ok(boxAml.some((a: any) => a.issue === 'screening_hit'), 'screening hit in risk aml list');
  const cashItem = boxAml.find((a: any) => a.issue === 'cash_unreported');
  assert.ok(cashItem, 'cash item present in aml list');
  assert.equal(cashItem.overdue, true, 'flagged overdue because > 15 days');
});

test('truthful Retention & Holds aggregation: active legal hold surfaces in retention and overview', async () => {
  // Add client consent so the box has an active lifecycle clock when closed
  await call(PARTNER, 'POST', `/v1/boxes/${boxId}/consents`, {
    kind: 'collection_use',
    method: 'written',
    obtainedAt: '2026-01-01T10:00:00Z',
  });

  // Advance box to won stage (closed client file)
  await call(PARTNER, 'PATCH', `/v1/boxes/${boxId}`, { stageId: sBoundId });

  const holdRes = await call(ADMIN, 'POST', `/v1/boxes/${boxId}/legal-hold`, {
    reason: 'Litigation pending by claimant',
  });
  assert.equal(holdRes.status, 201);

  const retention = await call(COMPLIANCE, 'GET', '/v1/compliance/retention');
  assert.equal(retention.status, 200);
  assert.ok(retention.json.holds.length >= 1, 'hold present in retention list');
  assert.ok(retention.json.summary.held >= 1, 'summary.held counted for closed held file');

  const overview = await call(COMPLIANCE, 'GET', '/v1/compliance/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.json.openHolds >= 1, 'overview.openHolds reflects active hold');
});

test('compliance expiring items: /v1/compliance/expiring returns items for authorized compliance officer', async () => {
  // Add a licence to brokerId
  await call(ADMIN, 'POST', `/v1/compliance/partners/${brokerId}/items`, {
    kind: 'licence',
    label: 'General Agent Licence',
    number: 'ON-123456',
    jurisdiction: 'ON',
    lines: ['life', 'accident_sickness'],
    expiresOn: '2026-11-15',
  });

  const expiring = await call(COMPLIANCE, 'GET', '/v1/compliance/expiring?days=90');
  assert.equal(expiring.status, 200);
  assert.ok(Array.isArray(expiring.json.items), 'items array returned');
  const item = expiring.json.items.find((i: any) => i.nodeId === brokerId);
  assert.ok(item, 'newly added licence found in expiring items');
  assert.equal(item.kind, 'licence');
  assert.equal(typeof item.daysLeft, 'number');
});

test('nodeId format validation: non-uuid nodeId like "cases" is rejected with 400 bad request', async () => {
  const bad = await call(COMPLIANCE, 'GET', '/v1/compliance/partners/cases');
  assert.equal(bad.status, 400);
  assert.ok(bad.json?.error?.message?.includes('must match format "uuid"') || bad.json?.message?.includes('must match format "uuid"'));

  // Valid UUID format that does not exist returns 404
  const nonexistent = await call(COMPLIANCE, 'GET', '/v1/compliance/partners/00000000-0000-0000-0000-000000000000');
  assert.equal(nonexistent.status, 404);
});

