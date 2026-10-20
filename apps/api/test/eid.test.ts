// Electronic ID (Phase 2, feature 7): Stripe Identity and PII's own Gemini check. Only yes/no answers are kept, never
// the licence number, the photos, or the name and birth date as read; a verified check adds an ID record the gates count.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { compareWithRecord, fakeStripeIdentity, namesMatch, parseLicenceRead, stripeSignatureHeader, stripeSignatureOk } from '../src/eid.ts';
import { addBrokerFixture } from './support/broker.ts';

const SECRET = 'whsec_test_0123456789';
let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const stripe = fakeStripeIdentity('http://pii.test');
const seen: { images: number; user: string }[] = [];
let licence: Record<string, unknown> = {};
const gemini = { model: 'fake-gemini', complete: async () => '', see: async (i: { user: string; images: unknown[] }) => { seen.push({ images: i.images.length, user: i.user }); return JSON.stringify(licence); } };
const GOOD = { isDriversLicence: true, issuingRegion: 'CA-ON', fullName: 'SINGH, RAJ KUMAR', dateOfBirth: '1980-04-12', expiryDate: '2031-01-31', looksGenuine: true, selfieMatches: 'yes', concerns: [], licenceNumber: 'S1234-56789-01234' };

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
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@eid.test', P1U = 'p1@eid.test', P2U = 'p2@eid.test', COMP = 'comp@eid.test';
let box = '', raj = '', p2box = '';
const photo = (n = 4096) => ({ mime: 'image/jpeg', dataBase64: Buffer.alloc(n, 7).toString('base64') });
const ownCheck = (who: string, over: Record<string, unknown> = {}) => call(who, 'POST', `/v1/boxes/${box}/eid/own-check`, { contactId: raj, consentConfirmed: true, licence: photo(), selfie: photo(), ...over });
const rows = () => owner(async (c) => (await c.query('SELECT * FROM id_verifications ORDER BY created_at')).rows);
const webhook = (body: object, sig?: string) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url: '/v1/webhooks/stripe-identity', headers: { 'content-type': 'application/json', 'stripe-signature': sig ?? stripeSignatureHeader(raw, SECRET) }, payload: raw });
};

before(async () => {
  process.env.EID_ENABLED = '1';
  process.env.STRIPE_IDENTITY_WEBHOOK_SECRET = SECRET;
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), aiProviders: { gemini }, stripeIdentity: stripe });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'EID Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  p2box = (await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Sharma review' })).json.id;
  raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test' })).json.id;
  await owner(async (c) => {
    await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [box, raj, tenantId]);
    await c.query(`UPDATE contacts SET date_of_birth = '1980-04-12' WHERE id = $1`, [raj]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.EID_ENABLED; });

test('names, birth dates and expiry are compared; what was read is reduced to yes/no', () => {
  assert.ok(namesMatch('Raj Singh', 'SINGH, RAJ KUMAR'));
  assert.ok(namesMatch('Zoé Lévesque-Tremblay', 'ZOE LEVESQUE TREMBLAY'));
  assert.ok(!namesMatch('Raj Singh', 'Ravi Singh'));
  const read = parseLicenceRead('```json\n' + JSON.stringify(GOOD) + '\n```');
  assert.equal(JSON.stringify(read).includes('S1234'), false, 'a licence number the model wrote is dropped');
  const c = compareWithRecord(read, { fullName: 'Raj Singh', dob: '1980-04-12' }, '2026-10-21');
  assert.deepEqual(c.checks, { name_matches: true, dob_matches: true, not_expired: true, selfie_matches: true, looks_genuine: true });
  assert.deepEqual(c.reasons, []);
  const old = compareWithRecord({ ...read, expiry: '2025-01-01' }, { fullName: 'Raj Singh', dob: null }, '2026-10-21');
  assert.deepEqual(old.reasons, ['dob_missing_on_record', 'document_expired']);
  assert.equal(parseLicenceRead(JSON.stringify({ ...GOOD, fullName: 'RAJ 123456' })).fullName, null);
});

