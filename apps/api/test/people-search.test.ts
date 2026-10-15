// Onboarding plan step 2: add people search-first, then assign roles. Roles offered depend on the place.
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
const ADMIN = 'admin@ps.test', TOR_MGR = 'tor.mgr@ps.test', VAN_MGR = 'van.mgr@ps.test';
let TOR = '', VAN = '', BROKER = '', ROOT = '', VANP = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Search Insurance', countryCode: 'CA', adminEmail: ADMIN });
  ROOT = co.rootNodeId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  VAN = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver' })).json.id;
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Broker One');
  VANP = await addBrokerFixture(call, db.ownerUrl, VAN, 'Broker Van');
  await owner(async (o) => {
    for (const [email, home, role] of [[TOR_MGR, TOR, 'manager'], [VAN_MGR, VAN, 'manager'], ['jordan.lee@ps.test', BROKER, 'partner']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  await call(TOR_MGR, 'POST', '/v1/consent/first-login');
  await call(VAN_MGR, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('search finds people by name or email, and only people the caller can see', async () => {
  const hit = await call(ADMIN, 'GET', '/v1/users?q=jordan');
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.json.users.map((u: any) => u.email), ['jordan.lee@ps.test']);
  assert.equal((await call(ADMIN, 'GET', '/v1/users?q=ps.test')).json.users.length >= 4, true);
  assert.equal((await call(VAN_MGR, 'GET', '/v1/users?q=jordan')).json.users.length, 0, 'a Vancouver manager does not see a Toronto broker\'s person');
});

test('roles offered depend on the place: a branch offers manager and trainer, a broker offers only broker roles, a company offers compliance', async () => {
  const branch = await call(ADMIN, 'GET', `/v1/org/places/${TOR}/roles`);
  assert.equal(branch.status, 200, branch.raw);
  assert.ok(branch.json.roles.includes('manager') && branch.json.roles.includes('trainer') && branch.json.roles.includes('compliance'));
  assert.ok(!branch.json.roles.includes('learner'), 'learner is never assigned by hand');
  const broker = await call(ADMIN, 'GET', `/v1/org/places/${BROKER}/roles`);
  assert.deepEqual(broker.json.roles.sort(), ['admin', 'partner']);
  const company = await call(ADMIN, 'GET', `/v1/org/places/${ROOT}/roles`);
  assert.ok(company.json.roles.includes('compliance'));
  assert.ok(!company.json.roles.includes('manager'), 'a branch manager belongs to a branch, not the whole company');
});

test('an existing person is added to a second branch as a floating trainer, without a new invitation', async () => {
  const jordan = (await call(ADMIN, 'GET', '/v1/users?q=jordan')).json.users[0];
  assert.equal((await call(ADMIN, 'POST', '/v1/org/members', { userId: jordan.id, nodeId: TOR, role: 'trainer' })).status, 204);
  assert.equal((await call(ADMIN, 'POST', '/v1/org/members', { userId: jordan.id, nodeId: VAN, role: 'trainer' })).status, 204);
  const members = (await call(ADMIN, 'GET', '/v1/org/members')).json.members.filter((m: any) => m.userId === jordan.id && m.role === 'trainer');
  assert.deepEqual(members.map((m: any) => m.nodeId).sort(), [TOR, VAN].sort());
  assert.equal((await call(ADMIN, 'GET', `/v1/invitations`)).json.invitations?.filter((i: any) => i.email === 'jordan.lee@ps.test').length ?? 0, 0);
});

test('a role the place does not offer is refused when assigned', async () => {
  const jordan = (await call(ADMIN, 'GET', '/v1/users?q=jordan')).json.users[0];
  assert.equal((await call(ADMIN, 'POST', '/v1/org/members', { userId: jordan.id, nodeId: VANP, role: 'manager' })).status, 422);
  assert.equal((await call(ADMIN, 'POST', '/v1/org/members', { userId: jordan.id, nodeId: TOR, role: 'learner' })).status, 422);
});
