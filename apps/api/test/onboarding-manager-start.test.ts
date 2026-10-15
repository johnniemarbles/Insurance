// A branch manager sees the progress of brokers in its branch, and nothing more: no screening answers, no decision.
// Starting a broker, and recording its type, are the Compliance Manager's (plan v7, section 5). See roles-scope.test.ts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@mgrview.test', OFF = 'officer@mgrview.test', MGR = 'mgr@mgrview.test';
let TOR = '', BROKER = '', CASE = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Manager View Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [MGR, TOR, 'manager']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, MGR]) await call(e, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Broker Progress');
  CASE = (await caseOfBroker(db.ownerUrl, BROKER));
  assert.ok(CASE);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a branch manager sees the broker in its branch with progress only', async () => {
  const list = await call(MGR, 'GET', '/v1/onboarding/cases');
  assert.equal(list.status, 200, list.raw);
  const row = (list.json.cases as Array<{ id: string; partnerName?: string }>).find((c) => c.id === CASE);
  assert.ok(row, 'the manager sees the case in its branch');
  const detail = await call(MGR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(detail.status, 200, detail.raw);
  assert.ok(!detail.raw.includes('insolvencyOrJudgment') && !detail.raw.includes('redFlag'), 'no screening answers');
});

test('a branch manager cannot decide the file', async () => {
  const r = await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Manager tries to decide' });
  assert.equal(r.status, 403, r.raw);
});

test('a branch manager cannot record screening answers', async () => {
  const r = await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { insolvencyOrJudgment: false, redFlag: false, answers: {} });
  assert.equal(r.status, 403, r.raw);
});

test('the Compliance Manager of the branch records the broker type', async () => {
  const r = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/type`, { type: 'individual' });
  assert.equal(r.status, 200, r.raw);
});
