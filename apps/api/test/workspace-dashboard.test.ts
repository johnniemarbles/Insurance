import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
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

const ADMIN = 'admin@apex.test';
const MGR = 'mgr@apex.test';
const BROKER = 'broker@apex.test';
const COMPLIANCE = 'compliance@apex.test';
const AUDITOR = 'auditor@apex.test';
const TRAINER = 'trainer@apex.test';
const LEARNER = 'learner@apex.test';
const STAFF = 'staff@apex.test';
const MGR_B2 = 'mgr-b2@apex.test';
const T2_ADMIN = 'admin@beacon.test';

let co1TenantId = '';
let co2TenantId = '';
let branch1Id = '';
let branch2Id = '';
let t2BranchId = '';

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
  app = buildApp({
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  } as AppDeps);

  // Tenant 1
  const co1 = await bootstrapTenant(db.ownerUrl, { name: 'Apex Financial', countryCode: 'CA', adminEmail: ADMIN });
  co1TenantId = co1.tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  branch1Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Toronto' })).json.id;
  branch2Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Montreal' })).json.id;

  // Tenant 2
  const co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Financial', countryCode: 'CA', adminEmail: T2_ADMIN });
  co2TenantId = co2.tenantId;
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');
  t2BranchId = (await call(T2_ADMIN, 'POST', '/v1/org/locations', { name: 'Beacon Vancouver' })).json.id;

  // Provision role fixtures in Tenant 1
  await owner(async (c) => {
    const rolesToCreate = [
      { email: MGR, role: 'manager', node: branch1Id },
      { email: BROKER, role: 'partner', node: branch1Id },
      { email: COMPLIANCE, role: 'compliance', node: branch1Id },
      { email: AUDITOR, role: 'auditor', node: branch1Id },
      { email: TRAINER, role: 'trainer', node: branch1Id },
      { email: LEARNER, role: 'learner', node: branch1Id },
      { email: STAFF, role: 'staff', node: branch1Id },
      { email: MGR_B2, role: 'manager', node: branch2Id },
    ];
    for (const item of rolesToCreate) {
      const uRes = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1TenantId, item.email, item.email.split('@')[0], item.node],
      );
      const uid = uRes.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [co1TenantId, uid, item.node, item.role],
      );
    }

  });

  for (const e of [MGR, BROKER, COMPLIANCE, AUDITOR, TRAINER, LEARNER, STAFF, MGR_B2]) {
    await call(e, 'POST', '/v1/consent/first-login');
  }

  // Create pipeline and sample records via authenticated calls
  const pipe = await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Sales Pipeline', sharedDown: true });
  assert.equal(pipe.status, 201);
  const pid = pipe.json.id;
  const b1 = await call(MGR, 'POST', '/v1/boxes', { pipelineId: pid, name: 'Apex Toronto Client 1', valueAmount: 15000 });
  assert.equal(b1.status, 201, `MGR box creation failed: ${JSON.stringify(b1.json)}`);
  const b2 = await call(MGR_B2, 'POST', '/v1/boxes', { pipelineId: pid, name: 'Apex Montreal Client 2', valueAmount: 25000 });
  assert.equal(b2.status, 201, `MGR_B2 box creation failed: ${JSON.stringify(b2.json)}`);
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map((p) => p.end()));
  if (db) await db.drop();
});

test('unified dashboard: 1. Admin receives full set of typed, permission-scoped cards', async () => {
  const r = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  if (r.status !== 200) console.log('DEBUG R:', r.status, r.raw);
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'admin');
  assert.equal(r.json.tenantId, co1TenantId);
  assert.ok(Array.isArray(r.json.cards));

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.ok(cardModules.includes('crm'), 'admin gets crm card');
  assert.ok(cardModules.includes('compliance'), 'admin gets compliance card');
  assert.ok(cardModules.includes('onboarding'), 'admin gets onboarding card');
  assert.ok(cardModules.includes('carriers'), 'admin gets carriers card');
  assert.ok(cardModules.includes('training'), 'admin gets training card');
  assert.ok(cardModules.includes('learning'), 'admin gets learning card');
  assert.ok(cardModules.includes('audit'), 'admin gets audit card');
  assert.ok(cardModules.includes('notifications'), 'admin gets notifications card');

  // Verify CRM card structure
  const crmCard = r.json.cards.find((c: { module: string }) => c.module === 'crm');
  assert.ok(crmCard.metrics.length > 0);
  assert.equal(crmCard.drilldown.page, 'pipelines');
});

