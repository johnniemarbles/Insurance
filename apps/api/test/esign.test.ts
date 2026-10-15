import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepEsign } from '../src/routes-esign.ts';
import { addBrokerFixture } from './support/broker.ts';
const calls: string[] = [];
let agreementStatus = 'OUT_FOR_SIGNATURE';
let goodToken = 'tok-1';
const fakeAdobe: typeof fetch = async (input, init) => {
  const url = String(input); const m = (init?.method ?? 'GET').toUpperCase();
  calls.push(`${m} ${url.replace(/^https:\/\/[^/]+/, '')}`);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/oauth/v2/refresh')) { goodToken = 'tok-2'; return json({ access_token: 'tok-2' }); }
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
  if (auth !== `Bearer ${goodToken}`) return json({ code: 'INVALID_ACCESS_TOKEN', message: 'bad token' }, 401);
  if (url.endsWith('/users/me')) return json({ email: 'ops@maple.test' });
  if (url.endsWith('/transientDocuments')) return json({ transientDocumentId: 'TD-1' });
  if (url.endsWith('/agreements') && m === 'POST') { const b = JSON.parse(String(init!.body)); if (b.fileInfos[0].transientDocumentId !== 'TD-1' || b.participantSetsInfo[0].memberInfos[0].email !== 'rita@client.test') return json({ message: 'bad body' }, 400); return json({ id: 'AG-1' }); }
  if (url.endsWith('/agreements/AG-1')) return json({ status: agreementStatus });
  if (url.endsWith('/agreements/AG-1/combinedDocument')) return new Response(Buffer.from('%PDF-1.4 adobe signed'));
  return json({ message: 'unexpected ' + url }, 404);
};

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
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), fetchImpl: fakeAdobe });
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

const API = 'https://api.na1.adobesign.com';
test('connecting Adobe: only admin or compliance, only Adobe addresses, the secret is never sent back', async () => {
  const a = await mk(PA, 'beneficiary_designation');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 409); // not connected yet
  assert.equal((await call(PA, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: API, accessToken: 'tok-1' })).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: 'https://evil.example.com', accessToken: 'tok-1' })).status, 422);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: API })).status, 422);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: API, accessToken: 'wrong' })).status, 502);
  const ok = await call(ADMIN, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: API + '/api/rest/v6/', accessToken: 'tok-1' });
  assert.equal(ok.status, 200); assert.equal(ok.json.signedInAs, 'ops@maple.test');
  const g = await call(PA, 'GET', '/v1/compliance/esign/adobe');
  assert.equal(g.json.connected, true); assert.equal(g.json.apiAccessPoint, API); assert.equal(g.json.canManage, false);
  assert.ok(!JSON.stringify(g.json).includes('tok-1'));
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/esign/adobe')).json.connected, false);
});

test('sending to Adobe locks the wording; a signed answer files the PDF and locks the record', async () => {
  const a = await mk(PA, 'beneficiary_designation');
  const none = await mk(PA, 'beneficiary_designation', { clientEmail: undefined });
  assert.equal((await call(PA, 'POST', `/v1/advice/${none.json.id}/esign`)).status, 422);
  const builtin = await mk(PA, 'needs_analysis');
  assert.equal((await call(PA, 'POST', `/v1/advice/${builtin.json.id}/esign`)).status, 409);
  assert.equal((await call(PB, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 404); // another partner cannot see it
  const s = await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`);
  assert.equal(s.status, 200); assert.equal(s.json.agreementId, 'AG-1');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 409); // already out
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${a.json.id}`, { body: 'changed after sending' })).status, 409);
  const open = await call(PA, 'POST', `/v1/advice/${a.json.id}/esign/check`);
  assert.deepEqual(open.json, { status: 'OUT_FOR_SIGNATURE', signed: false });
  agreementStatus = 'SIGNED';
  const done = await call(PA, 'POST', `/v1/advice/${a.json.id}/esign/check`);
  assert.deepEqual(done.json, { status: 'SIGNED', signed: true });
  const rec = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.id === a.json.id);
  assert.equal(rec.status, 'signed'); assert.equal(rec.signedMethod, 'vendor'); assert.equal(rec.vendorName, 'Adobe Acrobat Sign'); assert.equal(rec.vendorRef, 'AG-1');
  const docs = (await call(PA, 'GET', `/v1/boxes/${box}/documents`)).json.documents;
  assert.equal(docs.find((d: any) => d.id === rec.documentId).docType, 'beneficiary_designation');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign/check`)).status, 409); // nothing left out
  assert.ok(calls.some((c) => c.startsWith('POST /api/rest/v6/transientDocuments')));
  agreementStatus = 'OUT_FOR_SIGNATURE';
});

test('an expired token is renewed with the refresh token, and the background pass brings a signed document home', async () => {
  goodToken = 'tok-1'; calls.length = 0;
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/esign/adobe', { apiAccessPoint: API, clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' })).status, 200);
  assert.ok(calls.some((c) => c.includes('/oauth/v2/refresh')));
  assert.equal(goodToken, 'tok-2');
  const a = await mk(PA, 'replacement_disclosure');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 200);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  await o.query(`UPDATE esign_envelopes SET updated_at = now() - interval '1 hour' WHERE advice_id = $1`, [a.json.id]); await o.end();
  agreementStatus = 'SIGNED';
  const n = await sweepEsign({ config: undefined as any, appPool: pools[0]!, authPool: pools[1]!, authenticate: undefined as any, keys: localKeyProvider('0123456789abcdef0123'), fetchImpl: fakeAdobe });
  assert.equal(n, 1);
  const rec = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.id === a.json.id);
  assert.equal(rec.status, 'signed');
  agreementStatus = 'OUT_FOR_SIGNATURE';
});

test('a cancelled agreement frees the record to be sent again; disconnecting removes the sign-in', async () => {
  const a = await mk(PA, 'beneficiary_designation');
  goodToken = 'tok-2';
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 200);
  agreementStatus = 'CANCELLED';
  assert.deepEqual((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign/check`)).json, { status: 'CANCELLED', signed: false });
  agreementStatus = 'OUT_FOR_SIGNATURE';
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/esign`)).status, 200);
  assert.equal((await call(PA, 'DELETE', '/v1/compliance/esign/adobe')).status, 403);
  assert.equal((await call(ADMIN, 'DELETE', '/v1/compliance/esign/adobe')).status, 204);
  assert.equal((await call(ADMIN, 'GET', '/v1/compliance/esign/adobe')).json.connected, false);
});
