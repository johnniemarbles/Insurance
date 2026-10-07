import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { tell, withDigest } from '../src/routes-compliance.ts';
import { buildReminderMail, type Mail } from '../src/mailer.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
const sent: Mail[] = [];
let co: { tenantId: string; rootNodeId: string }; let ann = '';
async function call(email: string, method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* */ }
  return { status: res.statusCode, json };
}
before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), mailer: { send: async (m) => { sent.push(m); } } } as AppDeps;
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: 'admin@em.test' });
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  ann = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status,locale) VALUES ($1,'ann@em.test',$2,'active','fr-CA') RETURNING id`, [co.tenantId, co.rootNodeId])).rows[0].id;
  await o.end();
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('reminders are emailed in the person’s language; other notices are not', async () => {
  await tell(deps, co.tenantId, [ann], 'learning_due', null, { title: 'Privacy', daysLeft: 3, dueOn: '2026-10-10' });
  assert.equal(sent.length, 1); assert.equal(sent[0]!.to, 'ann@em.test'); assert.match(sent[0]!.subject, /Rappel de formation/); assert.match(sent[0]!.text, /dans 3 jours/);
  await tell(deps, co.tenantId, [ann], 'mention', null, { text: 'hi' });
  assert.equal(sent.length, 1, 'only reminder kinds are emailed');
});

test('a person can turn email reminders off', async () => {
  await call('ann@em.test', 'POST', '/v1/consent/first-login');
  assert.deepEqual((await call('ann@em.test', 'GET', '/v1/me/email-reminders')).json, { enabled: true, available: true });
  assert.equal((await call('ann@em.test', 'PUT', '/v1/me/email-reminders', { enabled: false })).status, 204);
  await tell(deps, co.tenantId, [ann], 'ce_reminder', null, { pack: 'QC', state: 'due', remaining: 5, termEnd: '2026-12-31' });
  assert.equal(sent.length, 1, 'nothing sent once off');
});

test('mail text is escaped and a failing mailer never breaks the work', async () => {
  const m = buildReminderMail(deps.config, 'a@b.c', 'learning_due', { title: '<b>x</b>', daysLeft: 0, dueOn: 'd' }, 'en')!;
  assert.ok(!m.html.includes('<b>x</b>'));
  const bad = { ...deps, mailer: { send: async () => { throw new Error('down'); } } } as AppDeps;
  await o2();
  await tell(bad, co.tenantId, [ann], 'learning_due', null, { title: 'T', daysLeft: 1, dueOn: 'd' });
});
async function o2() { const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect(); await o.query(`UPDATE app_users SET email_reminders = true`); await o.end(); }

test('a daily run sends one email per person, however many reminders', async () => {
  await o2();
  sent.length = 0;
  await withDigest(deps, async (d) => {
    await tell(d, co.tenantId, [ann], 'learning_due', null, { title: 'Privacy', daysLeft: 2, dueOn: 'd1' });
    await tell(d, co.tenantId, [ann], 'ce_reminder', null, { pack: 'QC', state: 'due', remaining: 5, termEnd: '2026-12-31' });
    await tell(d, co.tenantId, [ann], 'compliance_expiry', null, { name: 'Acme', label: 'Licence', daysLeft: 10 });
  });
  assert.equal(sent.length, 1); assert.match(sent[0]!.subject, /3 rappels/);
  assert.equal((sent[0]!.text.match(/^- /gm) ?? []).length, 3);
  const n = await (async () => { const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect(); try { return (await o.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [ann])).rows[0].n; } finally { await o.end(); } })();
  assert.ok(n >= 3, 'each reminder is still in the app');
});