test('Stripe webhook signatures: right secret and recent time only', () => {
  const body = Buffer.from('{"a":1}');
  assert.ok(stripeSignatureOk(body, stripeSignatureHeader(body, SECRET), SECRET));
  assert.ok(!stripeSignatureOk(body, stripeSignatureHeader(body, 'whsec_other'), SECRET));
  assert.ok(!stripeSignatureOk(body, stripeSignatureHeader(body, SECRET, Math.floor(Date.now() / 1000) - 3600), SECRET));
  assert.ok(!stripeSignatureOk(Buffer.from('{"a":2}'), stripeSignatureHeader(body, SECRET), SECRET));
});

test('switched off by default; the company chooses its routes; only admin or compliance may', async () => {
  process.env.EID_ENABLED = '';
  assert.equal((await call(P1U, 'GET', '/v1/eid/settings')).status, 404);
  process.env.EID_ENABLED = '1';
  assert.equal((await ownCheck(P1U)).status, 503);
  assert.equal((await call(P1U, 'PUT', '/v1/eid/settings', { stripeEnabled: true, ownCheckEnabled: true, redactAtStripe: true })).status, 403);
  const s = await call(COMP, 'PUT', '/v1/eid/settings', { stripeEnabled: true, ownCheckEnabled: true, redactAtStripe: true });
  assert.equal(s.status, 200, s.raw);
  assert.equal(s.json.stripeOn, true);
  assert.equal(s.json.ownCheckOn, true);
});

test('own check: consent and photos only, the editor only, a client on the deal only; photos alone go to Gemini', async () => {
  licence = GOOD;
  assert.match((await ownCheck(P1U, { consentConfirmed: false })).json.error.message, /agreed to this ID check/);
  assert.equal((await ownCheck(P1U, { licence: { mime: 'application/pdf', dataBase64: 'AAAA' } })).status, 422);
  assert.equal((await ownCheck(P2U)).status, 404, 'a sibling partner cannot see the deal');
  assert.equal((await ownCheck(COMP)).status, 403, 'compliance cannot start a check on a partner\'s deal');
  const stranger = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Not On Deal' })).json.id;
  assert.equal((await ownCheck(P1U, { contactId: stranger })).status, 422);
  assert.equal(seen.length, 0, 'nothing went to Gemini');
  const r = await ownCheck(P1U);
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.allClear, true);
  assert.equal(r.json.read.fullName, 'SINGH, RAJ KUMAR');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.images, 2);
  assert.ok(!/Raj|1980/.test(seen[0]!.user), 'no client record data goes to Gemini');
  // Kept: yes/no answers only, nothing read from the card.
  const [v] = await rows();
  assert.equal(v.status, 'needs_confirmation');
  assert.deepEqual(v.checks, { name_matches: true, dob_matches: true, not_expired: true, selfie_matches: true, looks_genuine: true });
  const all = JSON.stringify(await owner(async (c) => (await c.query('SELECT * FROM id_verifications')).rows));
  assert.ok(!/S1234|SINGH|1980-04-12|2031/.test(all), all);
  assert.equal((await ownCheck(P1U)).status, 409, 'one open check per client');
});

