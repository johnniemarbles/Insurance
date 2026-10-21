// Sign-in across the two country servers, and the two ways in after an invitation (Gmail extension, web app).
// Two servers, each with its own database: Canada (ca.) and United States (us.). Neither ever reads the other's users.
import pg from 'pg';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { hashToken, loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { firstOf, devAuthenticator, sessionAuthenticator } from '../src/auth.ts';
import type { GoogleClient, GoogleProfile } from '../src/google.ts';
import { partnerInviteMail } from '../src/partner-invite.ts';
import { safeNext } from '../src/countries.ts';

const CA = 'https://ca.punjabinsurance.co', US = 'https://us.punjabinsurance.co';
const STORE = 'https://chromewebstore.google.com/detail/bbfccaiemeckdhajpejacckieamdbajm';
const STORE_ID = 'bbfccaiemeckdhajpejacckieamdbajm', ZIP_ID = 'egdeindkmifjmbdfgkmbhgpddopkbpbe';
let nextProfile: GoogleProfile;
const fakeGoogle: GoogleClient = { authUrl: ({ state, loginHint }) => `https://accounts.example/auth?state=${state}${loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : ''}`, exchange: async () => nextProfile };

interface Server { app: FastifyInstance; db: TestDb; pools: Db[]; tenantId: string; rootNodeId: string }
const servers: Server[] = [];
let ca: Server, us: Server;

async function server(region: 'ca-qc' | 'us', origin: string, admin: string): Promise<Server> {
  const db = await createTestDb(region);
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 4);
  const config = loadConfig({
    APP_ENV: 'test', REGION: region, DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, APP_ORIGIN: origin,
    DEV_AUTH: 'true', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', COOKIE_SECRET: 'x'.repeat(40),
  });
  const app = buildApp({ config, appPool, authPool, google: fakeGoogle, keys: localKeyProvider('0123456789abcdef0123'), authenticate: firstOf(sessionAuthenticator(authPool), devAuthenticator(authPool)) });
  const t = await bootstrapTenant(db.ownerUrl, { name: region === 'us' ? 'Punjab Insurance Broker Inc' : 'Punjab Insurance Agency Inc', countryCode: region === 'us' ? 'US' : 'CA', adminEmail: admin });
  const s = { app, db, pools: [appPool, authPool], tenantId: t.tenantId, rootNodeId: t.rootNodeId };
  servers.push(s);
  return s;
}
const cookieOf = (res: { headers: Record<string, unknown> }, name: string) => {
  const hit = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []).find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0]! : undefined;
};
/** One server's Google round trip: start (with its query), then the callback. Returns where the browser goes next. */
async function signIn(s: Server, profile: GoogleProfile, query = '') {
  nextProfile = profile;
  const start = await s.app.inject({ method: 'GET', url: `/auth/google/start${query}` });
  assert.equal(start.statusCode, 302);
  const google = new URL(start.headers.location as string);
  const cb = await s.app.inject({ method: 'GET', url: `/auth/google/callback?code=abc&state=${google.searchParams.get('state')}`, headers: { cookie: cookieOf(start, 'pii_flow')! } });
  return { location: cb.headers.location as string, session: cookieOf(cb, 'pii_session'), hint: google.searchParams.get('login_hint') };
}
/** Follows a redirect to the other server the way a browser would: the path and query on that server. */
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const owner = async <T>(s: Server, fn: (c: pg.Client) => Promise<T>) => { const c = new pg.Client({ connectionString: s.db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } };

before(async () => {
  ca = await server('ca-qc', CA, 'harpreet@agency.test');
  us = await server('us', US, 'jordan@broker.test');
});
after(async () => {
  delete process.env.PII_EXTENSION_URL;
  for (const s of servers) { await s.app.close(); await Promise.all(s.pools.map((p) => p.end())); await s.db.drop(); }
});

test('only PII pages on the same server are accepted as a place to return to', () => {
  assert.equal(safeNext('/app'), '/app');
  assert.equal(safeNext('/app?x=1'), '/app?x=1');
  for (const bad of ['https://evil.test/app', '//evil.test/app', '/\\evil.test', '/login', '/app//x', 'app', '/apps', '/ app']) assert.equal(safeNext(bad), null, bad);
});

test('the web app signs in and comes back to /app; an outside address is ignored', async () => {
  const r = await signIn(ca, { sub: 'g-h', email: 'harpreet@agency.test', emailVerified: true }, '?next=%2Fapp');
  assert.equal(r.location, `${CA}/app?signed_in=1`);
  assert.ok(r.session);
  const evil = await signIn(ca, { sub: 'g-h', email: 'harpreet@agency.test', emailVerified: true }, `?next=${encodeURIComponent('https://evil.test/app')}`);
  assert.equal(evil.location, `${CA}/?signed_in=1`);
});

test('an account only in the US: Canada sends the person to the US sign-in, which signs them in there', async () => {
  const first = await signIn(ca, { sub: 'g-j', email: 'jordan@broker.test', emailVerified: true }, '?next=%2Fapp');
  assert.ok(first.location.startsWith(`${US}/auth/google/start?fb=1`), first.location);
  assert.equal(first.session, undefined, 'no Canada session');
  assert.equal(new URL(first.location).searchParams.get('next'), '/app', 'the return page carries over');
  const second = await signIn(us, { sub: 'g-j', email: 'jordan@broker.test', emailVerified: true }, pathOf(first.location).replace('/auth/google/start', ''));
  assert.equal(second.hint, 'jordan@broker.test', 'Google is asked for the same account');
  assert.equal(second.location, `${US}/app?signed_in=1`);
  assert.ok(second.session);
  // From Gmail (no return page): the signed-in page says it moved them and names the country.
  const fromGmail = await signIn(ca, { sub: 'g-j', email: 'jordan@broker.test', emailVerified: true });
  const landed = await signIn(us, { sub: 'g-j', email: 'jordan@broker.test', emailVerified: true }, pathOf(fromGmail.location).replace('/auth/google/start', ''));
  assert.equal(landed.location, `${US}/?signed_in=1&moved=1`);
  const page = await us.app.inject({ method: 'GET', url: '/?signed_in=1&moved=1', headers: { cookie: landed.session! } });
  assert.match(page.body, /PII United States/);
  assert.match(page.body, /so we brought you here/);
});

test('invited in neither country: one clear page, no loop', async () => {
  const first = await signIn(us, { sub: 'g-x', email: 'stranger@example.com', emailVerified: true });
  assert.ok(first.location.startsWith(`${CA}/auth/google/start?fb=1`));
  const second = await signIn(ca, { sub: 'g-x', email: 'stranger@example.com', emailVerified: true }, pathOf(first.location).replace('/auth/google/start', ''));
  assert.equal(second.location, `${CA}/login?error=unknown_user_both`);
  const page = await ca.app.inject({ method: 'GET', url: '/login?error=unknown_user_both' });
  assert.equal(page.statusCode, 403);
  assert.match(page.body, /isn’t invited in Canada or the United States/);
  assert.doesNotMatch(page.body, /Switch to the/, 'no switch button: both were tried');
});

test('the sign-in error page switches by starting sign-in on the other country, keeping the return page', async () => {
  const page = await ca.app.inject({ method: 'GET', url: '/login?error=unknown_user&next=%2Fapp' });
  assert.match(page.body, /href="https:\/\/us\.punjabinsurance\.co\/auth\/google\/start\?next=%2Fapp">Switch to the United States site/);
  assert.match(page.body, /href="\/auth\/google\/start\?next=%2Fapp">Try again/);
  const conflict = await ca.app.inject({ method: 'GET', url: '/login?error=identity_conflict' });
  assert.match(conflict.body, /A different Google account is linked/);
});

test('an invitation: the email offers the Chrome Web Store and the web app; after Accept the page offers both, then shows the install', async () => {
  process.env.PII_EXTENSION_URL = STORE;
  const mail = partnerInviteMail({ firm: 'Surrey branch', email: 'new@partner.test', acceptUrl: `${CA}/accept?token=t`, installUrl: STORE, appUrl: `${CA}/app`, country: 'Canada', locale: 'en' });
  assert.match(mail.html, new RegExp(`href="${STORE}"`));
  assert.match(mail.html, /href="https:\/\/ca\.punjabinsurance\.co\/app"/);
  assert.match(mail.text, /Your PII site: Canada\./);
  // The invitation page names the country.
  const token = 'invite-token-for-signin-regions-test-0001';
  await owner(ca, (c) => c.query(`INSERT INTO invitations (tenant_id,email,node_id,role,token_hash,expires_at) VALUES ($1,'new@partner.test',$2,'partner',$3,now() + interval '1 day')`, [ca.tenantId, ca.rootNodeId, hashToken(token)]));
  const accept = await ca.app.inject({ method: 'GET', url: `/accept?token=${token}` });
  assert.match(accept.body, /PII site<\/span><b>Canada<\/b>/);
  const r = await signIn(ca, { sub: 'g-new', email: 'new@partner.test', emailVerified: true, name: 'Navdeep Gill' }, `?invite=${token}&hint=new%40partner.test`);
  assert.equal(r.location, `${CA}/?signed_in=1&welcome=1`, 'an invitation lands on the welcome page');
  const welcome = await ca.app.inject({ method: 'GET', url: '/?signed_in=1&welcome=1', headers: { cookie: r.session! } });
  assert.match(welcome.body, /Welcome, Navdeep/);
  assert.match(welcome.body, new RegExp(`href="${STORE}"[^>]*>Add PII to Gmail`));
  assert.match(welcome.body, /href="\/app">Open PII/);
  assert.match(welcome.body, /PII Canada/);
  // Once the store copy checks in, the page says so.
  await ca.app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { cookie: r.session!, origin: CA } });
  const chk = await ca.app.inject({ method: 'POST', url: '/v1/extension/check-in', headers: { cookie: r.session!, origin: CA }, payload: { extensionId: STORE_ID, version: '1.7.0' } });
  assert.equal(chk.statusCode, 204, chk.body);
  const after = await ca.app.inject({ method: 'GET', url: '/?signed_in=1', headers: { cookie: r.session! } });
  assert.match(after.body, /Added to Gmail ✓/);
  assert.match(after.body, /close this tab/);
  // The links the in-app invitation email uses.
  const links = JSON.parse((await ca.app.inject({ method: 'GET', url: '/v1/access-links', headers: { cookie: r.session! } })).body);
  assert.deepEqual(links, { installUrl: STORE, appUrl: `${CA}/app`, country: { en: 'Canada', 'fr-CA': 'Canada' } });
});

