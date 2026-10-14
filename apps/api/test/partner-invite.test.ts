import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, signInWithGoogle, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepPartnerInviteReminders } from '../src/partner-invite.ts';
import type { Mail, Mailer } from '../src/mailer.ts';

let db: TestDb; let pools: Db[] = []; let base: AppDeps; let app: FastifyInstance; let refusingApp: FastifyInstance; let noMailApp: FastifyInstance;
const sent: Mail[] = [];
const OFFICER = 'officer@invite.test', PADMIN = 'padmin@invite.test', PLAIN = 'plain@invite.test';
let NODE_A = '', NODE_B = '', NODE_C = '', NODE_R = '', NODE_N = '', CASE_A = '', CASE_B = '';
let ownerNode = '';

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const tokenIn = (m: Mail) => /accept\?token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
const call = (a: FastifyInstance, email: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  a.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(payload ? { payload: payload as object } : {}) });

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  base = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  const mailer: Mailer = { send: async (m) => { sent.push(m); } };
  app = buildApp({ ...base, mailer });
  refusingApp = buildApp({ ...base, mailer: { send: async () => { throw new Error('Resend refused the sender'); } } });
  noMailApp = buildApp({ ...base, mailer: undefined });
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Invite Insurance', countryCode: 'CA', adminEmail: 'admin@invite.test' });
  await app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': 'admin@invite.test' } });
  const loc = (await app.inject({ method: 'POST', url: '/v1/org/locations', headers: { 'x-dev-user-email': 'admin@invite.test' }, payload: { name: 'Toronto' } })).json() as any;
  ownerNode = loc.id;
  const mk = async (name: string) => (await app.inject({ method: 'POST', url: '/v1/org/partners', headers: { 'x-dev-user-email': 'admin@invite.test' }, payload: { name, parentId: loc.id } })).json().id as string;
  NODE_A = await mk('Agency A'); NODE_B = await mk('Agency B'); NODE_C = await mk('Agency C'); NODE_R = await mk('Agency R'); NODE_N = await mk('Agency N');
  await owner(async (o) => {
    const ins = async (email: string) => (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [co.tenantId, email, loc.id])).rows[0].id;
    const role = async (u: string, node: string, r: string) => o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, node, r]);
    await role(await ins(OFFICER), loc.id, 'compliance');
    await role(await ins(PADMIN), NODE_A, 'admin');   // an administrator of Agency A
    await role(await ins(PLAIN), NODE_A, 'partner');  // a partner, not an administrator
  });
  await app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': OFFICER } });
  await app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': PADMIN } });
  await app.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': PLAIN } });
  (globalThis as any).__tenant = co.tenantId;
});
after(async () => { await Promise.all([app, refusingApp, noMailApp].map((a) => a.close())); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the Compliance officer invites an agency admin: one email with a login link, and the invitation is linked to the case', async () => {
  const before = sent.length;
  const res = await call(app, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: NODE_A, adminEmail: 'Owner@Agency-A.test', locale: 'en' });
  assert.equal(res.statusCode, 201, res.body);
  const json = JSON.parse(res.body);
  CASE_A = json.id;
  assert.equal(json.invitation.status, 'sent');
  assert.equal(json.invitation.email, 'owner@agency-a.test');
  assert.equal(sent.length, before + 1);
  const mail = sent.at(-1)!;
  assert.equal(mail.to, 'owner@agency-a.test');
  assert.equal(mail.subject, 'Invite Insurance invites you to PII');
  assert.match(mail.text, /\/install/, 'the email points to the extension install page');
  assert.ok(!res.body.includes(tokenIn(mail)), 'the response never carries the link token');
  const row = (await owner((o) => o.query('SELECT onboarding_case_id, role::text AS role, delivery_method, sent_at IS NOT NULL AS sent FROM invitations WHERE email = $1', ['owner@agency-a.test']))).rows.at(-1)!;
  assert.deepEqual({ linked: row.onboarding_case_id, role: row.role, method: row.delivery_method, sent: row.sent }, { linked: CASE_A, role: 'partner', method: 'resend', sent: true });
});

test('an administrator of the partner can also invite, and asking again replaces the link', async () => {
  const first = sent.at(-1)!;
  const res = await call(app, PADMIN, 'POST', '/v1/onboarding/cases', { nodeId: NODE_A, adminEmail: 'owner@agency-a.test' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).id, CASE_A, 'the same case is reused, not a second one');
  const second = sent.at(-1)!;
  assert.notEqual(tokenIn(first), tokenIn(second));
  const old = await signInWithGoogle(base.authPool, { sub: 'g-old', email: 'owner@agency-a.test', name: 'Owner' }, { inviteToken: tokenIn(first) });
  assert.deepEqual(old, { ok: false, reason: 'invitation_invalid' }, 'the earlier link stops working');
});

test('a token used by someone else is refused and the case is not marked as having a login', async () => {
  const res = await call(app, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: NODE_B, adminEmail: 'owner@agency-b.test' });
  assert.equal(res.statusCode, 201);
  CASE_B = JSON.parse(res.body).id;
  const token = tokenIn(sent.at(-1)!);
  const wrong = await signInWithGoogle(base.authPool, { sub: 'g-x', email: 'someone-else@agency-b.test', name: 'X' }, { inviteToken: token });
  assert.deepEqual(wrong, { ok: false, reason: 'email_mismatch' });
  const c = (await owner((o) => o.query('SELECT login_created_at FROM onboarding_cases WHERE id = $1', [CASE_B]))).rows[0];
  assert.equal(c.login_created_at, null);
});

