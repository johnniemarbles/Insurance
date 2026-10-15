// A Branch manager can add a broker under its own branch and start that broker's onboarding. It cannot add a broker
// under another branch, cannot add a sub-broker (that stays with the partner's administrators), and cannot decide the file.
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
const ADMIN = 'admin@mgrstart.test', OFF = 'officer@mgrstart.test', MGR = 'mgr@mgrstart.test', MGR2 = 'mgr2@mgrstart.test', AG = 'agency@mgrstart.test';
let TOR = '', OTT = '', BROKER = '', PARTNER_ADMIN_BROKER = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Manager Start Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [MGR, TOR, 'manager'], [MGR2, OTT, 'manager'], [AG, TOR, 'admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, MGR, MGR2, AG]) await call(e, 'POST', '/v1/consent/first-login');
  // A broker the company administrator already added under the Toronto branch, for the sub-broker checks.
  PARTNER_ADMIN_BROKER = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Existing Broker', parentId: TOR })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a branch manager adds a broker under its own branch', async () => {
  const r = await call(MGR, 'POST', '/v1/org/partners', { name: 'Toronto New Broker', parentId: TOR });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.kind, 'location_link');
  BROKER = r.json.id;
});

test('a branch manager cannot add a broker under another branch', async () => {
  // A branch the manager cannot see is refused as unknown (404); a visible one is refused as forbidden (403).
  const r = await call(MGR, 'POST', '/v1/org/partners', { name: 'Ottawa Intruder', parentId: OTT });
  assert.ok([403, 404].includes(r.status), r.raw);
  const other = await call(MGR2, 'POST', '/v1/org/partners', { name: 'Toronto Intruder', parentId: TOR });
  assert.ok([403, 404].includes(other.status), other.raw);
  assert.ok(!(await call(MGR, 'GET', `/v1/onboarding/cases`)).raw.includes('Ottawa Intruder'));
});

test('a branch manager cannot add a sub-broker under a partner: that stays with the partner administrators', async () => {
  const r = await call(MGR, 'POST', '/v1/org/partners', { name: 'Sub Broker', parentId: BROKER });
  assert.equal(r.status, 403, r.raw);
});

test('a branch manager can start the onboarding of the broker it added', async () => {
  const r = await call(MGR, 'POST', '/v1/onboarding/cases', { nodeId: BROKER, country: 'CA' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.stage, 'invited');
});

test('a branch manager records the broker type while the file is still at invited', async () => {
  const list = await call(MGR, 'GET', '/v1/onboarding/cases');
  const id = (list.json.cases as Array<{ id: string; partnerName?: string }>).find((c) => c.partnerName === 'Toronto New Broker')?.id;
  assert.ok(id);
  const r = await call(MGR, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'corporate' });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.type, 'corporate');
});

test('the branch manager sees progress only, and cannot decide the file', async () => {
  const list = await call(MGR, 'GET', '/v1/onboarding/cases');
  assert.equal(list.status, 200, list.raw);
  const rows: Array<{ id: string; partnerName?: string }> = list.json.cases;
  const id = rows.find((c) => c.partnerName === 'Toronto New Broker')?.id;
  assert.ok(id, 'the manager sees the case in its branch');
  const detail = await call(MGR, 'GET', `/v1/onboarding/cases/${id}`);
  assert.equal(detail.status, 200, detail.raw);
  assert.ok(!detail.raw.includes('insolvencyOrJudgment') && !detail.raw.includes('redFlag'), 'no screening answers');
  const decide = await call(MGR, 'POST', `/v1/onboarding/cases/${id}/decision`, { outcome: 'good_standing', reason: 'Manager tries to decide' });
  assert.equal(decide.status, 403, decide.raw);
});

test('a partner administrator still cannot add a broker under a location', async () => {
  const r = await call(AG, 'POST', '/v1/org/partners', { name: 'Agency Broker', parentId: TOR });
  assert.equal(r.status, 403, r.raw);
});

test('the company administrator is unchanged: it can add a broker under any branch', async () => {
  const r = await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Admin Ottawa Broker', parentId: OTT });
  assert.equal(r.status, 201, r.raw);
  assert.ok(PARTNER_ADMIN_BROKER);
});

test('once checks have started, only the Compliance officer records the type; a manager of another branch cannot', async () => {
  const list = await call(MGR, 'GET', '/v1/onboarding/cases');
  const id = (list.json.cases as Array<{ id: string; partnerName?: string }>).find((c) => c.partnerName === 'Toronto New Broker')?.id;
  assert.ok(id);
  await owner((o) => o.query(`UPDATE onboarding_cases SET stage = 'checks_complete' WHERE id = $1`, [id]));
  const late = await call(MGR, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'individual' });
  assert.equal(late.status, 403, late.raw);
  const officerOk = await call(OFF, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'individual' });
  assert.equal(officerOk.status, 200, officerOk.raw);
  const other = await call(MGR2, 'POST', `/v1/onboarding/cases/${id}/type`, { type: 'corporate' });
  assert.ok([403, 404].includes(other.status), other.raw);
});
