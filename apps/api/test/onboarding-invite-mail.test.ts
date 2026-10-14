import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import type { Mailer } from '../src/mailer.ts';

// The invite response says whether an email went out, so admins can tell a missing mail service from a missing partner login.
let db: TestDb; let pools: Db[] = []; let base: AppDeps; let ADMIN_TENANT = '';
const ADMIN = 'admin@mail.test', OFFICER = 'officer@mail.test';
const sent: { to: string; subject: string }[] = [];

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function userWithRole(tenantId: string, email: string, node: string, role: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, node])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, node, role]);
  });
}
function appWith(mailer?: Mailer) {
  const deps: AppDeps = { ...base, mailer };
  return buildApp(deps);
}
async function invite(app: FastifyInstance, nodeId: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/onboarding/cases', headers: { 'x-dev-user-email': OFFICER }, payload: { nodeId, country: 'CA' } });
  return { status: res.statusCode, json: JSON.parse(res.body) as any };
}

let withMail: FastifyInstance; let noMail: FastifyInstance; let refusing: FastifyInstance;
let P1 = '', P2 = '', P3 = '', P4 = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  base = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  const boot = buildApp(base);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Mail Insurance', countryCode: 'CA', adminEmail: ADMIN });
  ADMIN_TENANT = co.tenantId;
  await boot.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': ADMIN } });
  const loc = (await boot.inject({ method: 'POST', url: '/v1/org/locations', headers: { 'x-dev-user-email': ADMIN }, payload: { name: 'Toronto' } })).json() as any;
  const mk = async (name: string) => (await boot.inject({ method: 'POST', url: '/v1/org/partners', headers: { 'x-dev-user-email': ADMIN }, payload: { name, parentId: loc.id } })).json().id as string;
  P1 = await mk('Partner One'); P2 = await mk('Partner Two'); P3 = await mk('Partner Three'); P4 = await mk('Partner Four');
  await owner(async (o) => { await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active')`, [co.tenantId, 'officer@mail.test', loc.id]); });
  await owner(async (o) => {
    const off = (await o.query(`SELECT id FROM app_users WHERE email = 'officer@mail.test'`)).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'compliance')`, [co.tenantId, off, loc.id]);
  });
  await userWithRole(co.tenantId, 'partner-one@mail.test', P1, 'admin');
  await userWithRole(co.tenantId, 'partner-two@mail.test', P2, 'admin');
  await userWithRole(co.tenantId, 'partner-three@mail.test', P3, 'admin');
  await boot.inject({ method: 'POST', url: '/v1/consent/first-login', headers: { 'x-dev-user-email': OFFICER } });
  await boot.close();
  withMail = appWith({ send: async (m: { to: string; subject: string }) => { sent.push({ to: m.to, subject: m.subject }); } } as unknown as Mailer);
  refusing = appWith({ send: async () => { throw new Error('Resend refused the sender'); } } as unknown as Mailer);
  noMail = appWith(undefined);
});
after(async () => { await Promise.all([withMail, noMail, refusing].map((a) => a.close())); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('no mail service: the invite says so, and nothing is emailed even though the partner has a login', async () => {
  const r = await invite(noMail, P3);
  assert.equal(r.status, 201);
  assert.deepEqual({ mailConfigured: r.json.mailConfigured, recipients: r.json.recipients, emailedTo: r.json.emailedTo }, { mailConfigured: false, recipients: 1, emailedTo: 0 });
});

test('mail service configured: each partner login is emailed with the firm name', async () => {
  const r = await invite(withMail, P1);
  assert.equal(r.status, 201);
  assert.deepEqual({ mailConfigured: r.json.mailConfigured, recipients: r.json.recipients, emailedTo: r.json.emailedTo }, { mailConfigured: true, recipients: 1, emailedTo: 1 });
  assert.deepEqual(sent.at(-1), { to: 'partner-one@mail.test', subject: 'Partner onboarding with Mail Insurance' });
});

test('a partner with no login: the mail service is fine but there is no one to email', async () => {
  const r = await invite(withMail, P4);
  assert.equal(r.status, 201);
  assert.deepEqual({ mailConfigured: r.json.mailConfigured, recipients: r.json.recipients, emailedTo: r.json.emailedTo }, { mailConfigured: true, recipients: 0, emailedTo: 0 });
});

test('a refused send is reported as zero emailed, not as a missing login', async () => {
  const r = await invite(refusing, P2);
  assert.equal(r.status, 201);
  assert.deepEqual({ mailConfigured: r.json.mailConfigured, recipients: r.json.recipients, emailedTo: r.json.emailedTo }, { mailConfigured: true, recipients: 1, emailedTo: 0 });
});
