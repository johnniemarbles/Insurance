// Client self-intake (Phase 2, feature 6): a private link per client, answers saved as they go, documents onto the deal,
// consents recorded when the client submits with an email code and typed name, and nothing on the file changes until
// the advisor applies it (contact details, a draft needs analysis).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { cleanIntake, contactChanges, missingForSubmit } from '../src/intake.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const mail: { to: string; subject: string; text: string }[] = [];

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function pub(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body && res.headers['content-type']?.toString().includes('json') ? (JSON.parse(res.body) as any) : null, raw: res.body, headers: res.headers };
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
const ADMIN = 'admin@in.test', P1U = 'p1@in.test', P2U = 'p2@in.test';
let box = '', raj = '', noEmail = '', token = '', intakeId = '';
const ANSWERS = { about: { legalName: 'Raj Kumar Singh', dateOfBirth: '1980-04-12', phone: '604-555-0199', preferredLanguage: 'fr', occupation: 'Engineer', sin: '123 456 789' },
  situation: { maritalStatus: 'married', dependants: 2, annualIncome: '90,000', mortgage: 300000, objectives: ['income_replacement', 'education', 'hacking'], monthlyBudget: 150, notAField: 'x' } };

before(async () => {
  process.env.INTAKE_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true', APP_ORIGIN: 'https://pii.test' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'),
    mailer: { send: async (m: { to: string; subject: string; text: string }) => { mail.push(m); } } as never });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Intake Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test', phone: '604-555-0101' })).json.id;
  noEmail = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Simran Singh' })).json.id;
  await owner((c) => c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$4), ($1,$3,$4)', [box, raj, noEmail, tenantId]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.INTAKE_ENABLED; });

test('answers are checked against the question list; anything else is dropped', () => {
  const a = cleanIntake(ANSWERS, ['about', 'situation']);
  assert.equal((a.about as Record<string, unknown>).sin, undefined, 'no field for a SIN, so it is dropped');
  assert.equal(a.situation!.annualIncome, 90000);
  assert.deepEqual(a.situation!.objectives, ['income_replacement', 'education']);
  assert.equal((a.situation as Record<string, unknown>).notAField, undefined);
  assert.equal(cleanIntake(ANSWERS, ['about']).situation, undefined, 'a section not asked is not kept');
  assert.deepEqual(missingForSubmit(cleanIntake({ about: {} }, ['about', 'consents']), ['about', 'consents'], []), ['about.legalName', 'about.dateOfBirth', 'consents.collection_use']);
  assert.deepEqual(contactChanges(a, { full_name: 'Raj Singh', phone: '604-555-0101', date_of_birth: null, preferred_language: 'en' }).map((c) => c.field), ['phone', 'dateOfBirth', 'preferredLanguage']);
});

