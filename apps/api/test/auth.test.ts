import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, newToken } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { firstOf, devAuthenticator, sessionAuthenticator } from '../src/auth.ts';
import type { GoogleClient, GoogleProfile } from '../src/google.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let appPool: Db;
let tenant: { tenantId: string; rootNodeId: string; adminUserId: string };
let nextProfile: GoogleProfile;

const fakeGoogle: GoogleClient = {
  authUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
  exchange: async () => nextProfile,
};
const ORIGIN = 'https://app.punjabinsurance.net';

async function raw(method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, body?: object) {
  return app.inject({ method, url, headers, ...(body ? { payload: body } : {}) });
}
const cookieOf = (res: { headers: Record<string, unknown> }, name: string) => {
  const sc = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
  const hit = sc.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0]! : undefined;
};

/** Run the whole browser flow with the fake Google and return the final redirect + session cookie. */
async function signIn(profile: GoogleProfile, query = '') {
  nextProfile = profile;
  const start = await raw('GET', `/auth/google/start${query}`);
  assert.equal(start.statusCode, 302);
  const flow = cookieOf(start, 'pii_flow')!;
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const cb = await raw('GET', `/auth/google/callback?code=abc&state=${state}`, { cookie: flow });
  return { res: cb, session: cookieOf(cb, 'pii_session'), location: cb.headers.location as string };
}
const as = (session: string | undefined) => ({ cookie: session ?? '' });

