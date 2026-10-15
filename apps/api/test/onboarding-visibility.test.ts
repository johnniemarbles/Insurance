// Step 3 of the onboarding plan: who sees what on a broker's onboarding.
//  - Compliance manager (and tenant admin): the full file for partners in its branches.
//  - Branch manager: may start a broker's onboarding in its branch, and sees the progress only (step names and status).
//  - Partner members: see their own outcome through /v1/onboarding/mine, never the list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let co: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@vis.test', ON_OFF = 'ontario.officer@vis.test', MGR_TOR = 'toronto.manager@vis.test', MGR_VAN = 'vancouver.manager@vis.test';
const AG = 'agency@vis.test';
let ONT = '', BCN = '', AGN = '', VANP = '', CASE = '';
const PROFILE = { entityType: 'corporation', legalName: 'Agency One Inc', businessNumber: '123456789', fields: { province: 'ON' } };
const PROGRESS_KEYS = ['id', 'partnerName', 'steps'];

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  const deps: AppDeps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Vis Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  BCN = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency One', parentId: ONT })).json.id;
  VANP = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency Van', parentId: BCN })).json.id;
  await seedUser(co.tenantId, ON_OFF, ONT, 'compliance');
  await seedUser(co.tenantId, MGR_TOR, ONT, 'manager');
  await seedUser(co.tenantId, MGR_VAN, BCN, 'manager');
  await seedUser(co.tenantId, AG, AGN, 'admin');
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, PROFILE)).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [AGN]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a branch manager cannot start a broker onboarding, in its own branch or another; the Compliance Manager does', async () => {
  assert.equal((await call(MGR_TOR, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' })).status, 403, 'not in its own branch');
  assert.ok([403, 404].includes((await call(MGR_VAN, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' })).status), 'not in another branch');
  const mine = await call(ON_OFF, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' });
  assert.equal(mine.status, 201, mine.raw);
  assert.equal(mine.json.stage, 'invited');
  CASE = mine.json.id;
});

test('the branch manager sees progress only: step names and status, never checks, scores or the standing', async () => {
  const list = await call(MGR_TOR, 'GET', '/v1/onboarding/cases');
  assert.equal(list.status, 200);
  const row = list.json.cases.find((c: any) => c.id === CASE);
  assert.ok(row, 'the case is in the manager\'s list');
  assert.deepEqual(Object.keys(row).sort(), PROGRESS_KEYS);
  assert.equal(row.steps[0].step, 'invited');
  assert.equal(row.steps[0].status, 'current');
  assert.equal(row.steps[1].status, 'pending');

  const one = await call(MGR_TOR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(one.status, 200, one.raw);
  assert.deepEqual(Object.keys(one.json).sort(), PROGRESS_KEYS);
  for (const hidden of ['"checks"', '"standing"', '"suggested"', '"score"', '"consents"', '"decisions"', '"outcome"', '"thresholds"']) {
    assert.ok(!one.raw.includes(hidden), `manager view must not contain ${hidden}`);
  }
});

test('a branch manager sees no case from another branch', async () => {
  assert.equal((await call(MGR_VAN, 'GET', '/v1/onboarding/cases')).json.cases.filter((c: any) => c.id === CASE).length, 0);
  assert.equal((await call(MGR_VAN, 'GET', `/v1/onboarding/cases/${CASE}`)).status, 404);
});

test('the branch manager cannot record checks or decide', async () => {
  assert.equal((await call(MGR_TOR, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 700 })).status, 403);
  assert.equal((await call(MGR_TOR, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'mine' })).status, 403);
});

test('the progress follows the stage: the manager sees the step done once the partner has filed it', async () => {
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/form`)).status, 201);
  const one = await call(MGR_TOR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(one.json.steps[0].status, 'done');
  assert.equal(one.json.steps[1].step, 'form_submitted');
  assert.equal(one.json.steps[1].status, 'current');
  assert.equal(one.json.steps[2].status, 'pending');
});

test('the compliance manager still sees the full file for its branch', async () => {
  const one = await call(ON_OFF, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(one.status, 200);
  assert.ok(Array.isArray(one.json.checks), 'checks are in the full file');
  assert.ok('suggested' in one.json, 'the rule\'s suggestion is in the full file');
  assert.ok('standing' in one.json || 'outcome' in one.json, 'the outcome is in the full file');
  const list = await call(ON_OFF, 'GET', '/v1/onboarding/cases');
  assert.ok(list.json.cases.some((c: any) => c.id === CASE && 'invite' in c), 'the officer list keeps the invite status');
});

test('a partner member does not see the onboarding list or the file', async () => {
  assert.equal((await call(AG, 'GET', '/v1/onboarding/cases')).json.cases.length, 0);
  assert.equal((await call(AG, 'GET', `/v1/onboarding/cases/${CASE}`)).status, 403);
});

test('the account says whether it is a branch manager of a case, so the Compliance page can show the progress board', async () => {
  const tor = await call(MGR_TOR, 'GET', '/v1/onboarding/mine');
  assert.equal(tor.json.branchManager, true);
  assert.equal(tor.json.officer, false);
  assert.equal((await call(ON_OFF, 'GET', '/v1/onboarding/mine')).json.branchManager, false, 'a compliance officer is not a branch manager');
  assert.equal((await call(AG, 'GET', '/v1/onboarding/mine')).json.branchManager, false, 'a partner member is not a branch manager');
});
