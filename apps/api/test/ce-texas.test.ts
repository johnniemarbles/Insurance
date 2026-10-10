import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@tx-ce.test', L1 = 'sam@tx-ce.test';
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  db = await createTestDb('us');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'us', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: { model: 'fake', complete: async () => '' } };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Lone Star Insurance', countryCode: 'US', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const loc = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Austin' })).json.id;
  const home = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sam Agency', parentId: loc })).json.id;
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,'Sam Learner',$3,'active') RETURNING id`, [co.tenantId, L1, home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'learner')`, [co.tenantId, u, home]);
  });
  await call(L1, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('Texas pack: 24 hours with 3 ethics, 10 for limited lines, per-licence two-year term', async () => {
  const p = (await call(L1, 'GET', '/v1/ce/packs')).json.packs.find((x: { code: string }) => x.code === 'tx_tdi');
  assert.ok(p); assert.equal(p.perLicenceTerm, true); assert.equal(p.termMonths, 24);
  assert.equal(p.classes.find((c: { key: string }) => c.key === 'agent').total, 24);
  assert.equal(p.classes.find((c: { key: string }) => c.key === 'limited').total, 10);
});

test('Texas: hours count inside the licence term; ethics minimum is enforced', async () => {
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'tx_tdi', licenceClass: 'agent' })).status, 422);
  const y = Number(today.slice(0, 4)); const start = `${y - 1}${today.slice(4)}`;
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'tx_tdi', licenceClass: 'agent', termStart: start })).status, 204);
  const add = (title: string, category: string, hours: number) => call(L1, 'POST', '/v1/ce/entries', { packCode: 'tx_tdi', title, provider: 'Acme CE', category, hours, completedOn: today });
  await add('General', 'technical', 21);
  let me = (await call(L1, 'GET', '/v1/ce/me')).json.licences.find((l: { packCode: string }) => l.packCode === 'tx_tdi');
  assert.equal(me.evaluation.counted, 21); assert.deepEqual(me.evaluation.missing, { ethics: 3 });
  await add('Ethics', 'ethics', 3);
  me = (await call(L1, 'GET', '/v1/ce/me')).json.licences.find((l: { packCode: string }) => l.packCode === 'tx_tdi');
  assert.equal(me.evaluation.state, 'met');
});
