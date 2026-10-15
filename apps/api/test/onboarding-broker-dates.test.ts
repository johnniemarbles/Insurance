// The broker's own licence and E&O expiry dates (plan v6, section 9: Broker dashboard). Only the broker's own people see them;
// the Branch manager sees progress only, and another broker sees nothing of this one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

const ADMIN = 'admin@bd.test', MGR = 'mgr@bd.test', AG = 'broker@bd.test', AG2 = 'broker2@bd.test';
let TOR = '', BROKER = '', OTT_BROKER = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Broker Dates Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,'mgr',$3,'active') RETURNING id`, [co.tenantId, MGR, TOR])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'manager')`, [co.tenantId, u, TOR]);
  });
  await call(MGR, 'POST', '/v1/consent/first-login');
  BROKER = await addBrokerFixture(call, db.ownerUrl, TOR, 'Toronto Dates Broker');
  OTT_BROKER = await addBrokerFixture(call, db.ownerUrl, OTT, 'Ottawa Dates Broker');
  await owner(async (o) => {
    for (const [email, node, name] of [[AG, BROKER, 'Toronto broker admin'], [AG2, OTT_BROKER, 'Ottawa broker admin']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, name, node])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'admin')`, [co.tenantId, u, node]);
    }
    await o.query(`INSERT INTO compliance_items (tenant_id,node_id,kind,label,lines,expires_on) SELECT tenant_id, $1, 'licence', 'Ontario life licence', '{life}', current_date - 5 FROM org_nodes WHERE id = $1`, [BROKER]);
    await o.query(`INSERT INTO compliance_items (tenant_id,node_id,kind,label,limit_amount,expires_on) SELECT tenant_id, $1, 'eo', 'Carrier X', 1000000, current_date + 200 FROM org_nodes WHERE id = $1`, [BROKER]);
  });
  for (const e of [AG, AG2]) await call(e, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the broker sees its own licence and E&O dates, with a status for each', async () => {
  const r = await call(AG, 'GET', '/v1/onboarding/mine');
  assert.equal(r.status, 200, r.raw);
  const dates = r.json.onboarding.expiries as any[];
  assert.equal(dates.length, 2);
  const licence = dates.find((d) => d.kind === 'licence');
  assert.equal(licence.label, 'Ontario life licence');
  assert.equal(licence.status, 'expired');
  assert.equal(dates.find((d) => d.kind === 'eo').status, 'valid');
});

test('another broker does not see these dates', async () => {
  const r = await call(AG2, 'GET', '/v1/onboarding/mine');
  assert.deepEqual(r.json.onboarding.expiries, []);
});

test('the Branch manager sees progress only, not the dates', async () => {
  const r = await call(MGR, 'GET', '/v1/onboarding/mine');
  assert.equal(r.json.onboarding ?? null, null);
  assert.equal(r.raw.includes('Ontario life licence'), false);
});
