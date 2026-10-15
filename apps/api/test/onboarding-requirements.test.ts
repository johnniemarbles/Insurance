// Onboarding requirements: a Compliance Manager can switch each onboarding requirement on or off for the company.
// Defaults are on. A change needs a reason and is kept in an append-only history. The screening requirement is enforced
// by the decision now; the other three are stored and will be enforced as their steps are built.
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
async function call(email: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@req.test', OFF = 'officer@req.test', MGR = 'mgr@req.test', AG = 'agency@req.test';
let ONT = '', AGN = '', CASE = '';
const PROFILE = { entityType: 'corporation', legalName: 'Req Agency Inc', businessNumber: '123456789', fields: { province: 'ON' } };
const CONSENTS = { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] };
const CLEAN = { insolvencyOrJudgment: false, redFlag: false, answers: { debtToInsurer: 'no' } };
const REASON = 'Compliance review agreed this for the Q4 onboarding batch';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Requirements Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Req Agency', parentId: ONT })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, ONT, 'compliance'], [MGR, ONT, 'manager'], [AG, AGN, 'admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  await call(OFF, 'POST', '/v1/consent/first-login');
  await call(AG, 'POST', '/v1/consent/first-login');
  await call(MGR, 'POST', '/v1/consent/first-login');
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, PROFILE)).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [AGN]));
  CASE = (await call(OFF, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' })).json.id;
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/form`)).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/consents`, CONSENTS)).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 700 })).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false })).status, 201);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the four requirements are on by default, and anyone in the company can read them', async () => {
  const r = await call(MGR, 'GET', '/v1/onboarding/requirements');
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(r.json.requirements, { screeningBeforeDecision: true, ownershipRequired: true, pendingApproval: true, presidentExceptions: true });
  assert.equal(r.json.canChange, false, 'a branch manager cannot change them');
  assert.deepEqual(r.json.history, []);
});

test('only a Compliance Manager can change a requirement', async () => {
  assert.equal((await call(MGR, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: false, reason: REASON })).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: false, reason: REASON })).status, 403);
  assert.equal((await call(AG, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: false, reason: REASON })).status, 403);
});

test('a change names a known requirement and gives a reason of at least 10 characters', async () => {
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: false, reason: 'short' })).status, 422);
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'somethingElse', value: false, reason: REASON })).status, 422);
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: 'no', reason: REASON })).status, 422);
});

test('with screening required, a decision is refused until the questions are recorded', async () => {
  const early = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Clean file' });
  assert.equal(early.status, 409, early.raw);
  assert.match(early.json.error.message, /screening/i);
});

test('the Compliance Manager switches screening off with a reason, and the decision then goes through', async () => {
  const put = await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'screeningBeforeDecision', value: false, reason: REASON });
  assert.equal(put.status, 200, put.raw);
  assert.equal(put.json.requirements.screeningBeforeDecision, false);
  const dec = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Credit 700, background clear' });
  assert.equal(dec.status, 200, dec.raw);
});

test('every change is kept in the history with who made it, the old and new value, and the reason', async () => {
  const r = await call(MGR, 'GET', '/v1/onboarding/requirements');
  assert.equal(r.json.history.length, 1);
  const h = r.json.history[0];
  assert.equal(h.requirement, 'screeningBeforeDecision');
  assert.equal(h.from, true);
  assert.equal(h.to, false);
  assert.equal(h.reason, REASON);
  assert.equal(h.changedBy, 'officer@req.test'.split('@')[0]);
  const rows = await owner((o) => o.query('SELECT count(*)::int AS n FROM onboarding_requirement_changes'));
  assert.equal(rows.rows[0].n, 1);
});
