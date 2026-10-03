import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenant: { tenantId: string; rootNodeId: string; adminUserId: string };

async function call(email: string | null, method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: email ? { 'x-dev-user-email': email } : {}, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}

async function seedUser(email: string, home: string, role: string) {
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenant.tenantId, email, home])).rows[0].id;
  await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenant.tenantId, u, home, role]);
  await o.end();
  await call(email, 'POST', '/v1/consent/first-login');
}

const ADMIN = 'admin@pii.test';
let X = '', Y = '', P1 = '', P2 = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool) });
  tenant = await bootstrapTenant(db.ownerUrl, { name: 'PII Test Co', countryCode: 'CA', adminEmail: ADMIN });
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

test('health and readiness (region check)', async () => {
  assert.equal((await call(null, 'GET', '/healthz')).status, 200);
  const r = await call(null, 'GET', '/readyz');
  assert.equal(r.status, 200);
  assert.equal(r.json.region, 'ca-qc');
});

test('requests without sign-in are refused; unknown users too', async () => {
  assert.equal((await call(null, 'GET', '/v1/me')).status, 401);
  assert.equal((await call('nobody@pii.test', 'GET', '/v1/me')).status, 401);
});

test('first sign-in activates the invited admin', async () => {
  const me = await call(ADMIN, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.isTenantAdmin, true);
  assert.equal(me.json.region, 'ca-qc');
  assert.equal(me.json.tenant.name, 'PII Test Co');
  assert.equal(me.json.needsConsent, true);
  assert.equal((await call(ADMIN, 'GET', '/v1/org/nodes')).status, 403); // consent first
  assert.equal((await call(ADMIN, 'POST', '/v1/consent/first-login')).status, 204);
  assert.equal((await call(ADMIN, 'GET', '/v1/me')).json.needsConsent, false);
});

test('tenant admin builds locations and partners', async () => {
  let r = await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' });
  assert.equal(r.status, 201);
  X = r.json.id;
  r = await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver' });
  Y = r.json.id;
  r = await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner One', parentId: X });
  assert.equal(r.status, 201);
  assert.equal(r.json.kind, 'location_link');
  P1 = r.json.id;
  P2 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner Two', parentId: X })).json.id;
  await seedUser('p1@pii.test', P1, 'admin');
  await seedUser('p2@pii.test', P2, 'admin');
});

test('validation: bad body and bad ids are rejected', async () => {
  assert.equal((await call(ADMIN, 'POST', '/v1/org/locations', { name: '' })).status, 400);
  assert.equal((await call(ADMIN, 'POST', '/v1/org/partners', { name: 'x', parentId: 'nope' })).status, 400);
  assert.equal((await call(ADMIN, 'POST', '/v1/org/partners', { name: 'x', parentId: '00000000-0000-4000-8000-000000000000' })).status, 404);
});

test('a partner admin cannot create locations or partners under a location', async () => {
  assert.equal((await call('p1@pii.test', 'POST', '/v1/org/locations', { name: 'Evil' })).status, 403);
  assert.equal((await call('p1@pii.test', 'POST', '/v1/org/partners', { name: 'Sneaky', parentId: X })).status, 403);
});

test('a partner admin adds sub-partners beneath itself, up to the depth cap', async () => {
  let parent = P1;
  const chain: string[] = [];
  for (let level = 2; level <= 5; level++) {
    const r = await call('p1@pii.test', 'POST', '/v1/org/partners', { name: `Level ${level}`, parentId: parent });
    assert.equal(r.status, 201, `level ${level}`);
    assert.equal(r.json.kind, 'partner_link');
    parent = r.json.id;
    chain.push(parent);
  }
  const tooDeep = await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Level 6', parentId: parent });
  assert.equal(tooDeep.status, 422);
  assert.match(tooDeep.json.error.message, /depth/);
});

test('siblings are isolated: P2 cannot see or build under P1', async () => {
  const nodes = await call('p2@pii.test', 'GET', '/v1/org/nodes');
  const names = nodes.json.nodes.map((n: any) => n.name).sort();
  assert.deepEqual(names, ['PII Test Co', 'Partner Two', 'Toronto']);
  assert.equal((await call('p2@pii.test', 'POST', '/v1/org/partners', { name: 'Intruder', parentId: P1 })).status, 404);
  const links = await call('p2@pii.test', 'GET', '/v1/org/links');
  assert.equal(links.json.links.length, 1); // only Toronto -> Partner Two
});

test('the location manager view includes every partner beneath it', async () => {
  const names = (await call(ADMIN, 'GET', '/v1/org/nodes')).json.nodes.map((n: any) => n.name);
  assert.ok(names.includes('Level 5') && names.includes('Partner Two'));
});

