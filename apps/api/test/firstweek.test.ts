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
let co: { tenantId: string; rootNodeId: string }; let ho: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json, text: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function seedUser(tenantId: string, email: string, home: string, role: string, name?: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [tenantId, email, name ?? email.split('@')[0], home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@fw.test', PART = 'partner@fw.test', FR = 'frlearner@fw.test';
let LOC = '', NODE = '';
const today = new Date().toISOString().slice(0, 10);
const fakeAi = { model: 'fake', complete: async () => '' };

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: fakeAi };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  LOC = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  NODE = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'New Partner Agency', parentId: LOC })).json.id;
  await seedUser(co.tenantId, PART, NODE, 'partner', 'Pat Partner');
  await seedUser(co.tenantId, FR, NODE, 'learner', 'Fran Learner');
  await owner((o) => o.query(`UPDATE app_users SET locale = 'fr-CA' WHERE email = $1`, [FR]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const step = (j: any, id: string) => j.steps.find((s: { id: string }) => s.id === id);

test('first week: a new partner starts at day 1 with the file steps open, and the person at the partner sees it as their own', async () => {
  const r = await call(PART, 'GET', `/v1/first-week/${NODE}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 12); assert.equal(r.json.day, 1); assert.equal(r.json.next, 'profile');
  assert.equal(step(r.json, 'team').done, true, 'two people already sit at this partner');
  assert.ok(r.json.guideUrl.endsWith('/guide'));
  const mine = await call(PART, 'GET', '/v1/first-week');
  assert.equal(mine.json.applicable, true); assert.equal(mine.json.node.id, NODE);
  const admin = await call(ADMIN, 'GET', '/v1/first-week');
  assert.equal(admin.json.applicable, false, 'the company administrator sits at the root, not at a partner');
});

test('first week: steps tick as the file is filled in', async () => {
  assert.equal((await call(PART, 'PUT', `/v1/compliance/partners/${NODE}/profile`, { entityType: 'corporation', legalName: 'New Partner Agency Inc.', businessNumber: '123456789RC0001' })).status, 204);
  let r = await call(PART, 'GET', `/v1/first-week/${NODE}`);
  assert.equal(step(r.json, 'profile').done, true); assert.equal(r.json.next, 'licence');
  const lic = await call(PART, 'POST', `/v1/compliance/partners/${NODE}/items`, { kind: 'licence', label: 'RIBO general licence', number: 'L1', jurisdiction: 'ON', lines: ['life'], expiresOn: '2030-01-01' });
  assert.ok(lic.status < 300, JSON.stringify(lic.json));
  r = await call(PART, 'GET', `/v1/first-week/${NODE}`);
  assert.equal(step(r.json, 'licence').done, true);
  assert.equal(step(r.json, 'client').done, false);
});

test('first week: CE setup counts people with a licence set up', async () => {
  assert.equal((await call(FR, 'PUT', '/v1/ce/licences', { packCode: 'ribo', licenceClass: 'broker' })).status, 204);
  const r = await call(PART, 'GET', `/v1/first-week/${NODE}`);
  assert.equal(step(r.json, 'ce').done, true); assert.equal(r.json.counts.ceLicensees, 1);
});

test('partner guide: needs sign-in, then shows in the person\'s language, and is never cached or indexed', async () => {
  const anon = await app.inject({ method: 'GET', url: '/guide' });
  assert.equal(anon.statusCode, 401); assert.ok(!anon.body.includes('First week'));
  const en = await app.inject({ method: 'GET', url: '/guide', headers: { 'x-dev-user-email': PART } });
  assert.equal(en.statusCode, 200);
  assert.match(en.body, /Partner guide/); assert.match(en.body, /RIBO/); assert.doesNotMatch(en.body, /California/);
  assert.match(String(en.headers['cache-control']), /no-store/); assert.match(String(en.headers['x-robots-tag']), /noindex/);
  const fr = await app.inject({ method: 'GET', url: '/guide', headers: { 'x-dev-user-email': FR } });
  assert.match(fr.body, /Guide du partenaire/); assert.match(fr.body, /lang="fr-CA"/);
  const forced = await app.inject({ method: 'GET', url: '/guide?lang=en', headers: { 'x-dev-user-email': FR } });
  assert.match(forced.body, /Partner guide/);
});
