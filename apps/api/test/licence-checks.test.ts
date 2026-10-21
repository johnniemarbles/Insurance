// Licence checks against the regulators (Phase 3, feature 12): compliance uploads a saved register result, Gemini reads
// it, PII compares it with the licence on file; the check is kept with its evidence; an adverse result stops the
// partner being cleared to transact and tells compliance; due checks are reminded once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { compareRegister, parseRegisterRead, regulatorFor } from '../src/licence-checks.ts';
import { sweepLicenceChecks } from '../src/routes-licence-checks.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let deps: AppDeps;
let pools: Db[] = [];
let tenantId = '';
let page: Record<string, unknown> = {};
const seen: { mime: string }[] = [];
const gemini = { model: 'fake-gemini', complete: async () => '', see: async (i: { images: { mime: string }[] }) => { seen.push({ mime: i.images[0]!.mime }); return JSON.stringify(page); } };

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
const ADMIN = 'admin@lc.test', P1U = 'p1@lc.test', COMP = 'comp@lc.test';
let P1 = '', onLicence = '', bcLicence = '';
const PNG = { filename: 'register.png', mime: 'image/png', dataBase64: Buffer.alloc(2048, 3).toString('base64') };

before(async () => {
  process.env.LICENCE_CHECKS_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), aiProviders: { gemini } };
  app = buildApp(deps);
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'LC Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Harpreet Kaur Sandhu');
  await seedUser(P1U, P1, 'admin');
  await seedUser(COMP, X, 'compliance');
  [onLicence, bcLicence] = await owner(async (c) => {
    await c.query(`DELETE FROM compliance_items WHERE node_id = $1 AND kind = 'licence'`, [P1]);
    const a = (await c.query(`INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction, expires_on) VALUES ($1,$2,'licence','Life and accident and sickness','12345-M','ON','2027-03-31') RETURNING id`, [tenantId, P1])).rows[0].id;
    const b = (await c.query(`INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction, expires_on) VALUES ($1,$2,'licence','Life agent','LA-9988','BC','2027-06-30') RETURNING id`, [tenantId, P1])).rows[0].id;
    return [a, b];
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.LICENCE_CHECKS_ENABLED; });

test('regulators by province; a register page read, checked and compared', () => {
  assert.equal(regulatorFor('ON'), 'fsra_on');
  assert.equal(regulatorFor('British Columbia'), 'icbc_bc');
  assert.equal(regulatorFor('AB'), 'other');
  const r = parseRegisterRead('```json\n' + JSON.stringify({ holderName: 'SANDHU, HARPREET KAUR', licenceNumber: '12345 M', status: 'active', expiryDate: '2027-03-31', conditions: [], disciplinaryActions: [] }) + '\n```');
  assert.deepEqual(compareRegister(r, { holder: 'Harpreet Kaur Sandhu', number: '12345-M', expiresOn: '2027-03-31' }), { status: 'active', nameMatches: true, numberMatches: true, disciplineFound: false, concerns: [] });
  const bad = compareRegister({ ...r, status: 'suspended', disciplinaryActions: ['2026-09-01 suspended for 6 months'], licenceNumber: '99999' }, { holder: 'Harpreet Kaur Sandhu', number: '12345-M', expiresOn: null });
  assert.deepEqual(bad.concerns, ['number_mismatch', 'status_suspended', 'discipline']);
  assert.equal(parseRegisterRead('{"status":"approved"}').status, 'unclear');
  assert.equal(compareRegister({ ...r, conditions: ['Supervised for 2 years'] }, { holder: 'Harpreet Kaur Sandhu', number: null, expiresOn: null }).status, 'active_conditions');
});

test('switched off: 404; compliance only', async () => {
  process.env.LICENCE_CHECKS_ENABLED = '';
  assert.equal((await call(COMP, 'GET', '/v1/licence-checks')).status, 404);
  process.env.LICENCE_CHECKS_ENABLED = '1';
  assert.equal((await call(P1U, 'GET', '/v1/licence-checks')).status, 403);
  const l = await call(COMP, 'GET', '/v1/licence-checks');
  assert.equal(l.status, 200, l.raw);
  const mine = l.json.licences.filter((x: { nodeId: string }) => x.nodeId === P1);
  assert.deepEqual(mine.map((x: { regulator: string; due: boolean }) => `${x.regulator}:${x.due}`).sort(), ['fsra_on:true', 'icbc_bc:true']);
  assert.match(mine.find((x: { regulator: string }) => x.regulator === 'icbc_bc').register, /insurancecouncilofbc\.com/);
});

