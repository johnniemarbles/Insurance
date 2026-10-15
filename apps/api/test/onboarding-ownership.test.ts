// Broker type and ownership tiers (onboarding plan, section 7). The Compliance officer records the type and the owners;
// the decision waits for a complete ownership file while the company's ownership requirement is on. Partners and branch
// managers never see the owners.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@own.test', OFF = 'officer@own.test', MGR = 'mgr@own.test', AG = 'agency@own.test';
let ONT = '', AGN = '', CASE = '', OWNER1 = '';
const PROFILE = { entityType: 'corporation', legalName: 'Own Agency Inc', businessNumber: '123456789', fields: { province: 'ON' } };
const CONSENTS = { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] };
const CLEAN = { insolvencyOrJudgment: false, redFlag: false, answers: { debtToInsurer: 'no' } };
const REASON = 'Ownership to be completed after counsel review of the structure';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Ownership Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Own Agency', parentId: ONT })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, ONT, 'compliance'], [MGR, ONT, 'manager'], [AG, AGN, 'admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, MGR, AG]) await call(e, 'POST', '/v1/consent/first-login');
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, PROFILE)).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [AGN]));
  CASE = (await call(OFF, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' })).json.id;
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/form`)).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/consents`, CONSENTS)).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 700 })).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false })).status, 201);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('only the Compliance officer records the broker type; an invalid type is refused', async () => {
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/type`, { type: 'corporate' })).status, 403);
  assert.equal((await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/type`, { type: 'corporate' })).status, 403);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/type`, { type: 'partnership' })).status, 422);
  const ok = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/type`, { type: 'corporate' });
  assert.equal(ok.status, 200, ok.raw);
  assert.equal(ok.json.type, 'corporate');
});

test('the officer records owners; the file lists what is still missing', async () => {
  const d = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/owners`, { fullName: 'Amrit Kaur', isDirector: true, sharePercent: 40, identified: false, pepHioDetermined: false, guaranteeSigned: false });
  assert.equal(d.status, 201, d.raw);
  OWNER1 = d.json.id;
  const detail = (await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json;
  assert.equal(detail.ownership.type, 'corporate');
  assert.equal(detail.ownership.owners.length, 1);
  for (const p of ['identity_missing', 'guarantee_missing', 'pep_hio_missing']) assert.ok(detail.ownership.problems.includes(p), p);
  assert.ok(!detail.ownership.problems.includes('steps_missing'), 'a holder of 40% means no steps are needed');
});

test('with the ownership requirement on, a corporate broker with an incomplete file gets no decision', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, CLEAN)).status, 201);
  const early = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Clean file' });
  assert.equal(early.status, 409, early.raw);
  assert.match(early.json.error.message, /ownership/i);
});

test('a partner and a branch manager cannot see the owners', async () => {
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).status, 200);
  const partner = await call(AG, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.ok(!partner.raw.includes('Amrit Kaur'), 'partner sees no owner names');
  const mgr = await call(MGR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.ok(!mgr.raw.includes('Amrit Kaur'), 'branch manager sees no owner names');
});

test('the officer completes the file: the owner is verified, the steps are recorded, the problems are cleared', async () => {
  const put = await call(OFF, 'PUT', `/v1/onboarding/cases/${CASE}/owners/${OWNER1}`, { fullName: 'Amrit Kaur', isDirector: true, sharePercent: 40, identified: true, pepHioDetermined: true, guaranteeSigned: true });
  assert.equal(put.status, 200, put.raw);
  const second = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/owners`, { fullName: 'Jaspal Singh', isDirector: false, sharePercent: 60, identified: true, pepHioDetermined: true, guaranteeSigned: true });
  assert.equal(second.status, 201, second.raw);
  const detail = (await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json;
  assert.deepEqual(detail.ownership.problems, []);
});

test('the Compliance officer can remove an owner; the removal is refused for anyone else', async () => {
  const list = (await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.ownership.owners;
  const second = list.find((o: { fullName: string }) => o.fullName === 'Jaspal Singh');
  assert.equal((await call(MGR, 'DELETE', `/v1/onboarding/cases/${CASE}/owners/${second.id}`)).status, 403);
  assert.equal((await call(OFF, 'DELETE', `/v1/onboarding/cases/${CASE}/owners/${second.id}`)).status, 204);
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.ownership.owners.length, 1);
});

test('switching the ownership requirement off lets the decision go through without the owners', async () => {
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'ownershipRequired', value: false, reason: REASON })).status, 200);
  const dec = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Credit 700, background clear' });
  assert.equal(dec.status, 200, dec.raw);
});

test('the officer records the steps taken, and a short description is refused', async () => {
  assert.equal((await call(OFF, 'PUT', `/v1/onboarding/cases/${CASE}/ownership-steps`, { steps: 'short' })).status, 422);
  assert.equal((await call(AG, 'PUT', `/v1/onboarding/cases/${CASE}/ownership-steps`, { steps: 'Searched the public register for holders' })).status, 403);
  assert.equal((await call(OFF, 'PUT', `/v1/onboarding/cases/${CASE}/ownership-steps`, { steps: 'Searched the public register for holders' })).status, 200);
});
