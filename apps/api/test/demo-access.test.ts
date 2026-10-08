import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, seedDemoTenant, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator, firstOf, sessionAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let origin = '';
const HO = 'ho@demo-access.test', REAL = 'real@demo-access.test';

async function dev(email: string, method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body && res.headers['content-type']?.toString().includes('json') ? (JSON.parse(res.body) as any) : null };
}
async function cookieCall(cookie: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { cookie, origin }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body && res.headers['content-type']?.toString().includes('json') ? (JSON.parse(res.body) as any) : null, headers: res.headers };
}
const cookieOf = (setCookie: unknown) => String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
const tokenOf = (url: string) => new URL(url).searchParams.get('invite')!;

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  origin = config.appOrigin;
  app = buildApp({ config, appPool, authPool, authenticate: firstOf(devAuthenticator(authPool), sessionAuthenticator(authPool)), keys: localKeyProvider('0123456789abcdef0123') });
  await bootstrapTenant(db.ownerUrl, { name: 'Head Office', countryCode: 'CA', adminEmail: HO, headOffice: true });
  await dev(HO, 'POST', '/v1/consent/first-login');
  await bootstrapTenant(db.ownerUrl, { name: 'Real Co', countryCode: 'CA', adminEmail: REAL });
  await dev(REAL, 'POST', '/v1/consent/first-login');
  await seedDemoTenant(db.ownerUrl);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a head-office admin makes a link; opening it signs in to the demo as admin with no Google account', async () => {
  const made = await dev(HO, 'POST', '/v1/demo/invites', { label: 'Chrome reviewer', days: 3 });
  assert.equal(made.status, 201);
  assert.match(made.json.url, /\/demo\?invite=/);
  const list = await dev(HO, 'GET', '/v1/demo/invites');
  assert.equal(list.json.invites[0].label, 'Chrome reviewer');
  assert.ok(!JSON.stringify(list.json).includes(tokenOf(made.json.url)), 'the link itself is never listed again');

  const open = await app.inject({ method: 'GET', url: `/demo?invite=${tokenOf(made.json.url)}` });
  assert.equal(open.statusCode, 302);
  const cookie = cookieOf(open.headers['set-cookie']);
  assert.match(cookie, /^pii_session=/);
  const me = await cookieCall(cookie, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.demo, true);
  assert.equal(me.json.tenant.name, 'Maple Demo Insurance');
  assert.equal(me.json.isTenantAdmin, true);
  const used = (await dev(HO, 'GET', '/v1/demo/invites')).json.invites[0];
  assert.equal(used.uses, 1);

  // View as someone else.
  const people = await cookieCall(cookie, 'GET', '/v1/demo/personas');
  assert.equal(people.status, 200);
  const mgr = people.json.personas.find((p: any) => p.role === 'manager');
  assert.ok(mgr && people.json.personas.length >= 10);
  const sw = await app.inject({ method: 'POST', url: '/v1/demo/switch', headers: { cookie, origin }, payload: { userId: mgr.id } });
  assert.equal(sw.statusCode, 204);
  const asMgr = await cookieCall(cookieOf(sw.headers['set-cookie']), 'GET', '/v1/me');
  assert.equal(asMgr.json.user.id, mgr.id);
  assert.equal(asMgr.json.isTenantAdmin, false);

  // Things that reach outside the demo are refused, and a demo user cannot manage links.
  assert.equal((await cookieCall(cookie, 'POST', '/v1/invitations', { email: 'x@y.test', nodeId: mgr.id, role: 'learner' })).status, 403);
  assert.equal((await cookieCall(cookie, 'POST', '/v1/api-keys', { name: 'k' })).status, 403);
  assert.equal((await cookieCall(cookie, 'GET', '/v1/demo/invites')).status, 403);
});

test('revoked, expired, used-up and made-up links are refused; real companies cannot use the switcher', async () => {
  const bad = async (t: string) => { const r = await app.inject({ method: 'GET', url: `/demo?invite=${t}` }); assert.equal(r.statusCode, 302); assert.match(String(r.headers.location), /error=demo_invite/); assert.ok(!r.headers['set-cookie']); };
  await bad('a'.repeat(43));
  await bad('short');

  const a = await dev(HO, 'POST', '/v1/demo/invites', { label: 'to revoke' });
  const id = a.json.id as string;
  assert.equal((await dev(HO, 'DELETE', `/v1/demo/invites/${id}`)).status, 204);
  await bad(tokenOf(a.json.url));

  const once = await dev(HO, 'POST', '/v1/demo/invites', { label: 'once', maxUses: 1 });
  assert.equal((await app.inject({ method: 'GET', url: `/demo?invite=${tokenOf(once.json.url)}` })).statusCode, 302);
  await bad(tokenOf(once.json.url));

  const exp = await dev(HO, 'POST', '/v1/demo/invites', { label: 'expired' });
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  await o.query(`UPDATE demo_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [exp.json.id]);
  await o.end();
  await bad(tokenOf(exp.json.url));

  assert.equal((await dev(REAL, 'GET', '/v1/demo/personas')).status, 404);
  assert.equal((await dev(REAL, 'POST', '/v1/demo/invites', { label: 'x' })).status, 403);
});
