// Pending compliance approval and President and CEO exceptions (onboarding plan, sections 5 and 7).
// While pending approval applies, only a Compliance Manager records the decision. A red-flag screening (insolvency, judgment,
// red-flag yes, or an adverse background report) can be decided as good standing only with the President and CEO's approval,
// recorded on the file. The company's switches turn each rule on or off.
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
const ADMIN = 'admin@exc.test', OFF = 'officer@exc.test', AG = 'agency@exc.test', AG2 = 'agency2@exc.test';
let ONT = '', AGN = '', AGN2 = '', CASE = '', CASE2 = '';
const CONSENTS = { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] };
const CLEAN = { insolvencyOrJudgment: false, redFlag: false, answers: { debtToInsurer: 'no' } };
const FLAGGED = { insolvencyOrJudgment: false, redFlag: true, answers: { licenceRefusedOrConditions: 'yes' } };
const REASON = 'Counsel review of the licence history, agreed for this file';

async function readyCase(agEmail: string, agencyId: string, name: string): Promise<string> {
  assert.equal((await call(agEmail, 'PUT', `/v1/compliance/partners/${agencyId}/profile`, { entityType: 'corporation', legalName: name, businessNumber: '123456789', fields: { province: 'ON' } })).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [agencyId]));
  const id = (await call(OFF, 'POST', '/v1/onboarding/cases', { nodeId: agencyId, country: 'CA' })).json.id;
  assert.equal((await call(agEmail, 'POST', `/v1/onboarding/cases/${id}/form`)).status, 201);
  assert.equal((await call(agEmail, 'POST', `/v1/onboarding/cases/${id}/consents`, CONSENTS)).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 710 })).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false })).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'individual' })).status, 200);
  return id;
}

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Exceptions Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Exc Agency', parentId: ONT })).json.id;
  AGN2 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Exc Agency Two', parentId: ONT })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, ONT, 'compliance'], [AG, AGN, 'admin'], [AG2, AGN2, 'admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, AG, AG2]) await call(e, 'POST', '/v1/consent/first-login');
  CASE = await readyCase(AG, AGN, 'Exc Agency Inc');
  CASE2 = await readyCase(AG2, AGN2, 'Exc Agency Two Inc');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('while pending compliance approval applies, the company administrator cannot record the decision', async () => {
  const r = await call(ADMIN, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Clean file' });
  assert.equal(r.status, 403, r.raw);
  assert.match(r.json.error.message, /Compliance Manager/);
});

test('a red-flag screening cannot be decided as good standing without the President and CEO approval', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, FLAGGED)).status, 201);
  const r = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Licence conditions cleared' });
  assert.equal(r.status, 409, r.raw);
  assert.match(r.json.error.message, /President and CEO/);
});

test('only the President and CEO (the company administrator) approves an exception; the approval needs a reason', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/exception-approval`, { reason: REASON })).status, 403);
  assert.equal((await call(ADMIN, 'POST', `/v1/onboarding/cases/${CASE}/exception-approval`, { reason: 'short' })).status, 422);
  const ok = await call(ADMIN, 'POST', `/v1/onboarding/cases/${CASE}/exception-approval`, { reason: REASON });
  assert.equal(ok.status, 201, ok.raw);
});

test('once approved, the decision goes through and the approval stays on the file', async () => {
  const dec = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Licence conditions cleared' });
  assert.equal(dec.status, 200, dec.raw);
  const detail = (await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json;
  assert.equal(detail.exceptions.length, 1);
  const adminName = (await owner((o) => o.query('SELECT display_name FROM app_users WHERE email = $1', [ADMIN]))).rows[0]?.display_name;
  assert.equal(detail.exceptions[0].approverName, adminName || 'President and CEO', 'the approver is named on the file');
  assert.equal(detail.exceptions[0].reason, REASON);
});

test('with the pending and exception requirements off, the company administrator decides and a Compliance Manager may override alone', async () => {
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'pendingApproval', value: false, reason: REASON })).status, 200);
  assert.equal((await call(OFF, 'PUT', '/v1/onboarding/requirements', { requirement: 'presidentExceptions', value: false, reason: REASON })).status, 200);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE2}/screening`, FLAGGED)).status, 201);
  const dec = await call(ADMIN, 'POST', `/v1/onboarding/cases/${CASE2}/decision`, { outcome: 'good_standing', reason: 'Administrator decision, exception not required' });
  assert.equal(dec.status, 200, dec.raw);
});
