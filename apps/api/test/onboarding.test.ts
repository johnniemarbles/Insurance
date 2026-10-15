import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, withRequestTx, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepOnboardingRechecks } from '../src/onboarding-recheck.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let co: { tenantId: string; rootNodeId: string }; let deps: AppDeps;
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
const ADMIN = 'admin@co.test', ON_OFF = 'ontario.officer@co.test', BC_OFF = 'bc.officer@co.test';
const AG = 'agency@co.test', OTHER = 'other@co.test';
let AGN = '', OTN = '', ONT = '', BCN = '';
const PROFILE = { entityType: 'corporation', legalName: 'Agency One Inc', businessNumber: '123456789', fields: { province: 'ON' } };

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  ONT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  BCN = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver' })).json.id;
  AGN = await addBrokerFixture(call, db.ownerUrl, ONT, 'Agency One');
  OTN = await addBrokerFixture(call, db.ownerUrl, ONT, 'Agency Two');
  await seedUser(co.tenantId, ON_OFF, ONT, 'compliance');
  await seedUser(co.tenantId, BC_OFF, BCN, 'compliance');
  await seedUser(co.tenantId, AG, AGN, 'admin');
  await seedUser(co.tenantId, OTHER, OTN, 'admin');
  // Both partners file their compliance profile, so the onboarding form can be submitted.
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, PROFILE)).status, 204);
  assert.equal((await call(OTHER, 'PUT', `/v1/compliance/partners/${OTN}/profile`, { ...PROFILE, legalName: 'Agency Two Inc' })).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = ANY($1::uuid[])', [[AGN, OTN]]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const consentsAll = { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] };

test('an officer invites a partner; only the officer for that region sees the case', async () => {
  // The file starts when the broker is added (see broker-add.test.ts), so the officer finds it invited.
  const caseAgn = await caseOfBroker(db.ownerUrl, AGN);
  const seen = await call(ON_OFF, 'GET', `/v1/onboarding/cases/${caseAgn}`);
  assert.equal(seen.status, 200, seen.raw);
  assert.equal(seen.json.stage, 'invited');
  assert.equal((await call(ON_OFF, 'POST', '/v1/onboarding/cases', { nodeId: AGN })).status, 409, 'a partner is invited once');
  assert.equal((await call(AG, 'POST', '/v1/onboarding/cases', { nodeId: OTN })).status, 404, 'a partner cannot invite, and cannot see the other partner');
  assert.equal((await call(BC_OFF, 'GET', '/v1/onboarding/cases')).json.cases.length, 0, 'the BC officer does not see Ontario cases');
  assert.equal((await call(BC_OFF, 'GET', `/v1/onboarding/cases/${caseAgn}`)).status, 404);
  assert.equal((await call(ON_OFF, 'GET', '/v1/onboarding/cases')).json.cases.length, 2, 'both Ontario partners, each started when added');
});

test('the partner completes the form and consents; the officer runs the checks and decides; the partner sees the outcome only', async () => {
  const id = await caseOfBroker(db.ownerUrl, AGN);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${id}/form`)).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${id}/consents`, { consents: [{ kind: 'credit_check', accepted: false }, { kind: 'background_check', accepted: true }] })).status, 422, 'credit consent is required');
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${id}/consents`, consentsAll)).status, 201);
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 640 })).status, 201);
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/decision`, { outcome: 'good_standing', reason: 'early' })).status, 409, 'no decision while a check is missing');
  const bg = await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false });
  assert.equal(bg.json.stage, 'checks_complete');
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${id}/decision`, { outcome: 'good_standing', reason: 'mine' })).status, 403, 'the partner cannot decide');
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/screening`, { insolvencyOrJudgment: false, redFlag: false, answers: { debtToInsurer: 'no' } })).status, 201);
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'individual' })).status, 200);
  const dec = await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/decision`, { outcome: 'good_standing', reason: 'Credit 640, background clear' });
  assert.equal(dec.status, 200);
  assert.equal(dec.json.outcome, 'good_standing');

  const view = await call(AG, 'GET', `/v1/onboarding/partners/${AGN}`);
  assert.equal(view.status, 200);
  assert.equal(view.json.outcome, 'good_standing');
  assert.equal(view.json.label, 'Good standing');
  assert.equal(view.json.keepsAccess, true);
  assert.ok(!/\b640\b/.test(view.raw), 'the partner never sees the credit score');
  assert.ok(!view.raw.includes('Sterling') && !view.raw.includes('Equifax'), 'the partner never sees the providers');
  assert.ok(!view.raw.includes('Credit 640'), 'the partner never sees the reason');
  assert.equal(view.json.checks, undefined);
  const mine = await call(AG, 'GET', '/v1/onboarding/mine');
  assert.equal(mine.json.onboarding.partnerName, 'Agency One Inc');
  assert.ok(!mine.raw.includes('640'), 'the partner\'s own view has no score');
  assert.equal((await call(BC_OFF, 'GET', '/v1/onboarding/mine')).json.onboarding, null, 'an officer is not a partner in onboarding');
  assert.equal((await call(BC_OFF, 'GET', '/v1/onboarding/mine')).json.officer, true);
  assert.equal(mine.json.officer, false, 'a partner is not an officer');
  assert.equal((await call(AG, 'GET', `/v1/onboarding/cases/${id}`)).status, 403, 'the partner cannot open the officer file');
  assert.equal((await call(ON_OFF, 'GET', `/v1/onboarding/cases/${id}`)).json.checks.length, 2, 'the officer sees every check');

  const sent = await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/agreement`, { title: 'Agency agreement', body: 'Wording as issued by counsel.', version: 'test-1' });
  assert.equal(sent.status, 200);
  const token = new URL(sent.json.url).pathname.split('/').pop() as string;
  assert.equal((await call(AG, 'GET', `/v1/public/partner-sign/${token}`)).json.signed, false);
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/stage`, { to: 'active' })).status, 409, 'activation waits for the signed agreement');
  assert.equal((await call(AG, 'POST', `/v1/public/partner-sign/${token}/confirm`, { code: '000000', typedName: 'Agency One', agree: true })).status, 409, 'a code is asked for first');
  const codeRes = await call(AG, 'POST', `/v1/public/partner-sign/${token}/code`);
  assert.equal(codeRes.status, 200);
  const wrong = codeRes.json.devCode === '000000' ? '111111' : '000000';
  assert.equal((await call(AG, 'POST', `/v1/public/partner-sign/${token}/confirm`, { code: wrong, typedName: 'Agency One', agree: true })).status, 422);
  assert.equal((await call(AG, 'POST', `/v1/public/partner-sign/${token}/confirm`, { code: codeRes.json.devCode, typedName: 'Agency One', agree: true })).status, 200);
  const agreements = (await call(ON_OFF, 'GET', `/v1/onboarding/cases/${id}/agreements`)).json.agreements;
  assert.equal(agreements.length, 1);
  const pdf = await app.inject({ method: 'GET', url: `/v1/onboarding/agreements/${agreements[0].id}/pdf`, headers: { 'x-dev-user-email': ON_OFF } });
  assert.equal(pdf.statusCode, 200);
  assert.ok(pdf.body.startsWith('%PDF'), 'the signed agreement is a PDF');
  assert.equal((await call(AG, 'GET', `/v1/public/partner-sign/${token}`)).json.signed, true);
  assert.equal((await call(AG, 'POST', `/v1/public/partner-sign/${token}/confirm`, { code: codeRes.json.devCode, typedName: 'Agency One', agree: true })).status, 404, 'a used link cannot be signed again');
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/stage`, { to: 'active' })).status, 200);

  const pk = await call(AG, 'POST', `/v1/onboarding/cases/${id}/carrier-packets`, { carrier: 'iA Financial Group', templateVersion: 'F11-92A' });
  assert.equal(pk.status, 201, 'an active, good-standing partner can send a carrier packet');
  assert.equal((await call(AG, 'GET', `/v1/onboarding/partners/${AGN}`)).json.carrierPackets.length, 1);
});

