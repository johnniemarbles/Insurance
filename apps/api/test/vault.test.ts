import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import type { Vault } from '../src/vault.ts';
import { createHash } from 'node:crypto';
import { addBrokerFixture } from './support/broker.ts';
const store = new Map<string, Buffer>();
let failNext = false;
const memVault: Vault = { bucket: 'test-bucket', region: 'ca-central-1', lockMode: 'GOVERNANCE',
  async put(key, bytes) { if (failNext) { failNext = false; throw new Error('S3 down'); } store.set(key, bytes); return { versionId: 'v1', sha256: createHash('sha256').update(bytes).digest('hex') }; },
  async get(key) { return store.get(key)!; }, async check() {} };

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
let co: { tenantId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
  await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  await o.end();
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@ad.test', PA = 'pa@ad.test', PB = 'pb@ad.test', OTHER = 'other@ad.test';
let box = '';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const mk = (who: string, kind: string, extra: object = {}) => call(who, 'POST', `/v1/boxes/${box}/advice`, { kind, title: 'Needs analysis 2026', body: 'Client needs 20-year term cover for a mortgage.', clientName: 'Rita Client', clientEmail: 'rita@client.test', ...extra });

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), vault: memVault });
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await bootstrapTenant(db.ownerUrl, { name: 'Birch Insurance', countryCode: 'CA', adminEmail: OTHER });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(OTHER, 'POST', '/v1/consent/first-login');
  const BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const NA = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner A');
  const NB = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner B');
  await seedUser(co.tenantId, PA, NA, 'partner'); await seedUser(co.tenantId, PB, NB, 'partner');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  box = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Advice client' })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('signed paperwork is copied encrypted to the vault, verified, retried after a failure, and kept per company', async () => {
  const a = await mk(PA, 'needs_analysis');
  const code = (await call(PA, 'POST', `/v1/advice/${a.json.id}/send-code`)).json.devCode;
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/confirm`, { code })).status, 200);
  const s0 = (await call(ADMIN, 'GET', '/v1/compliance/vault')).json;
  assert.equal(s0.connected, true); assert.equal(s0.pending, 1); assert.equal(s0.archived, 0);
  assert.equal((await call(PA, 'GET', '/v1/compliance/vault')).status, 403);
  assert.equal((await call(PA, 'POST', '/v1/compliance/vault/archive-now')).status, 403);
  failNext = true;
  const f = (await call(ADMIN, 'POST', '/v1/compliance/vault/archive-now')).json;
  assert.deepEqual(f, { archived: 0, failed: 1 });
  assert.equal((await call(ADMIN, 'GET', '/v1/compliance/vault')).json.pending, 1);
  const r = (await call(ADMIN, 'POST', '/v1/compliance/vault/archive-now')).json;
  assert.deepEqual(r, { archived: 1, failed: 0 });
  const s1 = (await call(ADMIN, 'GET', '/v1/compliance/vault')).json;
  assert.equal(s1.pending, 0); assert.equal(s1.archived, 1);
  assert.equal(s1.recent[0].lockMode, 'GOVERNANCE');
  assert.ok(s1.recent[0].retainUntil > new Date().toISOString().slice(0, 10));
  // the stored object is ciphertext, not the PDF
  const blob = [...store.values()][0]!;
  assert.ok(!blob.includes(Buffer.from('%PDF')));
  assert.deepEqual((await call(ADMIN, 'GET', `/v1/compliance/vault/${s1.recent[0].documentId}/verify`)).json, { intact: true });
  // the copy can be downloaded back out as the original PDF, by an administrator only
  const dl = (await call(ADMIN, 'GET', `/v1/compliance/vault/${s1.recent[0].documentId}/download`)).json;
  assert.ok(Buffer.from(dl.dataBase64, 'base64').subarray(0, 4).toString() === '%PDF', 'the download is the original PDF');
  assert.match(dl.filename, /\.pdf$/);
  assert.equal((await call(OTHER, 'GET', `/v1/compliance/vault/${s1.recent[0].documentId}/download`)).status, 404);
  // running again archives nothing new
  assert.deepEqual((await call(ADMIN, 'POST', '/v1/compliance/vault/archive-now')).json, { archived: 0, failed: 0 });
  // another company sees nothing
  const o = (await call(OTHER, 'GET', '/v1/compliance/vault')).json;
  assert.equal(o.archived, 0);
  assert.equal((await call(OTHER, 'GET', `/v1/compliance/vault/${s1.recent[0].documentId}/verify`)).status, 404);
});

test('the vault record cannot be edited or removed by the application', async () => {
  const o = new pg.Client({ connectionString: db.appUrl }); await o.connect();
  const p = await o.query(`SELECT has_table_privilege('app_runtime', 'vault_objects', 'UPDATE') AS u, has_table_privilege('app_runtime', 'vault_objects', 'DELETE') AS d`);
  await o.end();
  assert.deepEqual(p.rows[0], { u: false, d: false });
});

test('the privacy page names the archive storage when a vault is connected', async () => {
  const en = await app.inject({ method: 'GET', url: '/privacy?lang=en' });
  assert.match(en.body, /Amazon Web Services in Canada/);
  const fr = await app.inject({ method: 'GET', url: '/privacy?lang=fr-CA' });
  assert.match(fr.body, /Amazon Web Services au Canada/);
});
