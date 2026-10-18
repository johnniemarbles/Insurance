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

let co1: { tenantId: string; rootNodeId: string };
let co2: { tenantId: string; rootNodeId: string };
let ho: { tenantId: string; rootNodeId: string };

type M = 'GET' | 'POST' | 'PUT' | 'DELETE';
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

async function seedUser(tenantId: string, email: string, home: string, role: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}

const ADMIN1 = 'admin@co1.test';
const OFFICER1 = 'compliance-loc1@co1.test';
const BROKER1 = 'broker1@co1.test';
const BROKER2 = 'broker2@co1.test';
const ADMIN2 = 'admin@co2.test';
const HO_ADMIN = 'admin@ho.test';
const HO_OFFICER = 'compliance@ho.test';

let loc1 = '';
let loc2 = '';
let brokerNode1 = '';
let brokerNode2 = '';

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
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);

  // Tenant 1 (Maple Insurance)
  co1 = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN1 });
  await call(ADMIN1, 'POST', '/v1/consent/first-login');

  loc1 = (await call(ADMIN1, 'POST', '/v1/org/locations', { name: 'Toronto Branch' })).json.id;
  loc2 = (await call(ADMIN1, 'POST', '/v1/org/locations', { name: 'Vancouver Branch' })).json.id;

  brokerNode1 = await addBrokerFixture(call, db.ownerUrl, loc1, 'Alpha Financial Services');
  brokerNode2 = await addBrokerFixture(call, db.ownerUrl, loc2, 'Pacific Wealth Advisors');

  await seedUser(co1.tenantId, OFFICER1, loc1, 'compliance');
  await seedUser(co1.tenantId, BROKER1, brokerNode1, 'partner');
  await seedUser(co1.tenantId, BROKER2, brokerNode2, 'partner');

  // Tenant 2 (Pine Insurance)
  co2 = await bootstrapTenant(db.ownerUrl, { name: 'Pine Insurance', countryCode: 'CA', adminEmail: ADMIN2 });
  await call(ADMIN2, 'POST', '/v1/consent/first-login');

  // Head Office Tenant
  ho = await bootstrapTenant(db.ownerUrl, { name: 'Head Office CA', countryCode: 'CA', adminEmail: HO_ADMIN, headOffice: true });
  await call(HO_ADMIN, 'POST', '/v1/consent/first-login');
  await seedUser(ho.tenantId, HO_OFFICER, ho.rootNodeId, 'compliance');
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map((p) => p.end()));
  if (db) await db.drop();
});

test('partner directory: 1. Admin receives all company partners with status and checklist steps', async () => {
  const r = await call(ADMIN1, 'GET', '/v1/compliance/partners');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.partners), 'partners must be an array');
  assert.ok(r.json.partners.length >= 2, 'should see at least 2 seeded brokers');

  const alpha = r.json.partners.find((p: any) => p.id === brokerNode1);
  assert.ok(alpha, 'Alpha Financial Services must be returned');
  assert.equal(alpha.name, 'Alpha Financial Services');
  assert.ok(alpha.status, 'status must be defined');
  assert.ok(Array.isArray(alpha.checklist?.steps), 'checklist.steps must be an array');
  assert.equal(typeof alpha.licences, 'number');
  assert.equal(typeof alpha.eoCount, 'number');
});

test('partner directory: 2. Branch compliance officer sees partners in branch, isolated from sibling branches', async () => {
  const r = await call(OFFICER1, 'GET', '/v1/compliance/partners');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.partners));

  // Should see Alpha Financial Services under loc1
  assert.ok(r.json.partners.some((p: any) => p.id === brokerNode1));
  // Must NOT see Pacific Wealth Advisors under loc2 (sibling branch)
  assert.ok(!r.json.partners.some((p: any) => p.id === brokerNode2));
});