test('a partner not in good standing keeps no access, and cannot get an agency agreement or a carrier packet', async () => {
  assert.ok(await caseOfBroker(db.ownerUrl, OTN), 'the file was started when the broker was added');
  const id = (await call(ON_OFF, 'GET', '/v1/onboarding/cases')).json.cases.find((c: { partnerName: string }) => c.partnerName === 'Agency Two Inc').id;
  assert.equal((await call(OTHER, 'POST', `/v1/onboarding/cases/${id}/form`)).status, 201);
  assert.equal((await call(OTHER, 'POST', `/v1/onboarding/cases/${id}/consents`, consentsAll)).status, 201);
  await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 540 });
  await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false });
  await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'individual' });
  await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/screening`, { insolvencyOrJudgment: false, redFlag: false, answers: { debtToInsurer: 'no' } });
  const dec = await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/decision`, { outcome: 'not_in_good_standing', reason: 'Credit below 575' });
  assert.equal(dec.status, 200);
  const view = await call(OTHER, 'GET', `/v1/onboarding/partners/${OTN}`);
  assert.equal(view.json.outcome, 'not_in_good_standing');
  assert.equal(view.json.keepsAccess, true, 'a partner not in good standing keeps access');
  assert.equal(view.json.warning, true, 'and is shown a warning');
  const mine = (await call(OTHER, 'GET', '/v1/onboarding/mine')).json.onboarding;
  assert.equal(mine.keepsAccess, true);
  assert.equal(mine.warning, true);
  assert.equal((await call(ON_OFF, 'POST', `/v1/onboarding/cases/${id}/agreement`, { title: 'Agency agreement', body: 'x', version: 'test-1' })).status, 409, 'no agreement without good standing');
  assert.equal((await call(OTHER, 'POST', `/v1/onboarding/cases/${id}/carrier-packets`, { carrier: 'iA Financial Group', templateVersion: 'F11-92A' })).status, 409);
});

