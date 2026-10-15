// External auditor engagements (annual-review plan, section C). The auditor has no roles: only an engagement with a scope and an
// end date. Everything it opens is recorded, and access stops at the end date or when the inviter ends the engagement early.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { signInWithGoogle } from '@pii/db';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let authPool: Db;
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

const ADMIN = 'admin@ae.test', OFF = 'officer@ae.test', MGR = 'manager@ae.test', AUD = 'auditor@ext.test', AUD_B = 'auditor-b@ext.test';
const today = () => new Date().toISOString().slice(0, 10);
const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

let TOR = '';
let E1 = '', E1_TOKEN = '', E2 = '', E2_TOKEN = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authP = createPool(db.authUrl, 2); pools = [appPool, authP]; authPool = authP;
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Audit Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  await owner(async (o) => {
    for (const [email, role] of [[OFF, 'compliance'], [MGR, 'manager']] as const) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], TOR])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4::org_role)`, [co.tenantId, u, TOR, role]);
    }
  });
  for (const e of [OFF, MGR]) await call(e, 'POST', '/v1/consent/first-login');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the Compliance Manager invites an external auditor for a named engagement; the scope and default end date are saved', async () => {
  const r = await call(OFF, 'POST', '/v1/audit/engagements', {
    email: AUD, title: '2026 annual review', deputedBy: 'regulator', deputedByName: 'Regulator', scope: ['policies', 'complaints_log'], startsOn: today(),
  });
  assert.equal(r.status, 201, r.raw);
  assert.match(r.json.acceptUrl, /accept\?token=/);
  E1 = r.json.id; E1_TOKEN = tokenFrom(r.json.acceptUrl);
  const d = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(r.json.endsOn, d, 'thirty days by default');
  const row = (await owner((o) => o.query(`SELECT scope, masked, deputed_by FROM audit_engagements WHERE id = $1`, [E1])).then((x) => x.rows[0]))!;
  assert.deepEqual(row.scope, ['policies', 'complaints_log']);
  assert.equal(row.masked, true, 'client files are masked unless the scope says otherwise');
});

test('only a tenant administrator or a Compliance Manager invites; a branch manager cannot', async () => {
  assert.equal((await call(MGR, 'POST', '/v1/audit/engagements', { email: 'x@ext.test', title: 'Nope', deputedBy: 'insurer', scope: ['policies'], startsOn: today() })).status, 403);
  const ok = await call(ADMIN, 'POST', '/v1/audit/engagements', { email: AUD_B, title: 'Insurer review', deputedBy: 'insurer', scope: ['training_records'], startsOn: today() });
  assert.equal(ok.status, 201, ok.raw);
  E2 = ok.json.id; E2_TOKEN = tokenFrom(ok.json.acceptUrl);
});

test('the scope is limited to the four areas, and the dates are checked', async () => {
  assert.equal((await call(OFF, 'POST', '/v1/audit/engagements', { email: 'y@ext.test', title: 'Bad scope', deputedBy: 'other', scope: ['crm'], startsOn: today() })).status, 400);
  assert.equal((await call(OFF, 'POST', '/v1/audit/engagements', { email: 'y@ext.test', title: 'Too long', deputedBy: 'other', scope: ['policies'], startsOn: today(), endsOn: '2028-01-01' })).status, 422);
  assert.equal((await call(OFF, 'POST', '/v1/audit/engagements', { email: 'y@ext.test', title: 'Backwards', deputedBy: 'other', scope: ['policies'], startsOn: '2026-12-01', endsOn: '2026-11-01' })).status, 422);
});

test('someone who already has a role here cannot be made the auditor', async () => {
  assert.equal((await call(OFF, 'POST', '/v1/audit/engagements', { email: MGR, title: 'Not a staff member', deputedBy: 'other', scope: ['policies'], startsOn: today() })).status, 409);
});

test('the auditor signs in with the invitation and sees only its own engagement, with no other access', async () => {
  const ok = await signInWithGoogle(authPool, { sub: 'g-aud', email: AUD, name: 'Auditor' }, { inviteToken: E1_TOKEN });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  await call(AUD, 'POST', '/v1/consent/first-login');
  const mine = await call(AUD, 'GET', '/v1/audit/me');
  assert.equal(mine.status, 200, mine.raw);
  assert.deepEqual(mine.json.engagements.map((e: any) => e.id), [E1]);
  assert.equal(mine.json.engagements[0].status, 'active');
  const cases = await call(AUD, 'GET', '/v1/onboarding/cases');
  assert.equal((cases.json?.cases ?? []).length, 0, 'no broker files');
});

test('the auditor opens an engagement, and the opening is recorded in the audit trail', async () => {
  const r = await call(AUD, 'GET', `/v1/audit/engagements/${E1}/access`);
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(r.json.scope, ['policies', 'complaints_log']);
  assert.equal(r.json.masked, true);
  const rows = await owner((o) => o.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'audit_engagement_viewed' AND entity_id = $1`, [E1]));
  assert.equal(rows.rows[0].n, 1);
});

test('an engagement the inviter ends early stops access at once; the other engagement still works', async () => {
  await signInWithGoogle(authPool, { sub: 'g-aud-b', email: AUD_B, name: 'Auditor B' }, { inviteToken: E2_TOKEN });
  await call(AUD_B, 'POST', '/v1/consent/first-login');
  assert.equal((await call(AUD_B, 'GET', `/v1/audit/engagements/${E2}/access`)).status, 200);
  assert.equal((await call(ADMIN, 'POST', `/v1/audit/engagements/${E2}/end`)).status, 204);
  assert.equal((await call(AUD_B, 'GET', `/v1/audit/engagements/${E2}/access`)).status, 403, 'ended early');
  assert.equal((await call(ADMIN, 'POST', `/v1/audit/engagements/${E2}/end`)).status, 409, 'already ended');
});

test('a branch manager cannot end an engagement', async () => {
  assert.ok([403, 404].includes((await call(MGR, 'POST', `/v1/audit/engagements/${E1}/end`)).status));
});

test('access stops on the end date by itself, with nobody acting', async () => {
  await owner((o) => o.query(`UPDATE audit_engagements SET starts_on = current_date - 40, ends_on = current_date - 1 WHERE id = $1`, [E1]));
  assert.equal((await call(AUD, 'GET', `/v1/audit/engagements/${E1}/access`)).status, 403);
  const mine = await call(AUD, 'GET', '/v1/audit/me');
  assert.equal(mine.json.engagements[0].status, 'ended');
});
