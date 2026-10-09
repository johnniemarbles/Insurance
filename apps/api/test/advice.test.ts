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
const ADMIN = 'admin@ad.test', PA = 'pa@ad.test', PB = 'pb@ad.test', OTHER = 'other@ad.test';
let box = '';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const mk = (who: string, kind: string, extra: object = {}) => call(who, 'POST', `/v1/boxes/${box}/advice`, { kind, title: 'Needs analysis 2026', body: 'Client needs 20-year term cover for a mortgage.', clientName: 'Rita Client', clientEmail: 'rita@client.test', ...extra });

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
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  box = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Advice client' })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the built-in signature: code to the client, wrong codes refused, the right code seals and files a typed copy', async () => {
  const a = await mk(PA, 'needs_analysis');
  assert.equal(a.status, 201); assert.equal(a.json.tier, 'builtin');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/confirm`, { code: '123456' })).status, 409, 'no code sent yet');
  const sent = await call(PA, 'POST', `/v1/advice/${a.json.id}/send-code`);
  assert.equal(sent.status, 200);
  const wrong = sent.json.devCode === '000000' ? '111111' : '000000';
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/confirm`, { code: wrong })).status, 422);
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${a.json.id}`, { body: 'changed' })).status, 409, 'wording is fixed once a code is out');
  const ok = await call(PA, 'POST', `/v1/advice/${a.json.id}/confirm`, { code: sent.json.devCode });
  assert.equal(ok.status, 200); assert.ok(ok.json.documentId);
  const list = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice;
  assert.equal(list[0].status, 'signed'); assert.equal(list[0].signedMethod, 'otp'); assert.match(list[0].contentHash, /^[0-9a-f]{64}$/);
  const docs = (await call(PA, 'GET', `/v1/boxes/${box}/documents`)).json.documents;
  assert.ok(docs.some((d: any) => d.docType === 'needs_analysis'), 'the signed copy counts as typed paperwork');
  assert.ok(!(await call(PA, 'GET', `/v1/boxes/${box}/timeline`)).json.items.some((i: any) => i.kind === 'compliance'), 'older clients do not get the new kind');
  const feed = (await call(PA, 'GET', `/v1/boxes/${box}/timeline?include=compliance`)).json.items.filter((i: any) => i.kind === 'compliance').map((i: any) => i.text);
  for (const e of ['advice_created', 'advice_signed', 'doc_filed']) assert.ok(feed.includes(e), `the record's activity shows ${e}`);
});

