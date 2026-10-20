import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
let co: { tenantId: string; rootNodeId: string };
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
const ADMIN = 'admin@fg.test', MGR = 'mgr@fg.test', PA = 'pa@fg.test', COMP = 'comp@fg.test', OTHER = 'other@fg.test';
let BR = '', NA = '', pipe = '', sNew = '', sBound = '';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const upload = (who: string, boxId: string, docType?: string) =>
  call(who, 'POST', `/v1/boxes/${boxId}/documents`, { name: 'form.pdf', mime: 'application/pdf', dataBase64: PDF, ...(docType ? { docType } : {}) });
const newBox = async (name: string) => (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name })).json.id as string;

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await bootstrapTenant(db.ownerUrl, { name: 'Birch Insurance', countryCode: 'CA', adminEmail: OTHER });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(OTHER, 'POST', '/v1/consent/first-login');
  BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  NA = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner A');
  await seedUser(co.tenantId, MGR, BR, 'manager');
  await seedUser(co.tenantId, PA, NA, 'partner');
  await seedUser(co.tenantId, COMP, BR, 'compliance');
  pipe = (await call(MGR, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  const st = (await call(MGR, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages;
  sNew = st[0].id; sBound = st[1].id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('only an administrator or the compliance role can set required paperwork', async () => {
  const body = { requiredDocs: ['privacy_consent', 'needs_analysis'] };
  assert.equal((await call(PA, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, body)).status, 403);
  assert.equal((await call(MGR, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, body)).status, 403);
  assert.equal((await call(COMP, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, body)).status, 204);
  const got = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages.find((s: any) => s.id === sBound);
  assert.deepEqual([...got.requiredDocs].sort(), ['needs_analysis', 'privacy_consent']);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['bogus'] })).status, 400);
});

test('a record cannot enter a gated stage until the typed paperwork is filed', async () => {
  const id = await newBox('Gate client');
  const blocked = await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code ?? blocked.json.error?.code, 'gate_blocked');
  assert.match(JSON.stringify(blocked.json), /Privacy consent/);
  assert.equal((await upload(PA, id)).status, 201); // untyped does not count
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound })).status, 409);
  assert.equal((await upload(PA, id, 'privacy_consent')).status, 201);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound })).status, 409);
  const na = await upload(PA, id, 'needs_analysis');
  assert.equal(na.status, 201);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound })).status, 409, 'uploaded advice paperwork counts only once compliance verifies it');
  assert.equal((await call(COMP, 'POST', `/v1/documents/${na.json.id}/verify`, { note: 'Paper needs analysis checked complete and signed', clientSignedOn: new Date().toISOString().slice(0, 10) })).status, 204);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound })).status, 204);
  const g = (await call(PA, 'GET', `/v1/boxes/${id}/gates`)).json;
  assert.deepEqual(g.gates[0].missing, []);
  assert.equal(g.canWaive, false);
});

test('creating a record in a gated first stage is not blocked', async () => {
  await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sNew}`, { requiredDocs: ['id_record'] });
  assert.equal((await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, stageId: sNew, name: 'Fresh' })).status, 201);
  await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sNew}`, { requiredDocs: [] });
});

test('a waiver needs the right role and a reason, is permanent, and lets the move through', async () => {
  const id = await newBox('Waived client');
  const w = (who: string, reason: string, docTypes = ['privacy_consent', 'needs_analysis']) => call(who, 'POST', `/v1/boxes/${id}/gate-overrides`, { stageId: sBound, docTypes, reason });
  assert.equal((await w(PA, 'client is travelling abroad')).status, 403);
  assert.equal((await w(COMP, 'too short')).status, 422);
  assert.equal((await w(COMP, 'client is travelling abroad', ['id_record'])).status, 422); // not required here
  assert.equal((await w(COMP, 'client is travelling abroad')).status, 201);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${id}`, { stageId: sBound })).status, 204);
  const g = (await call(COMP, 'GET', `/v1/boxes/${id}/gates`)).json;
  assert.equal(g.overrides.length, 1);
  assert.equal(g.canWaive, true);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const priv = (p: string) => o.query(`SELECT has_table_privilege('app_runtime','gate_overrides',$1) AS ok`, [p]).then((r) => r.rows[0].ok);
  assert.equal(await priv('INSERT'), true);
  assert.equal(await priv('UPDATE'), false);
  assert.equal(await priv('DELETE'), false);
  await o.end();
});

test('files at risk lists a record past a gate without paperwork or waiver, and nobody else sees it', async () => {
  const id = await newBox('Risky client');
  await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['privacy_consent', 'needs_analysis', 'id_record'] });
  const r = (await call(MGR, 'GET', '/v1/compliance/files-at-risk')).json;
  assert.ok(r.waivers90d >= 1);
  assert.ok(Array.isArray(r.files));
  void id;
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/files-at-risk')).json.files.length, 0);
  assert.equal((await call(OTHER, 'GET', `/v1/boxes/${id}/gates`)).status, 404);
});

test('the clearance list names who is not cleared to transact, and stays inside the company', async () => {
  const r = await call(ADMIN, 'GET', '/v1/compliance/clearance');
  assert.equal(r.status, 200);
  const mine = r.json.notCleared.find((x: any) => x.name === 'Partner A');
  assert.ok(mine, 'a partner with no paperwork is not cleared');
  assert.ok(mine.reasons.includes('not_approved') && mine.reasons.includes('no_licence') && mine.reasons.includes('no_eo'));
  assert.equal(r.json.total, r.json.cleared + r.json.notCleared.length);
  assert.ok(!(await call(OTHER, 'GET', '/v1/compliance/clearance')).json.notCleared.some((x: any) => x.name === 'Partner A'));
});

test('copying a pipeline copies each stage’s required paperwork', async () => {
  assert.equal((await call(COMP, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['needs_analysis', 'id_record'] })).status, 204);
  const c = await call(MGR, 'POST', `/v1/pipelines/${pipe}/clone`, { name: 'Life copy' });
  assert.equal(c.status, 201);
  const b = (await call(MGR, 'POST', '/v1/boxes', { pipelineId: c.json.id, name: 'Copy client' })).json.id as string;
  const g = (await call(MGR, 'GET', `/v1/boxes/${b}/gates`)).json.gates;
  assert.deepEqual(g.find((x: any) => x.stageName === 'Bound').required.slice().sort(), ['id_record', 'needs_analysis']);
});
