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
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function seedPartner(tenantId: string, email: string, home: string, name: string, picture: string | null, lastActiveSql: string) {
  await owner(async (o) => {
    const u = (await o.query(
      `INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status,picture_url,last_active_at)
       VALUES ($1,$2,$3,$4,'active',$5,${lastActiveSql}) RETURNING id`, [tenantId, email, name, home, picture])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'partner')`, [tenantId, u, home]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}

const ADMIN = 'admin@presence.test', ME = 'me@presence.test', MATE = 'mate@presence.test', OUT = 'out@presence.test';
const PHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocmate=s96-c';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  const deps: AppDeps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: { model: 'fake', complete: async () => '' } };
  app = buildApp(deps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const loc1 = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const loc2 = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Montreal' })).json.id;
  const branch = await addBrokerFixture(call, db.ownerUrl, loc1, 'Branch One Agency');
  const other = await addBrokerFixture(call, db.ownerUrl, loc2, 'Branch Two Agency');
  await seedPartner(co.tenantId, ME, branch, 'Me Partner', null, 'NULL');
  await seedPartner(co.tenantId, MATE, branch, 'Mate Partner', PHOTO, `now() - interval '30 minutes'`);
  await seedPartner(co.tenantId, OUT, other, 'Outsider', null, 'now()');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a heartbeat marks the caller online and the branch directory shows it', async () => {
  assert.equal((await call(ME, 'POST', '/v1/presence')).status, 200);
  const { members } = (await call(ME, 'GET', '/v1/partners/branch')).json;
  const me = members.find((m: { me: boolean }) => m.me);
  const mate = members.find((m: { name: string }) => m.name === 'Mate Partner');
  assert.equal(me.name, 'Me Partner'); assert.equal(me.onlineNow, true);
  assert.equal(mate.onlineNow, false, 'half an hour ago is not online');
  assert.equal(mate.pictureUrl, PHOTO);
  const out = members.find((m: { name: string }) => m.name === 'Outsider');
  assert.ok(out, 'partners in other branches are listed across the country');
  assert.equal(out.branch, 'Montreal', 'each partner carries their branch');
  assert.equal(mate.branch, 'Toronto');
});

test('the online list shows active partners across the country, with their photo, but not the caller', async () => {
  let { partners } = (await call(ME, 'GET', '/v1/presence/partners')).json;
  assert.equal(partners.some((p: { name: string }) => p.name === 'Mate Partner'), false, 'the Mate was not active in the last five minutes');
  await owner((o) => o.query(`UPDATE app_users SET last_active_at = now() WHERE email = $1`, [MATE]));
  ({ partners } = (await call(ME, 'GET', '/v1/presence/partners')).json);
  const mate = partners.find((p: { name: string }) => p.name === 'Mate Partner');
  assert.deepEqual(mate, { id: mate.id, name: 'Mate Partner', pictureUrl: PHOTO });
  assert.ok(partners.some((p: { name: string }) => p.name === 'Outsider'), 'a partner in another branch is shown too');
  assert.equal(partners.some((p: { name: string }) => p.name === 'Me Partner'), false, 'a person is not shown to themselves');
});

test('a photo must be a Google-hosted https address', async () => {
  await assert.rejects(owner((o) => o.query(`UPDATE app_users SET picture_url = 'https://evil.example/x.png' WHERE email = $1`, [ME])), /check constraint|picture_url/);
});

test('staff see every active partner in the tenant, with photos', async () => {
  await call(ADMIN, 'POST', '/v1/presence');
  const { partners } = (await call(ADMIN, 'GET', '/v1/presence/partners')).json;
  const names = partners.map((p: { name: string }) => p.name);
  assert.ok(names.includes('Mate Partner') && names.includes('Me Partner') && names.includes('Outsider'), 'staff see the partners across the country');
  assert.equal(partners.find((p: { name: string }) => p.name === 'Mate Partner').pictureUrl, PHOTO);
});
