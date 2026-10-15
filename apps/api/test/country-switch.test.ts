// Country switcher (global overview). Canada and the USA are two apps with two databases. The head office in each app shows a link
// to the other country's app. The link is configuration only: no data moves between the two.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { countrySwitchFor } from '../src/country-switch.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
const HO = 'hoadmin@switch.test', BRANCH = 'admin@switch.test';
const OTHER = 'https://us.app.example.test';

async function call(email: string, url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-dev-user-email': email } });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true', OTHER_REGION_URL: OTHER });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  await bootstrapTenant(db.ownerUrl, { name: 'Head Office CA', countryCode: 'CA', adminEmail: HO, headOffice: true });
  await bootstrapTenant(db.ownerUrl, { name: 'Branch Co', countryCode: 'CA', adminEmail: BRANCH });
  for (const e of [HO, BRANCH]) {
    const r = await app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': e } });
    assert.ok(r.statusCode < 300, r.body);
  }
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the head office in Canada sees a link to the USA app', async () => {
  const me = await call(HO, '/v1/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.countrySwitch, { toCountry: 'US', url: OTHER });
});

test('a company outside head office sees no switch', async () => {
  const me = await call(BRANCH, '/v1/me');
  assert.equal(me.json.countrySwitch, null);
});

test('the switch points at the other country, whichever side the app is on', () => {
  assert.deepEqual(countrySwitchFor('ca-qc', 'https://us.example'), { toCountry: 'US', url: 'https://us.example' });
  assert.deepEqual(countrySwitchFor('us', 'https://ca.example'), { toCountry: 'CA', url: 'https://ca.example' });
});

test('with no other app configured there is nothing to switch to', () => {
  assert.equal(countrySwitchFor('ca-qc', undefined), null);
  assert.equal(countrySwitchFor('us', ''), null);
});

test('only a web address can be linked', () => {
  assert.equal(countrySwitchFor('ca-qc', 'javascript:alert(1)'), null);
});