test('read, confirm, keep the evidence, set the next date', async () => {
  page = { holderName: 'SANDHU, HARPREET KAUR', licenceNumber: '12345-M', status: 'active', expiryDate: '2027-03-31', conditions: [], disciplinaryActions: [] };
  const r = await call(COMP, 'POST', '/v1/licence-checks/read', { itemId: onLicence, evidence: PNG });
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual([r.json.status, r.json.nameMatches, r.json.numberMatches], ['active', true, true]);
  assert.equal(seen.at(-1)!.mime, 'image/png');
  const s = await call(COMP, 'POST', '/v1/licence-checks', { itemId: onLicence, method: 'register_read', status: 'active', nameMatches: true, numberMatches: true, disciplineFound: false, expiryRead: '2027-03-31', evidence: PNG });
  assert.equal(s.status, 201, s.raw);
  const days = Math.round((Date.parse(s.json.nextDueOn) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);
  assert.equal(days, 90);
  const ev = await owner(async (c) => (await c.query(`SELECT d.kind, d.filename FROM licence_checks l JOIN compliance_documents d ON d.id = l.evidence_id WHERE l.id = $1`, [s.json.id])).rows[0]);
  assert.equal(ev.kind, 'licence');
  assert.match(ev.filename, /^Register check \d{4}-\d{2}-\d{2} - register\.png$/);
  // The partner can see their check; nobody can change it.
  await assert.rejects(owner(async (c) => { try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_runtime'); await c.query(`UPDATE licence_checks SET status = 'revoked'`); } finally { await c.query('ROLLBACK'); } }), /permission denied/);
  const after1 = (await call(COMP, 'GET', '/v1/licence-checks')).json.licences.find((x: { id: string }) => x.id === onLicence);
  assert.equal(after1.due, false);
  assert.equal(after1.latest.status, 'active');
});

test('an adverse result stops the partner being cleared and tells compliance', async () => {
  const before = (await call(COMP, 'GET', '/v1/compliance/clearance')).json.notCleared.find((n: { nodeId: string }) => n.nodeId === P1)?.reasons ?? [];
  assert.ok(!before.includes('licence_register_problem'));
  assert.equal((await call(COMP, 'POST', '/v1/licence-checks', { itemId: bcLicence, method: 'manual', status: 'suspended' })).status, 422, 'a note is needed');
  const s = await call(COMP, 'POST', '/v1/licence-checks', { itemId: bcLicence, method: 'manual', status: 'suspended', disciplineFound: true, note: 'Insurance Council of BC directory shows suspended since 2026-09-01.' });
  assert.equal(s.status, 201, s.raw);
  const after1 = (await call(COMP, 'GET', '/v1/compliance/clearance')).json.notCleared.find((n: { nodeId: string }) => n.nodeId === P1);
  assert.ok(after1.reasons.includes('licence_register_problem'), JSON.stringify(after1));
  const told = await owner(async (c) => (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'licence_check' AND data->>'issue' = 'adverse'`)).rows[0].n);
  assert.ok(told >= 1);
  const list = (await call(COMP, 'GET', '/v1/licence-checks')).json.licences;
  assert.equal(list[0].id, bcLicence, 'adverse first');
});

test('due checks are reminded once per due date', async () => {
  await owner((c) => c.query(`INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction) VALUES ($1,$2,'licence','Second ON licence','777','ON')`, [tenantId, P1]));
  const n1 = await sweepLicenceChecks(deps);
  assert.ok(n1 >= 1);
  assert.equal(await sweepLicenceChecks(deps), 0, 'once only');
  const due = await owner(async (c) => (await c.query(`SELECT data->>'label' AS l FROM notifications WHERE kind = 'licence_check' AND data->>'issue' = 'due'`)).rows.map((r) => r.l));
  assert.ok(due.includes('Second ON licence'));
  assert.ok(!due.includes('Life and accident and sickness'), 'a licence just checked is not due');
});