test('the uploader confirms: all clear becomes an electronic ID record the gates count', async () => {
  const [v] = await rows();
  assert.equal((await call(P1U, 'POST', `/v1/eid/${v.id}/confirm`, { lookedAtPhotos: false })).status, 422);
  const r = await call(P1U, 'POST', `/v1/eid/${v.id}/confirm`, { lookedAtPhotos: true });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.status, 'verified');
  const aml = await call(P1U, 'GET', `/v1/boxes/${box}/aml`);
  assert.equal(aml.json.status.idVerified, true);
  assert.equal(aml.json.idRecords[0].method, 'electronic');
  assert.match(aml.json.idRecords[0].documentsSeen[0], /Driver's licence \(CA-ON\) and selfie, PII electronic check/);
  // Nobody can type an "electronic" record by hand.
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/id-records`, { method: 'electronic', result: 'verified', documentsSeen: ['x'] })).status, 400);
  // A finished check cannot be changed, even straight in the database (the trigger runs for every role).
  await assert.rejects(owner((c) => c.query(`UPDATE id_verifications SET status = 'failed' WHERE id = $1`, [v.id])), /finished ID check/);
  // The app's database role cannot delete a check or change who asked for it.
  for (const sql of ['DELETE FROM id_verifications', `UPDATE id_verifications SET requested_by_name = 'x'`]) {
    await assert.rejects(owner(async (c) => { try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_runtime'); await c.query(sql); } finally { await c.query('ROLLBACK'); } }), /permission denied/);
  }
});

test('a mismatch goes to compliance, who decide with a note', async () => {
  licence = { ...GOOD, dateOfBirth: '1979-01-01' };
  const r = await ownCheck(P1U);
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.allClear, false);
  assert.deepEqual(r.json.reasons, ['dob_mismatch']);
  assert.equal((await call(P1U, 'POST', `/v1/eid/${r.json.id}/confirm`, { lookedAtPhotos: true })).json.status, 'needs_review');
  assert.equal((await call(P1U, 'POST', `/v1/eid/${r.json.id}/review`, { decision: 'verified', note: 'Looks fine to me honestly' })).status, 403);
  assert.equal((await call(COMP, 'POST', `/v1/eid/${r.json.id}/review`, { decision: 'verified', note: 'Licence 1234567 checked' })).status, 422);
  const d = await call(COMP, 'POST', `/v1/eid/${r.json.id}/review`, { decision: 'failed', note: 'Birth date on the licence does not match the file; ask for passport.' });
  assert.equal(d.status, 200, d.raw);
  const v = (await rows()).at(-1);
  assert.equal(v.status, 'failed');
  assert.match(v.decided_by_name, /comp/);
});

test('Stripe: a link per client, a signed webhook, an ID record, and Stripe asked to delete its copy', async () => {
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${box}/eid/stripe`, { contactId: raj })).status, 404);
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/eid/stripe`, { contactId: raj });
  assert.equal(r.status, 201, r.raw);
  assert.match(r.json.url, /^http:\/\/pii\.test\/dev\/stripe-identity\/vs_fake/);
  const sid = r.json.url.split('/').pop();
  const meta = stripe.metadata.get(sid)!;
  assert.deepEqual(Object.keys(meta).sort(), ['requested_by', 'tenant_id', 'verification_id'], 'Stripe gets no client data from PII');
  const event = { type: 'identity.verification_session.verified', data: { object: { object: 'identity.verification_session', id: sid, metadata: meta } } };
  assert.equal((await webhook(event, 't=1,v1=00')).statusCode, 400, 'unsigned webhooks are refused');
  stripe.finish(sid, { status: 'verified', documentType: 'drivers_licence', issuingCountry: 'CA', firstName: 'Raj', lastName: 'Singh', dob: '1980-04-12', expiry: '2030-06-30', selfieVerified: true, documentVerified: true });
  const w = await webhook(event);
  assert.equal(w.statusCode, 200, w.body);
  assert.equal(JSON.parse(w.body).result, 'verified');
  assert.equal(JSON.parse((await webhook(event)).body).result, 'unchanged', 'a repeated webhook changes nothing');
  const v = (await rows()).at(-1);
  assert.equal(v.status, 'verified');
  assert.ok(v.redacted_at_stripe, 'Stripe was asked to delete its copy');
  assert.equal(stripe.sessions.get(sid)!.firstName, null);
  const recs = await owner(async (c) => (await c.query(`SELECT verifier_name, documents_seen FROM client_id_records WHERE verification_id = $1`, [v.id])).rows);
  assert.match(recs[0].verifier_name, /^Stripe Identity \(requested by/);
});

test('Stripe: the client must retry, or the link is cancelled', async () => {
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/eid/stripe`, { contactId: raj });
  const sid = r.json.url.split('/').pop();
  stripe.finish(sid, { status: 'requires_input', errorCode: 'selfie_face_mismatch' });
  const w = await webhook({ type: 'identity.verification_session.requires_input', data: { object: { object: 'identity.verification_session', id: sid, metadata: stripe.metadata.get(sid) } } });
  assert.equal(JSON.parse(w.body).result, 'needs_input');
  assert.deepEqual((await rows()).at(-1).reasons, ['stripe:selfie_face_mismatch']);
  assert.equal((await call(P1U, 'POST', `/v1/eid/${r.json.id}/cancel`)).json.status, 'canceled');
  assert.equal(stripe.sessions.get(sid)!.status, 'canceled');
  const list = await call(P1U, 'GET', `/v1/boxes/${box}/eid`);
  assert.equal(list.json.checks.length, 4);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${p2box}/eid`)).json.checks.length, 0);
});
