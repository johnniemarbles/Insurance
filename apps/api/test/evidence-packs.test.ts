// Network evidence packs (Phase 3, feature 13): one ZIP per partner, carrier or regulator request, with registers,
// partner files and client files, a SHA-256 manifest, and a record of every pack PII issued.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { unzipSync, strFromU8 } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function seedUser(email: string, home: string, role: string) {
  await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status,display_name) VALUES ($1,$2,$3,'active',$4) RETURNING id`, [tenantId, email, home, email.split('@')[0]])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@ep.test', P1U = 'p1@ep.test', P2U = 'p2@ep.test', COMP = 'comp@ep.test', COMPY = 'compy@ep.test';
let P1 = '', box1 = '', box2 = '', other = '';
const today = new Date().toISOString().slice(0, 10);
const open = (b64: string) => unzipSync(new Uint8Array(Buffer.from(b64, 'base64')));

before(async () => {
  process.env.EVIDENCE_PACKS_ENABLED = '1';
  process.env.CONDUCT_FLAGS_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'EP Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const Y = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, Y, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  await seedUser(COMPY, Y, 'compliance');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  box1 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  box2 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Gill family term' })).json.id;
  other = (await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Toronto deal' })).json.id;
  await call(P1U, 'POST', `/v1/boxes/${box1}/documents`, { name: 'needs.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 needs').toString('base64') });
  await call(P1U, 'POST', `/v1/boxes/${box1}/complaints`, { receivedOn: today, channel: 'email', category: 'service', summary: 'Client waited two weeks for a reply.' });
  await call(P2U, 'POST', `/v1/boxes/${other}/complaints`, { receivedOn: today, channel: 'phone', category: 'advice', summary: 'Toronto complaint, not Surrey.' });
  const raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test' })).json.id;
  await owner(async (c) => {
    await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [box2, raj, tenantId]);
    const pid = (await c.query(`INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents, modal_premium_cents, premium_frequency, status, effective_date)
      VALUES ($1,$2,$3,'manulife','EP-1','Term 20','BC',120000,10000,'monthly','active',current_date - 30) RETURNING id`, [tenantId, X, P1])).rows[0].id;
    await c.query(`INSERT INTO policy_parties (tenant_id, policy_id, contact_id, role) VALUES ($1,$2,$3,'owner')`, [tenantId, pid, raj]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.EVIDENCE_PACKS_ENABLED; delete process.env.CONDUCT_FLAGS_ENABLED; });

test('switched off: 404; compliance only', async () => {
  process.env.EVIDENCE_PACKS_ENABLED = '';
  assert.equal((await call(COMP, 'GET', '/v1/evidence-packs/options')).status, 404);
  process.env.EVIDENCE_PACKS_ENABLED = '1';
  assert.equal((await call(P1U, 'GET', '/v1/evidence-packs/options')).status, 403);
  const o = await call(COMP, 'GET', '/v1/evidence-packs/options');
  assert.deepEqual(o.json.partners.map((p: { name: string }) => p.name), ['Partner One']);
  assert.deepEqual(o.json.carriers.map((c: { id: string }) => c.id), ['manulife']);
});

test('a partner pack: registers, the partner file, every client file, a manifest that checks out, and a record', async () => {
  const r = await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'partner', partnerId: P1, from: '2026-01-01', to: today });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.deals, 2);
  const z = open(r.json.dataBase64);
  const names = Object.keys(z).sort();
  assert.ok(names.includes('README.txt') && names.includes('manifest.json'));
  assert.equal(names.filter((n) => n.startsWith('deals/')).length, 2);
  assert.equal(names.filter((n) => n.startsWith('partners/')).length, 1);
  const complaints = strFromU8(z['registers/complaints.csv']!);
  assert.match(complaints, /Client waited two weeks/);
  assert.ok(!complaints.includes('Toronto complaint'), 'another branch\'s complaint is not in a Surrey partner pack');
  // Every file matches its manifest hash, and the fingerprint is the manifest's own hash.
  const manifest = JSON.parse(strFromU8(z['manifest.json']!));
  for (const f of manifest.files) assert.equal(sha(z[f.path]!), f.sha256, f.path);
  assert.equal(sha(z['manifest.json']!), r.json.fingerprint);
  // The deal inside is a full audit package with the document.
  const inner = unzipSync(z[names.find((n) => n.startsWith('deals/') && n.includes('Singh'))!]!);
  assert.ok(Object.keys(inner).some((n) => n.endsWith('needs.pdf')));
  // PII recorded it, and can confirm it later; a changed manifest is not recognised.
  assert.equal((await call(COMP, 'POST', '/v1/evidence-packs/verify', { fingerprint: r.json.fingerprint })).json.issued, true);
  assert.equal((await call(COMP, 'POST', '/v1/evidence-packs/verify', { fingerprint: sha('tampered') })).json.issued, false);
  const hist = (await call(COMP, 'GET', '/v1/evidence-packs/options')).json.history;
  assert.equal(hist[0].manifestSha256, r.json.fingerprint);
  await assert.rejects(owner(async (c) => { try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_runtime'); await c.query(`DELETE FROM evidence_packs`); } finally { await c.query('ROLLBACK'); } }), /permission denied/);
});

test('another branch cannot export this partner; a carrier pack follows the carrier\'s policies', async () => {
  assert.equal((await call(COMPY, 'POST', '/v1/evidence-packs', { scope: 'partner', partnerId: P1, from: '2026-01-01', to: today })).status, 404);
  const c = await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'carrier', carrierId: 'manulife', from: '2026-01-01', to: today });
  assert.equal(c.status, 200, c.raw);
  const names = Object.keys(open(c.json.dataBase64));
  assert.equal(c.json.deals, 1, 'the deal whose client owns a Manulife policy');
  assert.ok(names.some((n) => n.startsWith('deals/') && n.includes('Gill')));
  assert.equal(names.filter((n) => n.startsWith('partners/')).length, 1);
});

test('a regulator pack needs the request reference and can include chosen deals', async () => {
  assert.equal((await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'regulator', from: '2026-01-01', to: today })).status, 422);
  const r = await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'regulator', requestReference: 'FSRA-2026-0412', from: '2026-01-01', to: today, dealIds: [box1] });
  assert.equal(r.status, 200, r.raw);
  const z = open(r.json.dataBase64);
  assert.match(strFromU8(z['README.txt']!), /Request reference: FSRA-2026-0412/);
  assert.equal(Object.keys(z).filter((n) => n.startsWith('deals/')).length, 1);
  assert.equal((await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'regulator', requestReference: 'X', from: '2026-01-01', to: today, dealIds: [other] })).status, 404, 'a deal outside the exporter\'s access');
  // Deals can be named as they appear in PII; a name the exporter cannot see is refused.
  const n = await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'regulator', requestReference: 'FSRA-2026-0413', from: '2026-01-01', to: today, dealNames: ['Singh life review', ' Gill family term '] });
  assert.equal(n.status, 200, n.raw);
  assert.equal(n.json.deals, 2);
  const bad = await call(COMP, 'POST', '/v1/evidence-packs', { scope: 'regulator', requestReference: 'X', from: '2026-01-01', to: today, dealNames: ['Toronto deal'] });
  assert.equal(bad.status, 422);
  assert.match(bad.json.message ?? bad.raw, /Toronto deal/);
});