test('with the store listing set: the install page points to it for anyone, the zip is retired, and a zip copy is asked to switch', async () => {
  process.env.PII_EXTENSION_URL = STORE;
  const page = await ca.app.inject({ method: 'GET', url: '/install?lang=en' });
  assert.equal(page.statusCode, 200, 'no sign-in needed');
  assert.match(page.body, new RegExp(`href="${STORE}"`));
  assert.doesNotMatch(page.body, /Download the extension \(zip\)/);
  const r = await signIn(ca, { sub: 'g-new', email: 'new@partner.test', emailVerified: true });
  assert.equal((await ca.app.inject({ method: 'GET', url: '/v1/extension/download', headers: { cookie: r.session! } })).statusCode, 410);
  const before = JSON.parse((await ca.app.inject({ method: 'GET', url: '/v1/extension/status', headers: { cookie: r.session! } })).body);
  assert.equal(before.zipCopySeen, false, 'only the store copy so far');
  await ca.app.inject({ method: 'POST', url: '/v1/extension/check-in', headers: { cookie: r.session!, origin: CA }, payload: { extensionId: ZIP_ID, version: '1.5.0' } });
  const st = JSON.parse((await ca.app.inject({ method: 'GET', url: '/v1/extension/status', headers: { cookie: r.session! } })).body);
  assert.equal(st.zipCopySeen, true);
  assert.equal(st.storeUrl, STORE);
});

test('home pages: a country signs in at its own /app; the neutral home names both countries', async () => {
  process.env.PII_EXTENSION_URL = STORE;
  const home = await ca.app.inject({ method: 'GET', url: '/?lang=en', headers: { host: 'ca.punjabinsurance.co' } });
  assert.match(home.body, /href="\/app">Sign in to PII/);
  assert.match(home.body, /Add PII to Gmail/);
  const neutral = await ca.app.inject({ method: 'GET', url: '/?lang=en', headers: { host: 'www.punjabinsurance.co' } });
  assert.match(neutral.body, /href="https:\/\/ca\.punjabinsurance\.co\/app">Sign in: Canada/);
  assert.match(neutral.body, /href="https:\/\/us\.punjabinsurance\.co\/app">Sign in: United States/);
});
