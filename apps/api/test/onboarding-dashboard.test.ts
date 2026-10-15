// Compliance dashboard alerts (plan v6, section 9): self-reports open and overdue, licence and E&O expiry, rechecks due, frozen partners.
// Numbers are read through the viewer's own visibility: a branch's Compliance Manager sees its branch, a broker sees its own file.
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

const ADMIN = 'admin@dash.test', OFF = 'officer@dash.test', OFF2 = 'officer2@dash.test', AG = 'broker@dash.test', AG2 = 'broker2@dash.test';
let TOR = '', OTT = '', BROKER = '', CASE = '', OTT_BROKER = '', OTT_CASE = '', REPORT = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Dashboard Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    for (const [email, home] of [[OFF, TOR], [OFF2, OTT]] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'compliance')`, [co.tenantId, u, home]);
    }
  });
  for (const e of [OFF, OFF2]) await call(e, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Dashboard Broker');
  CASE = await caseOfBroker(db.ownerUrl, BROKER);
  OTT_BROKER = await addBrokerFixture(call, db.ownerUrl, OTT, 'Ottawa Dashboard Broker');
  OTT_CASE = await caseOfBroker(db.ownerUrl, OTT_BROKER);
  await owner(async (o) => {
    for (const [email, node, name] of [[AG, BROKER, 'Toronto broker admin'], [AG2, OTT_BROKER, 'Ottawa broker admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, name, node])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'admin')`, [co.tenantId, u, node]);
    }
  });
  for (const e of [AG, AG2]) await call(e, 'POST', '/v1/consent/first-login');
  // A Toronto broker with an open self-report, an expired licence and an E&O policy that runs out in ten days.
  REPORT = (await call(AG, 'POST', `/v1/onboarding/cases/${CASE}/self-reports`, { kind: 'investigation', description: 'Regulator opened a file in September' })).json.id;
  await owner(async (o) => {
    await o.query(`INSERT INTO compliance_items (tenant_id,node_id,kind,label,lines,expires_on) SELECT tenant_id, $1, 'licence', 'Ontario life licence', '{life}', current_date - 5 FROM org_nodes WHERE id = $1`, [BROKER]);
    await o.query(`INSERT INTO compliance_items (tenant_id,node_id,kind,label,limit_amount,expires_on) SELECT tenant_id, $1, 'eo', 'Carrier X', 1000000, current_date + 10 FROM org_nodes WHERE id = $1`, [BROKER]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const dash = async (email: string) => {
  const r = await call(email, 'GET', '/v1/onboarding/dashboard');
  assert.equal(r.status, 200, r.raw);
  return r.json as any;
};

test('a Compliance Manager sees the branch alerts: expired licence, E&O expiring soon, open self-report', async () => {
  const d = await dash(OFF);
  assert.equal(d.expiry.expired, 1);
  assert.equal(d.expiry.expiringSoon, 1, 'E&O that runs out within 30 days');
  assert.equal(d.frozen, 1, 'one partner is frozen by the expired licence');
  assert.equal(d.selfReports.open, 1);
  assert.equal(d.selfReports.overdue, 0, 'due in five business days, not yet overdue');
  assert.ok(d.expiries.some((e: any) => e.label === 'Ontario life licence' && e.status === 'expired' && e.partnerName === 'Toronto Dashboard Broker'));
});

test('another branch sees none of it', async () => {
  const d = await dash(OFF2);
  assert.equal(d.expiry.expired, 0);
  assert.equal(d.selfReports.open, 0);
  assert.equal(d.frozen, 0);
});

test('a broker sees its own expiry dates and self-report, and no other broker', async () => {
  const mine = await dash(AG);
  assert.equal(mine.expiry.expired, 1);
  assert.equal(mine.selfReports.open, 1);
  const other = await dash(AG2);
  assert.equal(other.expiry.expired, 0);
  assert.equal(other.selfReports.open, 0);
});

test('an overdue self-report and a recheck past six months show up as alerts', async () => {
  await owner(async (o) => {
    await o.query(`UPDATE broker_self_reports SET due_on = current_date - 3 WHERE id = $1`, [REPORT]);
    await o.query(`UPDATE onboarding_cases SET stage = 'active', last_checked_at = now() - interval '7 months' WHERE id = $1`, [CASE]);
  });
  const d = await dash(OFF);
  assert.equal(d.selfReports.overdue, 1);
  assert.equal(d.rechecks.overdue, 1);
  assert.ok(d.overdueReports.some((r: any) => r.id === REPORT));
});

test('acknowledging the report clears it from the open and overdue counts', async () => {
  assert.equal((await call(OFF, 'POST', `/v1/onboarding/self-reports/${REPORT}/acknowledge`)).status, 204);
  const d = await dash(OFF);
  assert.equal(d.selfReports.open, 0);
  assert.equal(d.selfReports.overdue, 0);
});

test('the endpoint refuses anonymous callers', async () => {
  const r = await app.inject({ method: 'GET', url: '/v1/onboarding/dashboard' });
  assert.ok(r.statusCode === 401 || r.statusCode === 403, `got ${r.statusCode}`);
});
