// Onboarding plan, section 2 and 7: the screening questionnaire is recorded by the Compliance officer. Its answers
// change the suggested standing (a bankruptcy, judgment or red-flag yes goes to review, whatever the score).
// Partners and branch managers never see or record the answers.
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
const ADMIN = 'admin@scr.test', OFF = 'officer@scr.test', MGR = 'mgr@scr.test', AG = 'agency@scr.test';
let ONT = '', AGN = '', CASE = '';
const PROFILE = { entityType: 'corporation', legalName: 'Screen Agency Inc', businessNumber: '123456789', fields: { province: 'ON' } };
const CONSENTS = { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] };
const CLEAN = { insolvencyOrJudgment: false, redFlag: false, answers: { insolvencyOrJudgment: 'no', debtToInsurer: 'no', licenceRefusedOrConditions: 'no', terminationForCause: 'no', sponsorshipChanges5y: 'no', complaintsOrDiscipline: 'no' } };

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Screen Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Screen Agency', parentId: ONT })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, ONT, 'compliance'], [MGR, ONT, 'manager'], [AG, AGN, 'admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  await call(OFF, 'POST', '/v1/consent/first-login');
  await call(AG, 'POST', '/v1/consent/first-login');
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, PROFILE)).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [AGN]));
  CASE = (await call(OFF, 'POST', '/v1/onboarding/cases', { nodeId: AGN, country: 'CA' })).json.id;
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/form`)).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/consents`, CONSENTS)).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 800 })).status, 201);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false })).status, 201);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the decision waits for the screening questions: it is refused until they are recorded', async () => {
  const early = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Clean file' });
  assert.equal(early.status, 409, early.raw);
  assert.match(early.json.error.message, /screening/i);
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.stage, 'checks_complete');
});

test('the officer records the screening answers; a bankruptcy, judgment or red-flag yes is needed to change the suggestion', async () => {
  const rec = await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, CLEAN);
  assert.equal(rec.status, 201, rec.raw);
  const detail = await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(detail.json.screening.insolvencyOrJudgment, false);
  assert.equal(detail.json.screening.redFlag, false);
  assert.equal(detail.json.suggested, 'good_standing');
});

test('a yes to a judgment goes to review even with an 800 score; the latest answers are the ones that count', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { ...CLEAN, insolvencyOrJudgment: true, answers: { ...CLEAN.answers, insolvencyOrJudgment: 'yes' } })).status, 201);
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.suggested, 'needs_review');
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, CLEAN)).status, 201);
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.suggested, 'good_standing');
});

test('a red-flag yes goes to review', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { ...CLEAN, redFlag: true })).status, 201);
  assert.equal((await call(OFF, 'GET', `/v1/onboarding/cases/${CASE}`)).json.suggested, 'needs_review');
});

test('answers are required and must be yes or no', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { insolvencyOrJudgment: false })).status, 422);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { insolvencyOrJudgment: 'no', redFlag: false })).status, 422);
});

test('a branch manager and the partner cannot record or see the screening answers', async () => {
  assert.equal((await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/screening`, CLEAN)).status, 403);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/screening`, CLEAN)).status, 403);
  const partnerView = await call(AG, 'GET', `/v1/onboarding/partners/${AGN}`);
  assert.equal(partnerView.status, 200);
  assert.ok(!partnerView.raw.includes('insolvencyOrJudgment') && !partnerView.raw.includes('redFlag') && !partnerView.raw.includes('screening'));
  const mgrView = await call(MGR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.ok(!mgrView.raw.includes('insolvencyOrJudgment'), 'a branch manager sees progress only');
});