test('row-level security: the database itself hides checks and decisions from partners and from other regions', async () => {
  const count = async (email: string, table: string): Promise<number> => {
    const { ctx } = await deps.authenticate({ headers: { 'x-dev-user-email': email } } as never);
    return withRequestTx(deps.appPool, ctx, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n);
  };
  assert.ok((await count(ADMIN, 'onboarding_checks')) >= 4, 'the company admin sees every check');
  assert.ok((await count(ON_OFF, 'onboarding_checks')) >= 4, 'the Ontario officer sees the Ontario checks');
  assert.equal(await count(AG, 'onboarding_checks'), 0, 'a partner sees no checks, even its own');
  assert.equal(await count(AG, 'onboarding_decisions'), 0, 'a partner sees no decisions, even its own');
  assert.equal(await count(BC_OFF, 'onboarding_checks'), 0, 'the BC officer sees no Ontario checks');
  assert.equal(await count(BC_OFF, 'onboarding_decisions'), 0, 'the BC officer sees no Ontario decisions');
  assert.equal(await count(BC_OFF, 'onboarding_cases'), 0, 'the BC officer sees no Ontario cases');
});

test('the 6-month check: officers and the company admin are told once when it falls due; the partner and other regions are not', async () => {
  const id = (await call(ON_OFF, 'GET', '/v1/onboarding/cases')).json.cases.find((c: { partnerName: string }) => c.partnerName === 'Agency One Inc').id;
  await owner((o) => o.query(`UPDATE onboarding_cases SET last_checked_at = now() - interval '5 months 20 days' WHERE id = $1`, [id]));
  const count = async (email: string) => owner(async (o) => (await o.query(
    `SELECT count(*)::int AS n FROM notifications n JOIN app_users u ON u.id = n.user_id WHERE u.email = $1 AND n.kind = 'onboarding_recheck'`, [email])).rows[0].n);
  assert.ok((await sweepOnboardingRechecks(deps)) >= 1);
  assert.equal(await count(ON_OFF), 1, 'the Ontario officer is told');
  assert.equal(await count(ADMIN), 1, 'the company administrator is told');
  assert.equal(await count(AG), 0, 'the partner is not told');
  assert.equal(await count(BC_OFF), 0, 'the BC officer is not told about Ontario');
  await sweepOnboardingRechecks(deps);
  assert.equal(await count(ON_OFF), 1, 'a second sweep does not repeat the reminder');
});