before(async () => {
  db = await createTestDb('ca-qc');
  appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 4);
  pools = [appPool, authPool];
  const config = loadConfig({
    APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', COOKIE_SECRET: 'x'.repeat(40),
  });
  app = buildApp({ config, appPool, authPool, google: fakeGoogle, authenticate: firstOf(sessionAuthenticator(authPool), devAuthenticator(authPool)) });
  tenant = await bootstrapTenant(db.ownerUrl, { name: 'Auth Co', countryCode: 'CA', adminEmail: 'boss@authco.test', defaultLocale: 'fr-CA' });
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

test('unknown Google accounts cannot sign in (invite-only)', async () => {
  const r = await signIn({ sub: 'g-x', email: 'stranger@example.com', emailVerified: true });
  assert.match(r.location, /login\?error=unknown_user/);
  assert.equal(r.session, undefined);
});

test('unverified Google email is refused', async () => {
  const r = await signIn({ sub: 'g-boss', email: 'boss@authco.test', emailVerified: false });
  assert.match(r.location, /error=email_not_verified/);
});

test('invited tenant admin signs in, binds the Google id, sees the French notice first', async () => {
  const r = await signIn({ sub: 'g-boss', email: 'boss@authco.test', emailVerified: true, name: 'The Boss' });
  assert.equal(r.res.statusCode, 302);
  assert.ok(r.location.startsWith(`${ORIGIN}/?signed_in=1`));
  assert.ok(r.session);
  const me = JSON.parse((await raw('GET', '/v1/me', as(r.session))).body);
  assert.equal(me.user.displayName, 'The Boss');
  assert.equal(me.needsConsent, true);
  assert.equal((await raw('GET', '/v1/org/nodes', as(r.session))).statusCode, 403);
  const notice = JSON.parse((await raw('GET', '/v1/consent/first-login', as(r.session))).body);
  assert.match(notice.text, /au Québec/);
  assert.match(notice.text, /Auth Co/);
  assert.equal((await raw('POST', '/v1/consent/first-login', { ...as(r.session), origin: ORIGIN })).statusCode, 204);
  assert.equal((await raw('GET', '/v1/org/nodes', as(r.session))).statusCode, 200);
});

test('a different Google account cannot take over the same user', async () => {
  const r = await signIn({ sub: 'g-attacker', email: 'boss@authco.test', emailVerified: true });
  assert.match(r.location, /error=identity_conflict/);
});

let invite = '';
let adminSession = '';
test('admin invites a partner; invitation is accepted through Google sign-in, once', async () => {
  const boss = await signIn({ sub: 'g-boss', email: 'boss@authco.test', emailVerified: true });
  adminSession = boss.session!;
  const post = (url: string, body: object) => raw('POST', url, { ...as(adminSession), origin: ORIGIN }, body);
  const loc = JSON.parse((await post('/v1/org/locations', { name: 'Montréal' })).body).id;
  const partner = JSON.parse((await post('/v1/org/partners', { name: 'Tremblay Assurances', parentId: loc })).body).id;
  const inv = JSON.parse((await post('/v1/invitations', { email: 'Marie@Tremblay.test', nodeId: partner, role: 'admin', locale: 'fr-CA' })).body);
  invite = new URL(inv.acceptUrl).searchParams.get('token')!;

  const wrong = await signIn({ sub: 'g-other', email: 'other@x.test', emailVerified: true }, `?invite=${invite}`);
  assert.match(wrong.location, /error=email_mismatch/);

  const ok = await signIn({ sub: 'g-marie', email: 'marie@tremblay.test', emailVerified: true, name: 'Marie' }, `?invite=${invite}`);
  assert.match(ok.location, /welcome=1/);
  const me = JSON.parse((await raw('GET', '/v1/me', as(ok.session))).body);
  assert.equal(me.user.locale, 'fr-CA');
  assert.equal(me.isTenantAdmin, false);
  assert.equal(me.roles[0].role, 'admin');

  await raw('POST', '/v1/consent/first-login', { ...as(ok.session), origin: ORIGIN });
  const names = JSON.parse((await raw('GET', '/v1/org/nodes', as(ok.session))).body).nodes.map((n: any) => n.name).sort();
  assert.deepEqual(names, ['Auth Co', 'Montréal', 'Tremblay Assurances']);
  const notice = JSON.parse((await raw('GET', '/v1/consent/first-login', as(ok.session))).body);
  assert.match(notice.text, /Montréal, Auth Co/);

  const replay = await signIn({ sub: 'g-marie', email: 'marie@tremblay.test', emailVerified: true }, `?invite=${invite}`);
  assert.match(replay.location, /error=invitation_invalid/);
});

test('logout ends the session', async () => {
  const s = await signIn({ sub: 'g-marie', email: 'marie@tremblay.test', emailVerified: true });
  assert.ok(s.session);
  assert.equal((await raw('GET', '/v1/me', as(s.session))).statusCode, 200);
  assert.equal((await raw('POST', '/auth/logout', { ...as(s.session), origin: ORIGIN })).statusCode, 204);
  assert.equal((await raw('GET', '/v1/me', as(s.session))).statusCode, 401);
});

test('cookie-authenticated writes from another origin are refused (CSRF guard)', async () => {
  const bad = await raw('POST', '/v1/org/locations', { ...as(adminSession), origin: 'https://evil.example' }, { name: 'X' });
  assert.equal(bad.statusCode, 403);
  const none = await raw('POST', '/v1/org/locations', as(adminSession), { name: 'X' });
  assert.equal(none.statusCode, 403);
});

test('tampered or missing flow cookie fails the callback', async () => {
  nextProfile = { sub: 'g-boss', email: 'boss@authco.test', emailVerified: true };
  const start = await raw('GET', '/auth/google/start');
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const forged = (cookieOf(start, 'pii_flow') as string).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.match((await raw('GET', `/auth/google/callback?code=abc&state=${state}`, { cookie: forged })).headers.location as string, /error=expired/);
  assert.match((await raw('GET', `/auth/google/callback?code=abc&state=${state}`)).headers.location as string, /error=expired/);
  assert.match((await raw('GET', `/auth/google/callback?code=abc&state=wrong`, { cookie: cookieOf(start, 'pii_flow')! })).headers.location as string, /error=state/);
});

test('expired invitations are refused', async () => {
  const { token, hash } = newToken();
  const { Client } = (await import('pg')).default;
  const o = new Client({ connectionString: db.ownerUrl });
  await o.connect();
  await o.query(`INSERT INTO invitations (tenant_id,email,node_id,role,token_hash,expires_at) VALUES ($1,'late@x.test',$2,'partner',$3,now() - interval '1 hour')`, [tenant.tenantId, tenant.rootNodeId, hash]);
  await o.end();
  const r = await signIn({ sub: 'g-late', email: 'late@x.test', emailVerified: true }, `?invite=${token}`);
  assert.match(r.location, /error=invitation_invalid/);
});

test('the application role cannot read sessions at all', async () => {
  await assert.rejects(appPool.query('SELECT 1 FROM sessions'), /permission denied/);
});
