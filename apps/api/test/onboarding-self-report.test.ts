// Broker self-report (plan v6, section 7). The broker records one of five events in its portal; the clock starts then, and the
// report goes to the Compliance Manager's queue with its due day. Only the Compliance Manager of the branch acknowledges it.
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

const ADMIN = 'admin@sr.test', OFF = 'officer@sr.test', OFF2 = 'officer2@sr.test', MGR = 'mgr@sr.test', AG = 'broker@sr.test', AG2 = 'broker2@sr.test';
let TOR = '', OTT = '', BROKER = '', CASE = '', OTT_BROKER = '', OTT_CASE = '';
let REPORT = '';
const pools_: Db[] = [];

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Self Report Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home, role] of [[OFF, TOR, 'compliance'], [OFF2, OTT, 'compliance'], [MGR, TOR, 'manager']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, home, role]);
    }
  });
  for (const e of [OFF, OFF2, MGR]) await call(e, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Reporting Broker');
  CASE = await caseOfBroker(db.ownerUrl, BROKER);
  OTT_BROKER = await addBrokerFixture(call, db.ownerUrl, OTT, 'Ottawa Reporting Broker');
  OTT_CASE = await caseOfBroker(db.ownerUrl, OTT_BROKER);
  await owner(async (o) => {
    for (const [email, node, name] of [[AG, BROKER, 'Toronto broker admin'], [AG2, OTT_BROKER, 'Ottawa broker admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, name, node])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'admin')`, [co.tenantId, u, node]);
    }
  });
  for (const e of [AG, AG2]) await call(e, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const listed = async (email: string, id: string) =>
  ((await call(email, 'GET', '/v1/onboarding/self-reports')).json?.reports as any[] | undefined)?.find((r) => r.id === id);

test('the broker records a self-report, and the clock is set: due a business day in the future', async () => {
  const r = await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'bankruptcy', description: 'Filed a consumer proposal on 2 October' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.kind, 'bankruptcy');
  assert.match(r.json.dueOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.json.dueOn > new Date().toISOString().slice(0, 10), 'the due day is after today');
  REPORT = r.json.id;
});

test('a report needs one of the five events and a description of at least ten characters', async () => {
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'speeding', description: 'Drove too fast on the 401' })).status, 422);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'sanction', description: 'short' })).status, 422);
});

test('only the broker\'s own people record a self-report: a Compliance Manager or another broker cannot', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'sanction', description: 'Recorded by compliance' })).status, 403);
  // Another broker cannot see this case at all, so it is not found for them.
  assert.ok([403, 404].includes((await call(AG2, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'sanction', description: 'From the other broker' })).status));
});

test('the Compliance Manager of the branch sees the report in the queue, not yet overdue', async () => {
  const row = await listed(OFF, REPORT);
  assert.ok(row, 'the branch officer sees it');
  assert.equal(row.partnerName, 'Toronto Reporting Broker');
  assert.equal(row.overdue, false);
  assert.equal(row.acknowledgedAt, null);
});

test('a Compliance Manager of another branch, and the other broker, do not see it', async () => {
  assert.equal(await listed(OFF2, REPORT), undefined);
  assert.equal(await listed(AG2, REPORT), undefined);
});

test('the broker sees its own reports', async () => {
  assert.ok(await listed(AG, REPORT));
});

test('only the Compliance Manager of the branch acknowledges: a branch manager, the company administrator and the broker cannot', async () => {
  // A manager and another branch's officer cannot see the report at all, so it is not found for them (as for a broker in another branch).
  assert.ok([403, 404].includes((await call(MGR, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status));
  assert.ok([403, 404].includes((await call(OFF2, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status));
  assert.equal((await call(ADMIN, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status, 403);
  assert.equal((await call(AG, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status, 403);
});

test('the branch Compliance Manager acknowledges it once; a second acknowledgement is refused', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status, 204);
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status, 409);
  const row = await listed(OFF, REPORT);
  assert.ok(row.acknowledgedAt, 'acknowledgement is kept');
  assert.equal(row.overdue, false);
});

test('a report not acknowledged by the end of its due day shows as overdue', async () => {
  await owner((o) => o.query(
    `INSERT INTO broker_self_reports (tenant_id, case_id, node_id, kind, description, recorded_by, due_on)
     SELECT tenant_id, $1, $2, 'criminal_charge', 'Charged with a summary offence', recorded_by, DATE '2000-01-03'
       FROM broker_self_reports WHERE id = $3`, [OTT_CASE, OTT_BROKER, REPORT]));
  const late = (await call(AG2, 'GET', '/v1/onboarding/self-reports')).json.reports as any[];
  assert.ok(late.every((r) => r.partnerName === 'Ottawa Reporting Broker'), 'the Ottawa broker sees only its own reports');
  assert.equal(late.some((r) => r.id === REPORT), false, 'and not the Toronto broker\'s report');
  const row = (await call(OFF2, 'GET', '/v1/onboarding/self-reports')).json.reports.find((r: any) => r.kind === 'criminal_charge');
  assert.ok(row, 'the Ottawa officer sees its own broker\'s report');
  assert.equal(row.overdue, true);
  assert.equal(row.dueOn, '2000-01-03');
});
