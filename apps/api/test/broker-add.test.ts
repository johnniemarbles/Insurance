// Add broker (plan v7, section 5). Only the Compliance Manager of a branch adds a broker under it, in one call that creates
// the broker and its file together. The company administrator and branch managers cannot. Name is required, never an email.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@add.test', OFF = 'officer@add.test', OFF_OTT = 'officer-ott@add.test', MGR = 'mgr@add.test';
let TOR = '', OTT = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Add Broker Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [MGR, TOR, 'manager'], [OFF_OTT, OTT, 'compliance']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, OFF_OTT, MGR]) await call(e, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const adminEmail = (n: string) => `owner-${n}@brokers.test`;

test('the Compliance Manager of the branch adds a broker in one call, and it starts its file at once', async () => {
  const r = await call(OFF, 'POST', '/v1/onboarding/brokers', { name: 'Toronto Add Broker Inc', parentId: TOR, type: 'corporate', adminEmail: adminEmail('one') });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.stage, 'invited');
  assert.ok(r.json.id && r.json.nodeId, 'a broker and its file');
  const file = await call(OFF, 'GET', `/v1/onboarding/cases/${r.json.id}`);
  assert.equal(file.status, 200, file.raw);
  const type = (await owner((o) => o.query('SELECT broker_type FROM onboarding_cases WHERE id = $1', [r.json.id]))).rows[0];
  assert.equal(type.broker_type, 'corporate');
});

test('the company administrator cannot add a broker under a branch', async () => {
  const r = await call(ADMIN, 'POST', '/v1/onboarding/brokers', { name: 'Admin Broker', parentId: TOR, type: 'individual', adminEmail: adminEmail('admin') });
  assert.equal(r.status, 403, r.raw);
});

test('a branch manager cannot add a broker under its branch', async () => {
  const r = await call(MGR, 'POST', '/v1/onboarding/brokers', { name: 'Manager Broker', parentId: TOR, type: 'individual', adminEmail: adminEmail('mgr') });
  assert.equal(r.status, 403, r.raw);
});

test('a Compliance Manager of another branch cannot add a broker under this one', async () => {
  const r = await call(OFF_OTT, 'POST', '/v1/onboarding/brokers', { name: 'Wrong Branch Broker', parentId: TOR, type: 'individual', adminEmail: adminEmail('ott') });
  assert.ok([403, 404].includes(r.status), r.raw);
});

test('the name is required and is never an email address', async () => {
  assert.ok([400, 422].includes((await call(OFF, 'POST', '/v1/onboarding/brokers', { name: '  ', parentId: TOR, type: 'individual', adminEmail: adminEmail('blank') })).status));
  const byEmail = await call(OFF, 'POST', '/v1/onboarding/brokers', { name: 'jane@broker.test', parentId: TOR, type: 'individual', adminEmail: adminEmail('mail') });
  assert.equal(byEmail.status, 422, byEmail.raw);
});

test('the type and the administrator email are required and checked', async () => {
  assert.equal((await call(OFF, 'POST', '/v1/onboarding/brokers', { name: 'No Type Broker', parentId: TOR, type: 'trust', adminEmail: adminEmail('type') })).status, 422);
  assert.equal((await call(OFF, 'POST', '/v1/onboarding/brokers', { name: 'No Email Broker', parentId: TOR, type: 'individual', adminEmail: 'not-an-email' })).status, 422);
});

test('a broker with the same name, in any case, is refused rather than duplicated', async () => {
  const before = (await owner((o) => o.query(`SELECT count(*)::int AS n FROM org_nodes WHERE type = 'partner' AND lower(name) = 'toronto add broker inc'`))).rows[0].n;
  const r = await call(OFF, 'POST', '/v1/onboarding/brokers', { name: 'TORONTO ADD BROKER INC', parentId: TOR, type: 'individual', adminEmail: adminEmail('dup') });
  assert.equal(r.status, 409, r.raw);
  const after = (await owner((o) => o.query(`SELECT count(*)::int AS n FROM org_nodes WHERE type = 'partner' AND lower(name) = 'toronto add broker inc'`))).rows[0].n;
  assert.equal(after, before);
});

test('the duplicate check finds a broker by name, so it is started instead of added again', async () => {
  const r = await call(OFF, 'GET', '/v1/onboarding/brokers/search?q=add broker');
  assert.equal(r.status, 200, r.raw);
  assert.ok((r.json.brokers as Array<{ name: string; caseId: string | null }>).some((b) => b.name === 'Toronto Add Broker Inc' && b.caseId));
  assert.deepEqual((await call(OFF, 'GET', '/v1/onboarding/brokers/search?q=a')).json.brokers, [], 'a search needs two letters');
});

test('the old partner route makes no broker under a branch, for anyone, so no broker exists without its file', async () => {
  const r = await call(OFF, 'POST', '/v1/org/partners', { name: 'Bare Broker', parentId: TOR });
  assert.equal(r.status, 403, r.raw);
  assert.equal((await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Bare Broker', parentId: TOR })).status, 403);
});

test('the company administrator cannot start a file, even on a broker it administers; the Compliance Manager can', async () => {
  const node = (await owner((o) => o.query(`INSERT INTO org_nodes (id, tenant_id, type, name) SELECT gen_random_uuid(), tenant_id, 'partner', 'Plain Broker' FROM org_nodes WHERE id = $1 RETURNING id`, [TOR]))).rows[0];
  await owner((o) => o.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind, created_by) SELECT tenant_id, $1, $2, 'location_link', NULL FROM org_nodes WHERE id = $1`, [TOR, node.id]));
  assert.equal((await call(ADMIN, 'POST', '/v1/onboarding/cases', { nodeId: node.id })).status, 403);
  assert.equal((await call(OFF, 'POST', '/v1/onboarding/cases', { nodeId: node.id })).status, 201);
});
