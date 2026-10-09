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
const ADMIN = 'admin@am.test', PA = 'pa@am.test', PB = 'pb@am.test', OTHER = 'other@am.test';
let box = '', pipe = '', sNew = '', sBound = '';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const COMP = 'comp@am.test';

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
  box = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'AML client' })).json.id;
  const st = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages; sNew = st[0].id; sBound = st[1].id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a client ID check is recorded with who and when, refuses ID numbers, and satisfies an ID gate', async () => {
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/id-records`, { method: 'in_person', result: 'verified' })).status, 422, 'in person needs the documents seen');
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/id-records`, { method: 'in_person', result: 'verified', documentsSeen: ['Ontario driver licence D1234567890'] })).status, 422, 'no ID numbers');
  assert.equal((await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['id_record'] })).status, 204);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${box}`, { stageId: sBound })).status, 409, 'no ID on file yet');
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/id-records`, { method: 'in_person', result: 'verified', documentsSeen: ['Ontario driver licence'] })).status, 201);
  const a = (await call(PA, 'GET', `/v1/boxes/${box}/aml`)).json;
  assert.equal(a.status.idVerified, true); assert.equal(a.idRecords[0].verifier.length > 0, true);
});

test('a PEP hit blocks gated stages until the compliance role clears it with a reason', async () => {
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/screenings`, { list: 'pep', result: 'hit', note: 'Name match' })).status, 201);
  assert.deepEqual((await call(PA, 'GET', `/v1/boxes/${box}/aml`)).json.status.openHits, ['pep']);
  const blocked = await call(PA, 'PATCH', `/v1/boxes/${box}`, { stageId: sBound });
  assert.equal(blocked.status, 409); assert.match(JSON.stringify(blocked.json), /screening/);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/screenings`, { list: 'pep', result: 'cleared_after_review', note: 'Reviewed, different person' })).status, 403);
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${box}/screenings`, { list: 'pep', result: 'cleared_after_review', note: 'short' })).status, 422);
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${box}/screenings`, { list: 'sanctions', result: 'cleared_after_review', note: 'Nothing to clear here' })).status, 409);
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${box}/screenings`, { list: 'pep', result: 'cleared_after_review', note: 'Reviewed, different person' })).status, 201);
  assert.deepEqual((await call(PA, 'GET', `/v1/boxes/${box}/aml`)).json.status.openHits, []);
  assert.equal((await call(PA, 'PATCH', `/v1/boxes/${box}`, { stageId: sBound })).status, 204);
});

test('large cash is flagged at $10,000, the report reference is added once, and entries cannot be changed', async () => {
  const small = await call(PA, 'POST', `/v1/boxes/${box}/cash`, { amount: 9999.99, occurredOn: '2026-10-01' });
  assert.equal(small.json.reportRequired, false);
  assert.equal((await call(PA, 'POST', `/v1/cash/${small.json.id}/report`, { reference: 'X' })).status, 422);
  const big = await call(PA, 'POST', `/v1/boxes/${box}/cash`, { amount: 10000, occurredOn: '2026-10-02' });
  assert.equal(big.json.reportRequired, true);
  assert.equal((await call(PA, 'GET', `/v1/boxes/${box}/aml`)).json.status.reportsDue, 1);
  assert.equal((await call(PA, 'POST', `/v1/cash/${big.json.id}/report`, { reference: 'LCTR-001' })).status, 200);
  assert.equal((await call(PA, 'POST', `/v1/cash/${big.json.id}/report`, { reference: 'LCTR-002' })).status, 409);
  assert.equal((await call(PA, 'GET', `/v1/boxes/${box}/aml`)).json.status.reportsDue, 0);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const priv = (t: string, p: string) => o.query(`SELECT has_table_privilege('app_runtime',$1,$2) AS ok`, [t, p]).then((r) => r.rows[0].ok);
  for (const t of ['client_id_records', 'screening_results']) { assert.equal(await priv(t, 'UPDATE'), false); assert.equal(await priv(t, 'DELETE'), false); }
  assert.equal(await priv('cash_transactions', 'DELETE'), false);
  await o.end();
});

test('files at risk also lists open identity, screening and cash items, and they go when resolved', async () => {
  const b2 = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Open AML items' })).json.id as string;
  assert.equal((await call(PA, 'POST', `/v1/boxes/${b2}/id-records`, { method: 'in_person', result: 'failed', documentsSeen: ['Passport'] })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${b2}/screenings`, { list: 'sanctions', result: 'hit', note: 'Possible match' })).status, 201);
  const cash = (await call(PA, 'POST', `/v1/boxes/${b2}/cash`, { amount: 15000, occurredOn: '2026-01-05' })).json.id as string;
  const mine = async () => ((await call(ADMIN, 'GET', '/v1/compliance/files-at-risk')).json.aml as { boxId: string; issue: string; overdue: boolean }[]).filter((a) => a.boxId === b2);
  const open = await mine();
  assert.deepEqual(open.map((a) => a.issue).sort(), ['cash_unreported', 'id_failed', 'screening_hit']);
  assert.equal(open.find((a) => a.issue === 'cash_unreported')!.overdue, true, 'past 15 days');
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/files-at-risk')).json.aml.filter((a: any) => a.boxId === b2).length, 0, 'another company sees nothing');
  assert.equal((await call(PA, 'POST', `/v1/boxes/${b2}/id-records`, { method: 'in_person', result: 'verified', documentsSeen: ['Passport'] })).status, 201);
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${b2}/screenings`, { list: 'sanctions', result: 'cleared_after_review', note: 'Reviewed, different person' })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/cash/${cash}/report`, { reference: 'LCTR-9' })).status, 200);
  assert.deepEqual(await mine(), []);
});

test('records stay inside their record, branch and company', async () => {
  assert.equal((await call(PB, 'GET', `/v1/boxes/${box}/aml`)).status, 404);
  assert.equal((await call(OTHER, 'GET', `/v1/boxes/${box}/aml`)).status, 404);
  assert.equal((await call(PB, 'POST', `/v1/boxes/${box}/cash`, { amount: 5, occurredOn: '2026-10-02' })).status, 404);
});