test('partner directory: 3. /v1/ho/partners returns national directory to Head Office', async () => {
  const r = await call(HO_OFFICER, 'GET', '/v1/ho/partners');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.partners));
  assert.ok(r.json.partners.some((p: any) => p.nodeId === brokerNode1));
  assert.ok(r.json.partners.some((p: any) => p.nodeId === brokerNode2));

  // Non-Head Office user cannot access /v1/ho/partners
  const denied = await call(OFFICER1, 'GET', '/v1/ho/partners');
  assert.equal(denied.status, 403);
});

test('partner directory: 4. Multi-tenant isolation: Tenant A cannot see Tenant B partners in directory', async () => {
  const r1 = await call(ADMIN1, 'GET', '/v1/compliance/partners');
  assert.equal(r1.status, 200);

  const r2 = await call(ADMIN2, 'GET', '/v1/compliance/partners');
  assert.equal(r2.status, 200);

  // Tenant 2 has no partners yet, so none of Tenant 1's partners should appear
  assert.ok(!r2.json.partners.some((p: any) => p.id === brokerNode1));
  assert.ok(!r2.json.partners.some((p: any) => p.id === brokerNode2));
});

test('partner directory: 5. Branch presence /v1/partners/branch returns presence data', async () => {
  const r = await call(BROKER1, 'GET', '/v1/partners/branch');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.members), 'branch members must be returned as array');
});

test('partner profile 360: 6. Admin retrieves complete partner 360 detail file', async () => {
  const r = await call(ADMIN1, 'GET', `/v1/compliance/partners/${brokerNode1}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.node?.id, brokerNode1);
  assert.equal(r.json.node?.name, 'Alpha Financial Services');
  assert.equal(r.json.country, 'CA');
  assert.ok(r.json.checklist, 'checklist must be present');
  assert.ok(Array.isArray(r.json.items), 'items must be an array');
  assert.ok(Array.isArray(r.json.documents), 'documents must be an array');
  assert.ok(Array.isArray(r.json.appointments), 'appointments must be an array');
});

test('partner profile 360: 7. Branch compliance officer retrieves partner in own branch', async () => {
  const r = await call(OFFICER1, 'GET', `/v1/compliance/partners/${brokerNode1}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.node?.id, brokerNode1);
});

test('partner profile 360: 8. Branch compliance officer cannot access partner in sibling branch (404)', async () => {
  const r = await call(OFFICER1, 'GET', `/v1/compliance/partners/${brokerNode2}`);
  assert.equal(r.status, 404);
});

test('partner profile 360: 9. Multi-tenant isolation: Tenant 2 cannot access Tenant 1 partner profile (404)', async () => {
  const r = await call(ADMIN2, 'GET', `/v1/compliance/partners/${brokerNode1}`);
  assert.equal(r.status, 404);
});

test('partner profile 360: 10. Head Office compliance officer retrieves partner 360 file via /v1/ho/partners/:id', async () => {
  const r = await call(HO_OFFICER, 'GET', `/v1/ho/partners/${brokerNode1}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.node?.id, brokerNode1);
  assert.ok(r.json.company, 'company name must be provided in HO view');
  assert.ok(Array.isArray(r.json.appointments));
});

test('carrier operations: 11. Admin and branch officer can access carrier dashboard', async () => {
  const rAdmin = await call(ADMIN1, 'GET', '/v1/compliance/carrier-dashboard');
  assert.equal(rAdmin.status, 200);
  assert.ok(Array.isArray(rAdmin.json.directory));
  assert.ok(Array.isArray(rAdmin.json.cases));
  assert.ok(Array.isArray(rAdmin.json.submissions));
  assert.ok(Array.isArray(rAdmin.json.auditEvents));

  const rOfficer = await call(OFFICER1, 'GET', '/v1/compliance/carrier-dashboard');
  assert.equal(rOfficer.status, 200);
  assert.ok(Array.isArray(rOfficer.json.cases));
});

test('carrier operations: 12. Non-compliance user (broker) is denied carrier dashboard with 403', async () => {
  const rBroker = await call(BROKER1, 'GET', '/v1/compliance/carrier-dashboard');
  assert.equal(rBroker.status, 403);
});