test('accepting with the invited address creates the login and marks the case', async () => {
  const token = tokenIn(sent.at(-1)!);
  const ok = await signInWithGoogle(base.authPool, { sub: 'g-b', email: 'owner@agency-b.test', name: 'Owner B' }, { inviteToken: token });
  assert.equal(ok.ok, true);
  assert.equal((await call(app, 'owner@agency-b.test', 'POST', '/v1/consent/first-login')).statusCode, 204);
  const c = (await owner((o) => o.query('SELECT login_created_at FROM onboarding_cases WHERE id = $1', [CASE_B]))).rows[0];
  assert.ok(c.login_created_at, 'login_created_at is set');
});

test('the extension reports its install: recorded once per ID, and on the partner case', async () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  // The partner signed in above as owner@agency-b.test; the dev header signs in the same person.
  const first = await call(app, 'owner@agency-b.test', 'POST', '/v1/extension/check-in', { extensionId: id, version: '1.4.5' });
  assert.equal(first.statusCode, 204, first.body);
  const again = await call(app, 'owner@agency-b.test', 'POST', '/v1/extension/check-in', { extensionId: id, version: '1.4.6' });
  assert.equal(again.statusCode, 204);
  const rows = (await owner((o) => o.query(`SELECT version FROM extension_installs WHERE extension_id = $1`, [id]))).rows;
  assert.deepEqual(rows.map((r) => r.version), ['1.4.6']);
  const c = (await owner((o) => o.query('SELECT extension_installed_at FROM onboarding_cases WHERE id = $1', [CASE_B]))).rows[0];
  assert.ok(c.extension_installed_at, 'the case records the install');
  const bad = await call(app, 'owner@agency-b.test', 'POST', '/v1/extension/check-in', { extensionId: 'not-an-id', version: '1.0' });
  assert.equal(bad.statusCode, 400);
});

test('with no mail service the invite is created and says so; nothing is sent', async () => {
  const before = sent.length;
  const res = await call(noMailApp, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: NODE_N, adminEmail: 'owner@agency-n.test' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).invitation.status, 'not_sent');
  assert.match(JSON.parse(res.body).invitation.error, /not set up/);
  assert.equal(sent.length, before);
});

test('a refused send is reported with the reason', async () => {
  const res = await call(refusingApp, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: NODE_R, adminEmail: 'owner@agency-r.test' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).invitation.status, 'not_sent');
  assert.equal(JSON.parse(res.body).invitation.error, 'Resend refused the sender');
});

test('a partner who is not an administrator cannot invite', async () => {
  const res = await call(app, PLAIN, 'POST', '/v1/onboarding/cases', { nodeId: NODE_C, adminEmail: 'owner@agency-c.test' });
  assert.equal(res.statusCode, 403);
});

test('reminders go out at 24, 48 and 72 hours, each with a new link, and then stop', async () => {
  const res = await call(app, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: NODE_C, adminEmail: 'owner@agency-c.test' });
  assert.equal(res.statusCode, 201, res.body);
  const caseId = JSON.parse(res.body).id;
  const invId = JSON.parse(res.body).invitation.id;
  const age = (hours: number) => owner((o) => o.query(`UPDATE invitations SET sent_at = now() - make_interval(hours => $2) WHERE id = $1`, [invId, hours]));
  const reminders = () => owner((o) => o.query('SELECT reminders_sent FROM invitations WHERE id = $1', [invId])).then((r) => r.rows[0].reminders_sent);
  const countBefore = sent.length;
  const deps = { ...base, mailer: { send: async (m: Mail) => { sent.push(m); } } };
  await age(23); assert.equal(await sweepPartnerInviteReminders(deps), 0, 'not yet at 24 hours');
  await age(25);
  assert.equal(await sweepPartnerInviteReminders(deps), 1);
  assert.equal(await reminders(), 1);
  assert.match(sent.at(-1)!.subject, /^Reminder:/);
  assert.equal(await sweepPartnerInviteReminders(deps), 0, 'not again straight away');
  await age(49); assert.equal(await sweepPartnerInviteReminders(deps), 1); assert.equal(await reminders(), 2);
  await age(73); assert.equal(await sweepPartnerInviteReminders(deps), 1); assert.equal(await reminders(), 3);
  await age(200); assert.equal(await sweepPartnerInviteReminders(deps), 0, 'no more after three reminders');
  assert.equal(sent.length - countBefore, 3, 'three reminders');
  // Only the newest link works.
  const newest = tokenIn(sent.at(-1)!), older = tokenIn(sent.at(-2)!);
  assert.deepEqual(await signInWithGoogle(base.authPool, { sub: 'g-c', email: 'owner@agency-c.test', name: 'C' }, { inviteToken: older }), { ok: false, reason: 'invitation_invalid' });
  assert.equal(caseId.length, 36);
});

test('reminders are not sent to a link that has been opened', async () => {
  const node = (await call(app, 'admin@invite.test', 'POST', '/v1/org/partners', { name: 'Agency O', parentId: ownerNode })).json().id as string;
  const res = await call(app, OFFICER, 'POST', '/v1/onboarding/cases', { nodeId: node, adminEmail: 'owner@agency-o.test' });
  assert.equal(res.statusCode, 201, res.body);
  const invId = JSON.parse(res.body).invitation.id;
  await owner((o) => o.query(`UPDATE invitations SET sent_at = now() - interval '30 hours', link_opened_at = now() WHERE id = $1`, [invId]));
  const deps = { ...base, mailer: { send: async (m: Mail) => { sent.push(m); } } };
  const before = sent.length;
  await sweepPartnerInviteReminders(deps);
  assert.ok(!sent.slice(before).some((m) => m.to === 'owner@agency-o.test'));
});