test('the advisor sends a link: switch, editor only, a client on the deal with an email', async () => {
  process.env.INTAKE_ENABLED = '';
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}/intakes`)).status, 404);
  process.env.INTAKE_ENABLED = '1';
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${box}/intakes`, { contactId: raj, sections: ['situation'] })).status, 404);
  assert.match((await call(P1U, 'POST', `/v1/boxes/${box}/intakes`, { contactId: noEmail, sections: ['situation'] })).json.error.message, /email address/);
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/intakes`, { contactId: raj, sections: ['situation', 'consents', 'documents'] });
  assert.equal(r.status, 201, r.raw);
  assert.match(r.json.url, /^https:\/\/pii\.test\/intake\/[A-Za-z0-9_-]{30,}$/);
  assert.equal(r.json.emailed, true);
  assert.equal(mail.at(-1)!.to, 'raj@client.test');
  token = r.json.url.split('/').pop(); intakeId = r.json.id;
  // The link is stored only as a hash.
  const raw = JSON.stringify(await owner(async (c) => (await c.query('SELECT * FROM intake_links')).rows));
  assert.ok(!raw.includes(token));
  // A second link for the same client replaces the first.
  const again = await call(P1U, 'POST', `/v1/boxes/${box}/intakes`, { contactId: raj, sections: ['situation', 'consents', 'documents'] });
  assert.equal((await pub('GET', `/v1/public/intake/${token}`)).status, 404, 'the old link stops working');
  token = again.json.url.split('/').pop(); intakeId = again.json.id;
  const list = await call(P1U, 'GET', `/v1/boxes/${box}/intakes`);
  assert.deepEqual(list.json.intakes.map((i: { status: string }) => i.status), ['sent', 'canceled']);
});

test('the client\'s page: private, no outside resources; loading, saving and uploading', async () => {
  const page = await pub('GET', `/intake/${token}`);
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.ok(!/https?:\/\//.test(page.raw.replace(/https?:\/\/[^'"\s]*pii\.test/g, '')), 'no outside resources');
  const d = await pub('GET', `/v1/public/intake/${token}`);
  assert.equal(d.status, 200, d.raw);
  assert.equal(d.json.firstName, 'Raj');
  assert.equal(d.json.emailHint, 'r***@client.test');
  const s = await pub('POST', `/v1/public/intake/${token}/save`, { answers: ANSWERS, consents: ['collection_use', 'electronic_comms'] });
  assert.equal(s.status, 200, s.raw);
  assert.deepEqual(s.json.missing, []);
  const doc = await pub('POST', `/v1/public/intake/${token}/document`, { name: 'policy.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') });
  assert.equal(doc.status, 201, doc.raw);
  assert.equal((await pub('POST', `/v1/public/intake/${token}/document`, { name: 'run.exe', mime: 'application/x-msdownload', dataBase64: 'TVqQ' })).status, 422);
  const row = await owner(async (c) => (await c.query('SELECT status, answers, consents FROM client_intakes WHERE id = $1', [intakeId])).rows[0]);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.answers.about.sin, undefined);
  // Nothing on the file has changed yet.
  const c = await owner(async (q) => (await q.query('SELECT phone, date_of_birth FROM contacts WHERE id = $1', [raj])).rows[0]);
  assert.deepEqual(c, { phone: '604-555-0101', date_of_birth: null });
  assert.equal((await owner(async (q) => (await q.query('SELECT count(*)::int AS n FROM client_consents WHERE box_id = $1', [box])).rows[0].n)), 0);
});

test('submitting needs the emailed code and a typed name; consents are recorded then', async () => {
  assert.equal((await pub('POST', `/v1/public/intake/${token}/submit`, { code: '000000', typedName: 'Raj Singh', agree: true })).status, 409, 'ask for a code first');
  const code = await pub('POST', `/v1/public/intake/${token}/code`, {});
  assert.equal(code.status, 200, code.raw);
  assert.equal(mail.at(-1)!.to, 'raj@client.test');
  const wrongCode = code.json.devCode === '000000' ? '111111' : '000000';
  assert.equal((await pub('POST', `/v1/public/intake/${token}/submit`, { code: wrongCode, typedName: 'Raj Singh', agree: true })).status, 422);
  const ok = await pub('POST', `/v1/public/intake/${token}/submit`, { code: code.json.devCode, typedName: 'Raj Kumar Singh', agree: true });
  assert.equal(ok.status, 200, ok.raw);
  assert.match(mail.at(-1)!.subject, /Client intake submitted/);
  const consents = await owner(async (q) => (await q.query('SELECT kind, channel FROM client_consents WHERE box_id = $1 ORDER BY kind', [box])).rows);
  assert.deepEqual(consents, [{ kind: 'collection_use', channel: 'esign' }, { kind: 'electronic_comms', channel: 'esign' }]);
  assert.equal((await pub('GET', `/v1/public/intake/${token}`)).status, 404, 'a used link stops working');
  // The client's record is fixed.
  await assert.rejects(owner((q) => q.query(`UPDATE client_intakes SET answers = '{}' WHERE id = $1`, [intakeId])), /cannot be changed/);
});

test('the advisor reviews and applies: contact details and a draft needs analysis', async () => {
  assert.equal((await call(P2U, 'GET', `/v1/intakes/${intakeId}`)).status, 404);
  const r = await call(P1U, 'GET', `/v1/intakes/${intakeId}`);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.typedName, 'Raj Kumar Singh');
  assert.equal(r.json.documents.length, 1);
  assert.deepEqual(r.json.contactChanges.map((c: { field: string }) => c.field), ['phone', 'dateOfBirth', 'preferredLanguage']);
  const a = await call(P1U, 'POST', `/v1/intakes/${intakeId}/apply`, { updateContact: true, createNeedsDraft: true });
  assert.equal(a.status, 200, a.raw);
  const c = await owner(async (q) => (await q.query('SELECT phone, date_of_birth::text AS dob, preferred_language FROM contacts WHERE id = $1', [raj])).rows[0]);
  assert.deepEqual(c, { phone: '604-555-0199', dob: '1980-04-12', preferred_language: 'fr-CA' });
  const na = await owner(async (q) => (await q.query('SELECT status, answers FROM advice_records WHERE id = $1', [a.json.needsAnalysisId])).rows[0]);
  assert.equal(na.status, 'draft', 'a draft for the advisor to finish, never signed by the intake');
  assert.equal(na.answers.annualIncome, 90000);
  assert.equal(na.answers.occupation, 'Engineer');
  assert.equal((await call(P1U, 'POST', `/v1/intakes/${intakeId}/apply`, { updateContact: true, createNeedsDraft: true })).status, 422, 'applied once');
});