test('a signed record cannot be edited or removed, even straight in the database', async () => {
  const signed = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.status === 'signed');
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${signed.id}`, { title: 'x' })).status, 409);
  assert.equal((await call(PA, 'DELETE', `/v1/advice/${signed.id}`)).status, 409);
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  await assert.rejects(o.query(`UPDATE advice_records SET body = 'tampered' WHERE id = $1`, [signed.id]), /cannot be changed/);
  await assert.rejects(o.query(`DELETE FROM advice_records WHERE id = $1`, [signed.id]), /cannot be changed/);
  await o.end();
});

test('five wrong codes lock the code; a new one can be sent', async () => {
  const a = (await mk(PA, 'recommendation')).json.id;
  const s = (await call(PA, 'POST', `/v1/advice/${a}/send-code`)).json.devCode;
  const bad = s === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call(PA, 'POST', `/v1/advice/${a}/confirm`, { code: bad })).status, 422);
  assert.equal((await call(PA, 'POST', `/v1/advice/${a}/confirm`, { code: s })).status, 429);
  const s2 = (await call(PA, 'POST', `/v1/advice/${a}/send-code`)).json.devCode;
  assert.equal((await call(PA, 'POST', `/v1/advice/${a}/confirm`, { code: s2 })).status, 200);
});

test('beneficiary paperwork needs the vendor tier: no code route, vendor signature recorded with the completed document', async () => {
  const a = await mk(PA, 'beneficiary_designation');
  assert.equal(a.json.tier, 'vendor');
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/send-code`)).status, 409);
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/vendor-signed`, { vendorName: 'DocuSign', vendorRef: 'ENV-123', documentId: '00000000-0000-4000-8000-000000000000' })).status, 422);
  const up = await call(PA, 'POST', `/v1/boxes/${box}/documents`, { name: 'bene.pdf', mime: 'application/pdf', dataBase64: PDF });
  const r = await call(PA, 'POST', `/v1/advice/${a.json.id}/vendor-signed`, { vendorName: 'DocuSign', vendorRef: 'ENV-123', documentId: up.json.id });
  assert.equal(r.status, 200);
  const docs = (await call(PA, 'GET', `/v1/boxes/${box}/documents`)).json.documents;
  assert.equal(docs.find((d: any) => d.id === up.json.id).docType, 'beneficiary_designation');
});

test('drafts can be edited and removed; other partners and other companies cannot see or touch them', async () => {
  const a = (await mk(PA, 'recommendation')).json.id;
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${a}`, { body: 'Revised advice.' })).status, 204);
  assert.equal((await call(PB, 'PATCH', `/v1/advice/${a}`, { body: 'x' })).status, 404);
  assert.equal((await call(OTHER, 'GET', `/v1/boxes/${box}/advice`)).status, 404);
  assert.equal((await call(PA, 'DELETE', `/v1/advice/${a}`)).status, 204);
  assert.equal((await mk(PA, 'recommendation', { clientEmail: 'nope' })).status, 400);
});

