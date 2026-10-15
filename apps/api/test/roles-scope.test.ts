// Roles by scope (plan v7): a branch manager adds and removes manager, trainer and staff in its own branch only.
// A Compliance Manager cannot add staff. A branch manager cannot add a broker, start its file or record its type.
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

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@scope.test', OFF = 'officer@scope.test', MGR = 'mgr@scope.test', MGR2 = 'mgr2@scope.test', STAFF = 'staff@scope.test';
let TOR = '', OTT = '', BROKER = '', TOR_STAFF_USER = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Scope Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [MGR, TOR, 'manager'], [MGR2, OTT, 'manager']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
    // A staff member already in the Toronto branch, for the removal test.
    TOR_STAFF_USER = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,'staff',$3,'active') RETURNING id`, [co.tenantId, STAFF, TOR])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'staff')`, [co.tenantId, TOR_STAFF_USER, TOR]);
  });
  for (const e of [OFF, MGR, MGR2]) await call(e, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Broker');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a branch offers a branch manager manager, trainer and staff only', async () => {
  const r = await call(MGR, 'GET', `/v1/org/places/${TOR}/roles`);
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual([...r.json.roles].sort(), ['manager', 'staff', 'trainer']);
});

test('the company administrator is offered the staff role at a branch', async () => {
  const r = await call(ADMIN, 'GET', `/v1/org/places/${TOR}/roles`);
  assert.ok(r.json.roles.includes('staff'), r.raw);
});

test('a branch manager adds a staff member to its own branch', async () => {
  const r = await call(MGR, 'POST', '/v1/invitations', { email: 'newstaff@scope.test', nodeId: TOR, role: 'staff' });
  assert.equal(r.status, 201, r.raw);
});

test('a branch manager adds a trainer to its own branch', async () => {
  const r = await call(MGR, 'POST', '/v1/invitations', { email: 'trainer@scope.test', nodeId: TOR, role: 'trainer' });
  assert.equal(r.status, 201, r.raw);
});

test('a branch manager cannot give compliance, auditor, partner or admin roles', async () => {
  for (const role of ['compliance', 'auditor', 'partner', 'admin']) {
    const r = await call(MGR, 'POST', '/v1/invitations', { email: `${role}@scope.test`, nodeId: TOR, role });
    assert.equal(r.status, 403, `${role}: ${r.raw}`);
  }
});

test('a branch manager cannot add staff to a branch it does not manage', async () => {
  const r = await call(MGR, 'POST', '/v1/invitations', { email: 'elsewhere@scope.test', nodeId: OTT, role: 'staff' });
  assert.ok([403, 404].includes(r.status), r.raw);
});

test('a branch manager removes a staff role in its own branch', async () => {
  const r = await call(MGR, 'DELETE', `/v1/org/members?userId=${TOR_STAFF_USER}&nodeId=${TOR}&role=staff`);
  assert.equal(r.status, 204, r.raw);
});

test('a Compliance Manager cannot add staff', async () => {
  const r = await call(OFF, 'POST', '/v1/invitations', { email: 'officerstaff@scope.test', nodeId: TOR, role: 'staff' });
  assert.equal(r.status, 403, r.raw);
});

test('the company administrator can still appoint a Compliance Manager on a branch', async () => {
  const r = await call(ADMIN, 'POST', '/v1/invitations', { email: 'newofficer@scope.test', nodeId: TOR, role: 'compliance' });
  assert.equal(r.status, 201, r.raw);
});

test('a branch manager cannot add a broker under its branch', async () => {
  const r = await call(MGR, 'POST', '/v1/org/partners', { name: 'Manager Broker', parentId: TOR });
  assert.equal(r.status, 403, r.raw);
});

test('a branch manager cannot start a broker file', async () => {
  const r = await call(MGR, 'POST', '/v1/onboarding/cases', { nodeId: BROKER, country: 'CA' });
  assert.equal(r.status, 403, r.raw);
});

test('a branch manager cannot record a broker type', async () => {
  const caseOf = (await owner((o) => o.query('SELECT id FROM onboarding_cases WHERE node_id = $1', [BROKER]))).rows[0].id;
  const r = await call(MGR, 'POST', `/v1/onboarding/cases/${caseOf}/type`, { type: 'individual' });
  assert.equal(r.status, 403, r.raw);
});
