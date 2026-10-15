// Each country is its own database and company. A broker's country is the company's country, set by the system.
// Nobody picks it when adding a broker, so a US broker can never be stored as Canadian by a default or a stale form.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
const ADMIN = 'admin@us.country.test';
let BRANCH = '', BROKER_A = '', BROKER_B = '';

before(async () => {
  db = await createTestDb('us');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'us', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  await bootstrapTenant(db.ownerUrl, { name: 'Country Test USA', countryCode: 'US', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  BRANCH = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Chicago' })).json.id;
  BROKER_A = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Chicago Broker One', parentId: BRANCH })).json.id;
  BROKER_B = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Chicago Broker Two', parentId: BRANCH })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

async function countryOf(nodeId: string): Promise<string | undefined> {
  const list = await call(ADMIN, 'GET', '/v1/onboarding/cases');
  assert.equal(list.status, 200, list.raw);
  return (list.json.cases as Array<{ nodeId: string; country: string }>).find((c) => c.nodeId === nodeId)?.country;
}

test('a broker added in a US company is a US broker, with no country sent', async () => {
  const r = await call(ADMIN, 'POST', '/v1/onboarding/cases', { nodeId: BROKER_A });
  assert.equal(r.status, 201, r.raw);
  assert.equal(await countryOf(BROKER_A), 'US');
});

test('a country sent by an old or stale form is ignored: the company decides', async () => {
  const r = await call(ADMIN, 'POST', '/v1/onboarding/cases', { nodeId: BROKER_B, country: 'CA' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(await countryOf(BROKER_B), 'US');
});
