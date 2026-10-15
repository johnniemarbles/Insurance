// Staff on brokers (plan v7, sections 3 and 6). A branch manager assigns a staff member of its branch to a broker in its
// branch. The staff member sees the assigned broker's analytics: stage progress, recheck due date, and whether each check is
// complete or outstanding. Never the screening answers, check scores, the standing, or any decision.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@staff.test', OFF = 'officer@staff.test', MGR = 'mgr@staff.test', MGR2 = 'mgr2@staff.test', AG = 'brokeradmin@staff.test';
const STF = 'staff@staff.test', STF2 = 'staff2@staff.test', TRAINER = 'trainer@staff.test';
let TOR = '', OTT = '', BROKER = '', CASE = '', OTT_BROKER = '', OTT_CASE = '';
const ids: Record<string, string> = {};

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Staff Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [MGR, TOR, 'manager'], [MGR2, OTT, 'manager'], [STF, TOR, 'staff'], [TRAINER, TOR, 'trainer'], [STF2, OTT, 'staff']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
      ids[email] = u;
    }
  });
  for (const e of [OFF, MGR, MGR2, STF, TRAINER, STF2]) await call(e, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Staffed Broker');
  // The broker's own administrator fills in the file and gives consent, as a partner does, before any check is recorded.
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,'broker admin',$3,'active') RETURNING id`, [co.tenantId, AG, BROKER])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'admin')`, [co.tenantId, u, BROKER]);
  });
  await call(AG, 'POST', '/v1/consent/first-login');
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${BROKER}/profile`, { entityType: 'corporation', legalName: 'Toronto Staffed Broker Inc', businessNumber: '123456789', fields: { province: 'ON' } })).status, 204);
  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [BROKER]));
  CASE = (await caseOfBroker(db.ownerUrl, BROKER));
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/form`)).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/consents`, { consents: [{ kind: 'credit_check', accepted: true }, { kind: 'background_check', accepted: true }, { kind: 'carrier_reporting', accepted: false }] })).status, 201);
  OTT_BROKER = await addBrokerFixture(call, db.ownerUrl, OTT, 'Ottawa Staffed Broker');
  OTT_CASE = (await caseOfBroker(db.ownerUrl, OTT_BROKER));
  // A recorded credit check with a score, so the staff analytics can show it is complete without the score.
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: 731 })).status, 201);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a branch manager assigns a staff member of its branch to a broker in its branch', async () => {
  const r = await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[STF] });
  assert.equal(r.status, 201, r.raw);
});

test('only staff of that branch can be assigned: a trainer or a staff member of another branch is refused', async () => {
  assert.equal((await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[TRAINER] })).status, 422);
  assert.equal((await call(MGR, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[STF2] })).status, 422);
});

test('a branch manager cannot assign staff to a broker in another branch', async () => {
  const r = await call(MGR2, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[STF2] });
  assert.ok([403, 404].includes(r.status), r.raw);
  assert.ok([403, 404].includes((await call(MGR, 'POST', `/v1/onboarding/cases/${OTT_CASE}/staff`, { userId: ids[STF2] })).status), 'and not a broker in Ottawa');
});

test('a Compliance Manager or a staff member cannot assign staff', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[STF] })).status, 403);
  assert.equal((await call(STF, 'POST', `/v1/onboarding/cases/${CASE}/staff`, { userId: ids[STF] })).status, 403);
});

test('the assigned staff member sees the broker with analytics: progress, recheck date, and checks complete or outstanding', async () => {
  const detail = await call(STF, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(detail.status, 200, detail.raw);
  assert.ok(Array.isArray(detail.json.steps));
  assert.ok(detail.json.recheck !== undefined, 'recheck due date');
  const credit = (detail.json.checks as Array<{ kind: string; complete: boolean }>).find((c) => c.kind === 'credit');
  assert.deepEqual(credit, { kind: 'credit', complete: true });
});

test('the staff analytics never show scores, screening answers, the standing, or providers', async () => {
  const detail = await call(STF, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.ok(!/\b731\b/.test(detail.raw), 'no credit score');
  assert.ok(!detail.raw.includes('insolvencyOrJudgment') && !detail.raw.includes('redFlag'), 'no screening answers');
  assert.ok(!detail.raw.includes('"score"') && !detail.raw.includes('"standing"') && !detail.raw.includes('"outcome"'), 'no score, standing or decision');
  assert.ok(!detail.raw.includes('Equifax'), 'no provider');
});

test('the assigned staff member sees the broker in its list', async () => {
  const list = await call(STF, 'GET', '/v1/onboarding/cases');
  assert.equal(list.status, 200, list.raw);
  assert.ok((list.json.cases as Array<{ id: string }>).some((c) => c.id === CASE));
  assert.ok(!(list.json.cases as Array<{ id: string }>).some((c) => c.id === OTT_CASE), 'not the other branch');
});

test('a staff member who is not assigned does not see the broker', async () => {
  const detail = await call(STF2, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.ok([403, 404].includes(detail.status), detail.raw);
  const list = await call(STF2, 'GET', '/v1/onboarding/cases');
  assert.ok(!(list.json.cases as Array<{ id: string }>).some((c) => c.id === CASE));
});

test('an assigned staff member cannot decide, record checks, or record screening', async () => {
  assert.equal((await call(STF, 'POST', `/v1/onboarding/cases/${CASE}/decision`, { outcome: 'good_standing', reason: 'Staff tries to decide' })).status, 403);
  assert.equal((await call(STF, 'POST', `/v1/onboarding/cases/${CASE}/checks`, { kind: 'background', provider: 'Sterling Backcheck', status: 'complete', adverse: false })).status, 403);
  assert.equal((await call(STF, 'POST', `/v1/onboarding/cases/${CASE}/screening`, { insolvencyOrJudgment: false, redFlag: false, answers: {} })).status, 403);
});

test('the account says it is staff on a broker, so the Compliance page can show the analytics', async () => {
  assert.equal((await call(STF, 'GET', '/v1/onboarding/mine')).json.staff, true);
  assert.equal((await call(STF2, 'GET', '/v1/onboarding/mine')).json.staff, false);
});

test('the branch manager sees who is assigned, with progress only', async () => {
  const detail = await call(MGR, 'GET', `/v1/onboarding/cases/${CASE}`);
  assert.equal(detail.status, 200, detail.raw);
  assert.deepEqual((detail.json.staff as Array<{ userId: string }>).map((s) => s.userId), [ids[STF]]);
  assert.ok(!detail.raw.includes('731') && !detail.raw.includes('"checks"'), 'the manager sees progress, not checks');
});

test('a branch manager removes an assignment on its own branch; the staff member then loses sight of the broker', async () => {
  const r = await call(MGR, 'DELETE', `/v1/onboarding/cases/${CASE}/staff/${ids[STF]}`);
  assert.equal(r.status, 204, r.raw);
  assert.ok([403, 404].includes((await call(STF, 'GET', `/v1/onboarding/cases/${CASE}`)).status));
});
