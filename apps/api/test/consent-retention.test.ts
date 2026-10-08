import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

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
const COMP = 'comp@cr.test';
const ADMIN = 'admin@cr.test', PA = 'pa@cr.test', PB = 'pb@cr.test', OTHER = 'other@cr.test';
let box = '', pipe = '', sNew = '', sBound = '';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await bootstrapTenant(db.ownerUrl, { name: 'Birch Insurance', countryCode: 'CA', adminEmail: OTHER });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(OTHER, 'POST', '/v1/consent/first-login');
  const BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const NA = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner A', parentId: BR })).json.id;
  const NB = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner B', parentId: BR })).json.id;
  await seedUser(co.tenantId, PA, NA, 'partner'); await seedUser(co.tenantId, PB, NB, 'partner');
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  await seedUser(co.tenantId, COMP, BR, 'compliance');
  box = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Consent client' })).json.id;
  const st = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages; sNew = st[0].id; sBound = st[1].id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('consents are recorded with wording and channel, a duplicate is refused, and an active consent satisfies its gate', async () => {
  assert.equal((await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['privacy_consent'] })).status, 204);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${box}`, { stageId: sBound })).status, 409);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/consents`, { kind: 'collection_use', channel: 'in_person' })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/consents`, { kind: 'collection_use', channel: 'phone' })).status, 409);
  const g = (await call(PA, 'GET', `/v1/boxes/${box}/consents`)).json;
  assert.deepEqual(g.active, ['collection_use']); assert.equal(g.consents[0].wordingVersion, 'draft-1'); assert.equal(g.wording.draft, true);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${box}`, { stageId: sBound })).status, 204, 'the consent record satisfies the privacy gate');
  assert.equal((await call(PB, 'GET', `/v1/boxes/${box}/consents`)).status, 404);
  assert.equal((await call(OTHER, 'GET', `/v1/boxes/${box}/consents`)).status, 404);
});

test('withdrawal re-opens the gate, shows on the overview, stops emails, and cannot be undone or repeated', async () => {
  const c = (await call(PA, 'GET', `/v1/boxes/${box}/consents`)).json.consents[0].id;
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/consents`, { kind: 'electronic_comms', channel: 'email' })).status, 201);
  const b2 = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Second client' })).json.id;
  const ec = (await call(PA, 'POST', `/v1/boxes/${box}/consents`, { kind: 'electronic_comms', channel: 'email' }));
  assert.equal(ec.status, 409);
  const e = (await call(PA, 'GET', `/v1/boxes/${box}/consents`)).json.consents.find((x: any) => x.kind === 'electronic_comms').id;
  assert.equal((await call(PA, 'POST', `/v1/consents/${e}/withdraw`, { note: 'Asked to stop emails' })).status, 200);
  const adv = (await call(PA, 'POST', `/v1/boxes/${box}/advice`, { kind: 'recommendation', title: 'T', body: 'B', clientName: 'Rita', clientEmail: 'r@c.test' })).json.id;
  assert.equal((await call(PA, 'POST', `/v1/advice/${adv}/send-code`)).status, 409, 'no email after withdrawal');
  assert.equal((await call(PA, 'POST', `/v1/consents/${e}/withdraw`, {})).status, 409);
  assert.equal((await call(PA, 'POST', `/v1/consents/${c}/withdraw`, { note: 'Client withdrew' })).status, 200);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${b2}`, { stageId: sBound })).status, 409);
  assert.deepEqual((await call(PA, 'GET', `/v1/boxes/${box}/consents`)).json.active, []);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/consents`, { kind: 'collection_use', channel: 'esign' })).status, 201, 'a fresh consent can be given again');
  const ov = (await call(ADMIN, 'GET', '/v1/compliance/overview')).json;
  assert.equal(ov.withdrawals30d, 2);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const priv = (t: string, p: string) => o.query(`SELECT has_table_privilege('app_runtime',$1,$2) AS ok`, [t, p]).then((r) => r.rows[0].ok);
  assert.equal(await priv('client_consents', 'DELETE'), false);
  assert.equal(await priv('legal_holds', 'DELETE'), false);
  assert.equal(await priv('retention_policies', 'DELETE'), false);
  await o.end();
});

test('retention: defaults, lengthening only, and only for administrators and compliance', async () => {
  assert.equal((await call(PA, 'GET', '/v1/compliance/retention')).status, 403);
  const r = (await call(ADMIN, 'GET', '/v1/compliance/retention')).json;
  assert.equal(r.policies.find((p: any) => p.kind === 'advice').years, 15);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/retention/advice', { years: 3 })).status, 422);
  assert.equal((await call(PA, 'PUT', '/v1/compliance/retention/advice', { years: 20 })).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/retention/advice', { years: 20 })).status, 204);
  assert.equal((await call(ADMIN, 'GET', '/v1/compliance/retention')).json.policies.find((p: any) => p.kind === 'advice').years, 20);
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/retention')).json.policies.find((p: any) => p.kind === 'advice').years, 15, 'another company keeps its own');
});

test('a closed file past its period is due, a legal hold stops that, and the hold is permanent history', async () => {
  const won = (await call(ADMIN, 'POST', `/v1/pipelines/${pipe}/stages`, { name: 'Done', isWon: true })).json.id;
  const b3 = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Old client' })).json.id;
  await call(PA, 'POST', `/v1/boxes/${b3}/id-records`, { method: 'credit_file', result: 'verified' });
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${b3}`, { stageId: won })).status, 204);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  await o.query(`UPDATE boxes SET stage_entered_at = now() - interval '6 years' WHERE id = $1`, [b3]); await o.end();
  let r = (await call(ADMIN, 'GET', '/v1/compliance/retention')).json;
  const row = r.files.find((x: any) => x.boxId === b3 && x.kind === 'aml');
  assert.equal(row.state, 'due'); assert.ok(r.summary.due >= 1);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${b3}/legal-hold`, { reason: 'Litigation pending' })).status, 403);
  assert.equal((await call(ADMIN, 'POST', `/v1/boxes/${b3}/legal-hold`, { reason: 'short' })).status, 422);
  const h = await call(ADMIN, 'POST', `/v1/boxes/${b3}/legal-hold`, { reason: 'Litigation pending with a client' });
  assert.equal(h.status, 201);
  assert.equal((await call(ADMIN, 'POST', `/v1/boxes/${b3}/legal-hold`, { reason: 'Litigation pending again' })).status, 409);
  r = (await call(ADMIN, 'GET', '/v1/compliance/retention')).json;
  assert.equal(r.files.find((x: any) => x.boxId === b3 && x.kind === 'aml').state, 'held');
  assert.equal(r.holds.length, 1);
  assert.equal((await call(ADMIN, 'POST', `/v1/legal-holds/${h.json.id}/release`, { note: 'Matter closed' })).status, 200);
  assert.equal((await call(ADMIN, 'POST', `/v1/legal-holds/${h.json.id}/release`, {})).status, 409);
  assert.equal((await call(ADMIN, 'GET', '/v1/compliance/retention')).json.files.find((x: any) => x.boxId === b3 && x.kind === 'aml').state, 'due');
});