test('the client signing link: read, get a code, sign with a typed name, and the sealed PDF is filed', async () => {
  const a = (await mk(PA, 'needs_analysis', { title: 'Needs analysis via link' })).json.id;
  assert.equal((await call(PB, 'POST', `/v1/advice/${a}/signing-link`)).status, 404);
  const link = await call(PA, 'POST', `/v1/advice/${a}/signing-link`);
  assert.equal(link.status, 200); assert.match(link.json.url, /\/sign\/[A-Za-z0-9_-]{20,}$/);
  const token = link.json.url.split('/').pop();
  const page = await app.inject({ method: 'GET', url: `/sign/${token}` });
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-security-policy'] as string, /script-src 'nonce-/);
  const pub = await app.inject({ method: 'GET', url: `/v1/public/sign/${token}` });
  assert.equal(pub.statusCode, 200);
  const view = JSON.parse(pub.body);
  assert.equal(view.title, 'Needs analysis via link'); assert.equal(view.signed, false); assert.match(view.emailHint, /^r\*\*\*@client\.test$/);
  assert.equal((await app.inject({ method: 'GET', url: `/v1/public/sign/${'x'.repeat(30)}` })).statusCode, 404);
  const post = (path: string, body: object) => app.inject({ method: 'POST', url: `/v1/public/sign/${token}${path}`, payload: body });
  assert.equal((await post('/confirm', { code: '123456', typedName: 'Rita Client', agree: true })).statusCode, 409, 'no code yet');
  const code = JSON.parse((await post('/code', {})).body).devCode;
  assert.equal((await post('/confirm', { code: code === '000000' ? '111111' : '000000', typedName: 'Rita Client', agree: true })).statusCode, 422);
  assert.equal((await post('/confirm', { code, typedName: 'R', agree: true })).statusCode, 400, 'a name is required');
  assert.equal((await post('/confirm', { code, typedName: 'Rita Client', agree: false })).statusCode, 400, 'agreement is required');
  assert.equal((await post('/confirm', { code, typedName: 'Rita Client', agree: true })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/v1/public/sign/${token}` })).statusCode, 404, 'the link is spent');
  const row = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.id === a);
  assert.equal(row.status, 'signed');
  const docs = (await call(PA, 'GET', `/v1/boxes/${box}/documents`)).json.documents;
  const pdf = docs.find((d: any) => d.name.startsWith('Needs analysis via link'));
  assert.equal(pdf.mime, 'application/pdf'); assert.equal(pdf.docType, 'needs_analysis');
  const dl = (await call(PA, 'GET', `/v1/documents/${pdf.id}`)).json;
  assert.equal(Buffer.from(dl.dataBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const r = (await o.query(`SELECT signer_typed_name, document_sha256 FROM advice_records WHERE id = $1`, [a])).rows[0];
  await o.end();
  assert.equal(r.signer_typed_name, 'Rita Client'); assert.match(r.document_sha256, /^[0-9a-f]{64}$/);
});

test('a new link replaces the old one, vendor-tier paperwork gets no link, and five wrong codes lock the code', async () => {
  const a = (await mk(PA, 'recommendation', { title: 'Link two' })).json.id;
  const t1 = (await call(PA, 'POST', `/v1/advice/${a}/signing-link`)).json.url.split('/').pop();
  const t2 = (await call(PA, 'POST', `/v1/advice/${a}/signing-link`)).json.url.split('/').pop();
  assert.equal((await app.inject({ method: 'GET', url: `/v1/public/sign/${t1}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/v1/public/sign/${t2}` })).statusCode, 200);
  const post = (path: string, body: object) => app.inject({ method: 'POST', url: `/v1/public/sign/${t2}${path}`, payload: body });
  const code = JSON.parse((await post('/code', {})).body).devCode; const bad = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await post('/confirm', { code: bad, typedName: 'Rita Client', agree: true })).statusCode, 422);
  assert.equal((await post('/confirm', { code, typedName: 'Rita Client', agree: true })).statusCode, 429);
  const v = (await mk(PA, 'beneficiary_designation')).json.id;
  assert.equal((await call(PA, 'POST', `/v1/advice/${v}/signing-link`)).status, 409);
});

test('signing vendors: everyone sees the catalogue, only admin or compliance choose, a vendor that is off is refused, the chosen id is kept', async () => {
  const list = await call(PA, 'GET', '/v1/compliance/signing-vendors');
  assert.equal(list.status, 200);
  assert.equal(list.json.vendors.length, 8);
  assert.equal(list.json.restricted, false);
  assert.ok(list.json.vendors.every((v: any) => v.enabled && v.connected === false));
  assert.equal(list.json.canManage, false);
  assert.equal((await call(PA, 'PUT', '/v1/compliance/signing-vendors/docusign', { enabled: true })).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/signing-vendors/nope', { enabled: true })).status, 400);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/signing-vendors/onespan', { enabled: true, note: 'Acct 77' })).status, 204);
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/signing-vendors/notarius', { enabled: true })).status, 204);
  const after = (await call(PA, 'GET', '/v1/compliance/signing-vendors')).json;
  assert.equal(after.restricted, true);
  assert.deepEqual(after.vendors.filter((v: any) => v.enabled).map((v: any) => v.id).sort(), ['notarius', 'onespan']);
  assert.equal(after.vendors.find((v: any) => v.id === 'onespan').note2, 'Acct 77');
  // another company is not affected
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/signing-vendors')).json.restricted, false);
  const a = await mk(PA, 'beneficiary_designation');
  const up = await call(PA, 'POST', `/v1/boxes/${box}/documents`, { name: 'bene2.pdf', mime: 'application/pdf', dataBase64: PDF });
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/vendor-signed`, { vendorId: 'docusign', vendorRef: 'E1', documentId: up.json.id })).status, 422);
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/vendor-signed`, { vendorRef: 'E1', documentId: up.json.id })).status, 422);
  const ok = await call(PA, 'POST', `/v1/advice/${a.json.id}/vendor-signed`, { vendorId: 'onespan', vendorRef: 'E1', documentId: up.json.id });
  assert.equal(ok.status, 200);
  const rec = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.id === a.json.id);
  assert.equal(rec.vendorName, 'OneSpan Sign');
  assert.equal((await call(ADMIN, 'PUT', '/v1/compliance/signing-vendors/onespan', { enabled: false })).status, 204);
});