test('a loop is rejected', async () => {
  const level2 = (await call(ADMIN, 'GET', '/v1/org/links')).json.links.find((l: any) => l.parentId === P1).childId;
  const r = await call(ADMIN, 'POST', '/v1/org/links', { parentId: level2, childId: P1 });
  assert.equal(r.status, 409);
});

test('a partner can serve a second location (tenant admin links it); non-admins cannot link', async () => {
  assert.equal((await call('p1@pii.test', 'POST', '/v1/org/links', { parentId: Y, childId: P1 })).status, 403);
  const ok = await call(ADMIN, 'POST', '/v1/org/links', { parentId: Y, childId: P1 });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.kind, 'location_link');
  assert.equal((await call(ADMIN, 'POST', '/v1/org/links', { parentId: Y, childId: P1 })).status, 409); // duplicate
  assert.equal((await call(ADMIN, 'POST', '/v1/org/links', { parentId: X, childId: Y })).status, 422); // location -> location
  // P1 now sees both its locations; P2 still sees only its own.
  const p1Names = (await call('p1@pii.test', 'GET', '/v1/org/nodes')).json.nodes.map((n: any) => n.name);
  assert.ok(p1Names.includes('Toronto') && p1Names.includes('Vancouver'));
  const p2Names = (await call('p2@pii.test', 'GET', '/v1/org/nodes')).json.nodes.map((n: any) => n.name);
  assert.ok(!p2Names.includes('Vancouver'));
});

test('removing links: partners may remove sub-partner links beneath them, not location links', async () => {
  assert.equal((await call('p2@pii.test', 'DELETE', `/v1/org/links?parentId=${X}&childId=${P1}`)).status, 404); // cannot even see P1's link target
  assert.equal((await call('p1@pii.test', 'DELETE', `/v1/org/links?parentId=${Y}&childId=${P1}`)).status, 403);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/org/links?parentId=${Y}&childId=${P1}`)).status, 204);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/org/links?parentId=${Y}&childId=${P1}`)).status, 404);
});

test('invitations: scoped to the branch you administer', async () => {
  const l2 = (await call('p1@pii.test', 'GET', '/v1/org/links')).json.links.find((l: any) => l.kind === 'partner_link' && l.parentId === P1).childId;
  const ok = await call('p1@pii.test', 'POST', '/v1/invitations', { email: 'New.Hire@Example.com', nodeId: l2, role: 'member', locale: 'fr-CA' });
  assert.equal(ok.status, 201);
  assert.match(ok.json.acceptUrl, /^https:\/\/app\.punjabinsurance\.net\/accept\?token=/);
  assert.equal((await call('p1@pii.test', 'POST', '/v1/invitations', { email: 'a@b.co', nodeId: P2 })).status, 404);
  assert.equal((await call('p1@pii.test', 'POST', '/v1/invitations', { email: 'a@b.co', nodeId: tenant.rootNodeId, role: 'admin' })).status, 403);
  assert.equal((await call('p1@pii.test', 'POST', '/v1/invitations', { email: 'not-an-email', nodeId: l2 })).status, 400);
  assert.equal((await call('p2@pii.test', 'GET', '/v1/invitations')).json.invitations.length, 0);
  const mine = (await call('p1@pii.test', 'GET', '/v1/invitations')).json.invitations;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].email, 'new.hire@example.com');
  assert.ok(!('token' in mine[0]) && !('token_hash' in mine[0]));
});

test('audit log: tenant admin only, and structure changes are recorded', async () => {
  assert.equal((await call('p1@pii.test', 'GET', '/v1/audit')).status, 403);
  const events = (await call(ADMIN, 'GET', '/v1/audit')).json.events;
  const actions = new Set(events.map((e: any) => e.action));
  for (const a of ['tenant_created', 'node_created', 'link_changed', 'invitation_created']) assert.ok(actions.has(a), a);
});

test('users list is branch-scoped', async () => {
  const p2 = (await call('p2@pii.test', 'GET', '/v1/users')).json.users.map((u: any) => u.email);
  assert.deepEqual(p2, ['p2@pii.test']);
  const all = (await call(ADMIN, 'GET', '/v1/users')).json.users.length;
  assert.equal(all, 3);
});

test('landing pages exist for sign-in return, errors and privacy', async () => {
  const home = await app.inject({ method: 'GET', url: '/?signed_in=1' });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /You are signed in/);
  assert.equal((await app.inject({ method: 'GET', url: '/privacy' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/login?error=<script>' })).statusCode, 403);
  const logo = await app.inject({ method: 'GET', url: '/brand/logo.png' });
  assert.equal(logo.statusCode, 200);
  assert.equal(logo.headers['content-type'], 'image/png');
});