test('unified dashboard: 2. Compliance Officer receives compliance oversight cards without CRM', async () => {
  const r = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'compliance');

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.ok(!cardModules.includes('crm'), 'compliance officer must NOT receive CRM card');
  assert.ok(cardModules.includes('compliance'));
  assert.ok(cardModules.includes('onboarding'));
  assert.ok(cardModules.includes('carriers'));
  assert.ok(cardModules.includes('audit'));
  assert.ok(cardModules.includes('notifications'));
});

test('unified dashboard: 3. Branch Manager receives branch CRM and training, without carrier administration', async () => {
  const r = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=manager');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'manager');

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.ok(cardModules.includes('crm'));
  assert.ok(cardModules.includes('training'));
  assert.ok(cardModules.includes('learning'));
  assert.ok(!cardModules.includes('carriers'), 'manager must not receive carrier administration card');
  assert.ok(!cardModules.includes('audit'), 'manager must not receive audit engagement card');
});

test('unified dashboard: 4. Broker / Partner receives personal CRM, onboarding, and learning', async () => {
  const r = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'partner');

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.ok(cardModules.includes('crm'));
  assert.ok(cardModules.includes('onboarding'));
  assert.ok(cardModules.includes('learning'));
  assert.ok(!cardModules.includes('training'), 'partner must not receive training administration card');
});

test('unified dashboard: 5. Auditor receives audit engagements and notifications only', async () => {
  const r = await call(AUDITOR, 'GET', '/v1/workspace/dashboard?perspective=auditor');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'auditor');

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.ok(cardModules.includes('audit'));
  assert.ok(cardModules.includes('notifications'));
  assert.ok(!cardModules.includes('crm'));
  assert.ok(!cardModules.includes('compliance'));
  assert.ok(!cardModules.includes('carriers'));
});

test('unified dashboard: 6. Learner receives personal coursework and notifications only', async () => {
  const r = await call(LEARNER, 'GET', '/v1/workspace/dashboard?perspective=learner');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'learner');

  const cardModules = r.json.cards.map((c: { module: string }) => c.module);
  assert.deepEqual(cardModules, ['learning', 'notifications']);
});

test('unified dashboard: 7. Sibling branch isolation between Branch 1 and Branch 2 CRM cards', async () => {
  const b1 = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=manager');
  const b2 = await call(MGR_B2, 'GET', '/v1/workspace/dashboard?perspective=manager');

  const b1Crm = b1.json.cards.find((c: { module: string }) => c.module === 'crm');
  const b2Crm = b2.json.cards.find((c: { module: string }) => c.module === 'crm');

  // Branch 1 sees only Branch 1 box ($15,000)
  assert.equal(b1Crm.metrics.find((m: { id: string }) => m.id === 'open').value, 1);
  assert.equal(b1Crm.items[0].title, 'Apex Toronto Client 1');

  // Branch 2 sees only Branch 2 box ($25,000)
  assert.equal(b2Crm.metrics.find((m: { id: string }) => m.id === 'open').value, 1);
  assert.equal(b2Crm.items[0].title, 'Apex Montreal Client 2');
});

test('unified dashboard: 8. Multi-tenant isolation between Apex Financial and Beacon Financial', async () => {
  const t1 = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  const t2 = await call(T2_ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');

  assert.equal(t1.json.tenantId, co1TenantId);
  assert.equal(t2.json.tenantId, co2TenantId);

  // Tenant 2 has 0 boxes in fresh tenant
  const t2Crm = t2.json.cards.find((c: { module: string }) => c.module === 'crm');
  assert.equal(t2Crm.metrics.find((m: { id: string }) => m.id === 'open').value, 0);
  assert.equal(t2Crm.status, 'empty');
});

test('unified dashboard: 9. Tampering protection: non-admin requesting admin perspective is rejected (403)', async () => {
  const r1 = await call(LEARNER, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(r1.status, 403);

  const r2 = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(r2.status, 403);

  const r3 = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=auditor');
  assert.equal(r3.status, 403);
});

test('unified dashboard: 10. Default perspective resolution matches highest authorized role', async () => {
  const rAdmin = await call(ADMIN, 'GET', '/v1/workspace/dashboard');
  assert.equal(rAdmin.json.perspective, 'admin');

  const rCompliance = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard');
  assert.equal(rCompliance.json.perspective, 'compliance');

  const rMgr = await call(MGR, 'GET', '/v1/workspace/dashboard');
  assert.equal(rMgr.json.perspective, 'manager');

  const rLearner = await call(LEARNER, 'GET', '/v1/workspace/dashboard');
  assert.equal(rLearner.json.perspective, 'learner');
});
