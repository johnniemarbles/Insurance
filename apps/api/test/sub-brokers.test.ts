// Sub-brokers (plan v6 section 2 and decision 3; plan v7 section 2 and 3). An Active broker's administrator requests a
// sub-broker. The Compliance Manager of the branch starts its file, so a sub-broker never exists without one. Depth is three
// levels of brokers counted from the branch: broker, sub-broker, sub-sub-broker. Sub-brokers open once the broker is Active.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

const ADMIN = 'admin@sub.test', OFF = 'officer@sub.test', B1_ADMIN = 'b1admin@sub.test', B2_ADMIN = 'b2admin@sub.test', LEARNER = 'learner@sub.test';
let TOR = '', B1 = '', B1_CASE = '', B2 = '', B2_CASE = '';
let S1 = '', S2 = '', S1_CASE = '', S2_CASE = '';
let REQ = '';

async function seed(tenantId: string, email: string, node: string, role: string) {
  return owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [tenantId, email, email.split('@')[0], node])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, node, role]);
    return u;
  });
}
const activate = (node: string) => owner((o) => o.query(`UPDATE onboarding_cases SET stage = 'active' WHERE node_id = $1`, [node]));

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Sub Broker Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  await seed(co.tenantId, OFF, TOR, 'compliance');
  await call(OFF, 'POST', '/v1/consent/first-login');
  B1 = await addBrokerFixture(call, db.ownerUrl, TOR, 'Parent Broker');
  B1_CASE = await caseOfBroker(db.ownerUrl, B1);
  B2 = await addBrokerFixture(call, db.ownerUrl, TOR, 'Still Forming Broker');
  B2_CASE = await caseOfBroker(db.ownerUrl, B2);
  await seed(co.tenantId, B1_ADMIN, B1, 'admin');
  await seed(co.tenantId, B2_ADMIN, B2, 'admin');
  await seed(co.tenantId, LEARNER, B1, 'learner');
  for (const e of [B1_ADMIN, B2_ADMIN, LEARNER]) await call(e, 'POST', '/v1/consent/first-login');
  await activate(B1);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the administrator of an active broker requests a sub-broker; the request waits for compliance', async () => {
  const r = await call(B1_ADMIN, 'POST', `/v1/onboarding/cases/${B1_CASE}/sub-brokers`, { name: 'North Sub Brokers', type: 'individual', adminEmail: 'north@sub.test' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.status, 'requested');
  REQ = r.json.id;
  const found = (await call(OFF, 'GET', '/v1/onboarding/sub-broker-requests')).json.requests.find((q: any) => q.id === REQ);
  assert.ok(found, 'the branch Compliance Manager sees the request');
  assert.equal(found.parentName, 'Parent Broker');
});

test('a sub-broker is requested only by the administrator of the broker, and only once that broker is Active', async () => {
  assert.equal((await call(LEARNER, 'POST', `/v1/onboarding/cases/${B1_CASE}/sub-brokers`, { name: 'Learner Sub', type: 'individual', adminEmail: 'l@sub.test' })).status, 403);
  assert.equal((await call(B2_ADMIN, 'POST', `/v1/onboarding/cases/${B2_CASE}/sub-brokers`, { name: 'Early Sub', type: 'individual', adminEmail: 'e@sub.test' })).status, 409, 'B2 is not active yet');
});

test('a request needs a business name (never an email), a valid administrator email, and an unused name', async () => {
  assert.equal((await call(B1_ADMIN, 'POST', `/v1/onboarding/cases/${B1_CASE}/sub-brokers`, { name: 'x@y.test', type: 'individual', adminEmail: 'a@sub.test' })).status, 422);
  assert.equal((await call(B1_ADMIN, 'POST', `/v1/onboarding/cases/${B1_CASE}/sub-brokers`, { name: 'Good Name', type: 'individual', adminEmail: 'not-an-email' })).status, 422);
  assert.equal((await call(B1_ADMIN, 'POST', `/v1/onboarding/cases/${B1_CASE}/sub-brokers`, { name: 'parent broker', type: 'individual', adminEmail: 'dup@sub.test' })).status, 409, 'a name already in use');
});

test('a Compliance Manager starts the file: the sub-broker is created with its file and invitation; the broker admin cannot start it', async () => {
  assert.equal((await call(B1_ADMIN, 'POST', `/v1/onboarding/sub-broker-requests/${REQ}/start`)).status, 403);
  const started = await call(OFF, 'POST', `/v1/onboarding/sub-broker-requests/${REQ}/start`);
  assert.equal(started.status, 201, started.raw);
  assert.equal(started.json.stage, 'invited');
  S1 = started.json.nodeId;
  S1_CASE = started.json.id;
  assert.ok(S1 && started.json.id, 'a node and a file exist together');
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/sub-broker-requests/${REQ}/start`)).status, 409, 'a started request is not started twice');
  const link = await owner((o) => o.query(`SELECT kind FROM org_links WHERE parent_id = $1 AND child_id = $2`, [B1, S1]));
  assert.equal(link.rows[0]?.kind, 'partner_link', 'it sits under the broker');
});

test('depth is three levels of brokers: a sub-sub-broker is allowed, a fourth level is refused', async () => {
  // The sub-broker must be active before it can have subs of its own.
  const s1Admin = 'north.admin@sub.test';
  await seed((await owner((o) => o.query('SELECT tenant_id FROM org_nodes WHERE id = $1', [B1]))).rows[0].tenant_id, s1Admin, S1, 'admin');
  await call(s1Admin, 'POST', '/v1/consent/first-login');
  await activate(S1);
  const r2 = await call(s1Admin, 'POST', `/v1/onboarding/cases/${S1_CASE}/sub-brokers`, { name: 'Level Three Sub', type: 'individual', adminEmail: 'l3@sub.test' });
  assert.equal(r2.status, 201, r2.raw);
  const started = await call(OFF, 'POST', `/v1/onboarding/sub-broker-requests/${r2.json.id}/start`);
  assert.equal(started.status, 201, started.raw);
  S2 = started.json.nodeId;
  S2_CASE = started.json.id;
  await activate(S2);
  const s2Admin = 'level3.admin@sub.test';
  await seed((await owner((o) => o.query('SELECT tenant_id FROM org_nodes WHERE id = $1', [B1]))).rows[0].tenant_id, s2Admin, S2, 'admin');
  await call(s2Admin, 'POST', '/v1/consent/first-login');
  const fourth = await call(s2Admin, 'POST', `/v1/onboarding/cases/${S2_CASE}/sub-brokers`, { name: 'Level Four Sub', type: 'individual', adminEmail: 'l4@sub.test' });
  assert.equal(fourth.status, 409, fourth.raw);
  assert.match(fourth.raw, /three levels/);
});
