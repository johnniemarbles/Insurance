import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { NEEDS_FULL } from './support/advice.ts';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

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
const ADMIN = 'admin@ap.test', PA = 'pa@ap.test', PB = 'pb@ap.test', OTHER = 'other@ap.test';
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
  const NA = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner A');
  const NB = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner B');
  await seedUser(co.tenantId, PA, NA, 'partner'); await seedUser(co.tenantId, PB, NB, 'partner');
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  await seedUser(co.tenantId, COMP, BR, 'compliance');
  box = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Package client' })).json.id;
  const st = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages; sNew = st[0].id; sBound = st[1].id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

/** Reads a stored-method ZIP back: name -> bytes. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nl;
  }
  return out;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const COMP = 'comp@ap.test';

test('the client file package holds the ledger, the documents as stored, the audit entries and a matching manifest', async () => {
  await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['privacy_consent', 'id_record'] });
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/documents`, { name: 'consent.pdf', mime: 'application/pdf', dataBase64: PDF, docType: 'privacy_consent' })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/id-records`, { method: 'credit_file', result: 'verified' })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/cash`, { amount: 12000, occurredOn: '2026-10-02' })).status, 201);
  const a = (await call(PA, 'POST', `/v1/boxes/${box}/advice`, { kind: 'needs_analysis', title: 'Term cover', body: 'Twenty year term.', clientName: 'Rita', clientEmail: 'r@c.test', answers: NEEDS_FULL })).json.id;
  assert.ok(a);

  assert.equal((await call(PA, 'GET', `/v1/boxes/${box}/audit-package`)).status, 403, 'a producer cannot export');
  const r = await call(ADMIN, 'GET', `/v1/boxes/${box}/audit-package`);
  assert.equal(r.status, 200); assert.match(r.json.filename, /audit-package\.zip$/); assert.equal(r.json.mime, 'application/zip');
  const files = unzip(Buffer.from(r.json.dataBase64, 'base64'));
  for (const n of ['README.txt', 'summary.pdf', 'ledger.csv', 'audit-log.csv', 'manifest.json']) assert.ok(files.has(n), n);
  assert.equal(files.get('summary.pdf')!.subarray(0, 5).toString(), '%PDF-');
  const doc = [...files.keys()].find((k) => k.startsWith('files/') && k.endsWith('consent.pdf'))!;
  assert.ok(doc, 'the uploaded document is in the package');
  assert.equal(files.get(doc)!.toString(), Buffer.from(PDF, 'base64').toString(), 'and is the original, decrypted');
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  for (const f of manifest.files) assert.equal(sha(files.get(f.path)!), f.sha256, `${f.path} matches its fingerprint`);
  const ledger = files.get('ledger.csv')!.toString();
  assert.match(ledger, /Privacy consent,on file/); assert.match(ledger, /Client ID record,on file/); assert.match(ledger, /Term cover/); assert.match(ledger, /12000/);
  assert.match(files.get('audit-log.csv')!.toString(), /document_added/);
  // the export itself is audited
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  assert.ok((await o.query(`SELECT 1 FROM audit_log WHERE action = 'audit_package_exported' AND entity_id = $1`, [box])).rowCount);
  await o.end();
});

test('a missing document shows as MISSING, and another company cannot export this file', async () => {
  const b2 = (await call(PA, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Thin file' })).json.id;
  const files = unzip(Buffer.from((await call(ADMIN, 'GET', `/v1/boxes/${b2}/audit-package`)).json.dataBase64, 'base64'));
  assert.match(files.get('ledger.csv')!.toString(), /Privacy consent,MISSING/);
  assert.equal((await call(OTHER, 'GET', `/v1/boxes/${box}/audit-package`)).status, 404);
});

test('the producer package lists licences and E&O and is limited to administrators and compliance', async () => {
  const NA = (await call(ADMIN, 'GET', '/v1/compliance/partners')).json.partners.find((p: any) => p.name === 'Partner A').id;
  await call(ADMIN, 'POST', `/v1/compliance/partners/${NA}/items`, { kind: 'licence', label: 'Life licence', lines: ['life'], jurisdiction: 'ON', expiresOn: '2027-12-31' });
  assert.equal((await call(PA, 'GET', `/v1/compliance/partners/${NA}/audit-package`)).status, 403);
  const r = await call(ADMIN, 'GET', `/v1/compliance/partners/${NA}/audit-package`);
  assert.equal(r.status, 200);
  const files = unzip(Buffer.from(r.json.dataBase64, 'base64'));
  assert.match(files.get('ledger.csv')!.toString(), /Life licence/);
  assert.equal((await call(OTHER, 'GET', `/v1/compliance/partners/${NA}/audit-package`)).status, 404);
});
