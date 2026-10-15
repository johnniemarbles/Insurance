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
const ADMIN = 'admin@ca-ce.test', L1 = 'lee@ca-ce.test';
let HOME = '';
const today = new Date().toISOString().slice(0, 10);
const fakeAi = { model: 'fake', complete: async () => '' };

before(async () => {
  db = await createTestDb('us');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'us', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: fakeAi };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Sunset Insurance', countryCode: 'US', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const loc = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Los Angeles' })).json.id;
  HOME = await addBrokerFixture(call, db.ownerUrl, loc, 'Lee Agency');
  await seedUser(co.tenantId, L1, HOME, 'learner', 'Lee Learner');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the US server loads the US states only, and no Canadian regulator', async () => {
  const r = (await call(L1, 'GET', '/v1/ce/packs')).json.packs;
  assert.deepEqual(r.map((p: { code: string }) => p.code).sort(), ['ca_doi', 'tx_tdi']);
  assert.equal(r[0].perLicenceTerm, true);
  assert.equal(r[0].classes.find((c: { key: string }) => c.key === 'agent').total, 24);
  assert.equal(r[0].classes.find((c: { key: string }) => c.key === 'limited_auto').total, 20);
  assert.equal(r[0].retentionYears, 5);
});

test('California: the licence needs its own term start, and hours count inside that two-year term only', async () => {
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ca_doi', licenceClass: 'agent' })).status, 422);
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ca_doi', licenceClass: 'agent', termStart: '2999-01-01' })).status, 422);
  // a term that started a year ago: ends a year from now
  const y = Number(today.slice(0, 4)); const start = `${y - 1}${today.slice(4)}`;
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ca_doi', licenceClass: 'agent', termStart: start })).status, 204);
  const add = (title: string, category: string, hours: number, completedOn: string) => call(L1, 'POST', '/v1/ce/entries', { packCode: 'ca_doi', title, provider: 'Acme CE', category, hours, completedOn });
  assert.equal((await add('Ethics basics', 'ethics', 3, today)).status, 201);
  assert.equal((await add('P&C update', 'technical', 10, today)).status, 201);
  assert.equal((await add('Older than the term', 'technical', 8, `${y - 3}${today.slice(4)}`)).status, 201);
  let me = (await call(L1, 'GET', '/v1/ce/me')).json.licences[0];
  assert.equal(me.termAnchor, start);
  assert.equal(me.evaluation.termStart, start);
  assert.equal(me.evaluation.counted, 13); assert.equal(me.evaluation.remaining, 11);
  assert.equal(me.evaluation.state, 'on_track');
  assert.deepEqual(me.evaluation.missing, {});
  assert.ok(me.evaluation.daysLeft > 300);
  // finishing the remaining hours meets it
  assert.equal((await add('More technical', 'technical', 11, today)).status, 201);
  me = (await call(L1, 'GET', '/v1/ce/me')).json.licences[0];
  assert.equal(me.evaluation.state, 'met');
});

test('California: limited lines automobile is held to 20 hours', async () => {
  const start = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ca_doi', licenceClass: 'limited_auto', termStart: start });
  const me = (await call(L1, 'GET', '/v1/ce/me')).json.licences[0];
  assert.equal(me.evaluation.required, 20);
});
