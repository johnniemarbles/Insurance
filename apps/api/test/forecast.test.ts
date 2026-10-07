import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepLearnerReminders } from '../src/routes-forecast.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string };
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@fc.test', L1 = 'lee@fc.test', L2 = 'sam@fc.test';
let P1 = '', P2 = '', course = '', L1id = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const loc = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const ag = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency One', parentId: loc })).json.id;
  P1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Lee Broker', parentId: ag })).json.id;
  P2 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sam Broker', parentId: ag })).json.id;
  for (const [email, home, name] of [[L1, P1, 'Lee Learner'], [L2, P2, 'Sam Learner']] as const) {
    await owner(async (o) => {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, name, home])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'learner')`, [co.tenantId, u, home]);
      if (email === L1) L1id = u;
    });
    await call(email, 'POST', '/v1/consent/first-login');
  }
  course = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Privacy basics', ownerNodeId: co.rootNodeId })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the calendar groups licences, E&O and course due dates into 30/60/90 and overdue', async () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await call(ADMIN, 'POST', `/v1/compliance/partners/${P1}/items`, { kind: 'licence', label: 'Life licence', lines: ['life'], expiresOn: day(20) })).status, 201);
  assert.equal((await call(ADMIN, 'POST', `/v1/compliance/partners/${P1}/items`, { kind: 'eo', label: 'E&O policy', limitAmount: 1000000, expiresOn: day(75) })).status, 201);
  assert.equal((await call(ADMIN, 'POST', `/v1/compliance/partners/${P2}/items`, { kind: 'licence', label: 'Old licence', lines: ['life'], expiresOn: day(-5) })).status, 201);
  await owner((o) => o.query(`INSERT INTO enrollments (tenant_id,user_id,course_id,learner_node_id,status,due_at) VALUES ($1,$2,$3,$4,'assigned', now() + interval '45 days')`, [co.tenantId, L1id, course, P1]));
  const r = (await call(ADMIN, 'GET', '/v1/compliance/calendar')).json;
  assert.deepEqual(r.groups.overdue.map((x: any) => x.label), ['Old licence']);
  assert.deepEqual(r.groups.d30.map((x: any) => x.label), ['Life licence']);
  assert.deepEqual(r.groups.d60.map((x: any) => x.label), ['Privacy basics']);
  assert.deepEqual(r.groups.d90.map((x: any) => x.label), ['E&O policy']);
  assert.equal(r.counts.d90, 1);
  // a learner sees their own course, not other people's partner files
  const mine = (await call(L1, 'GET', '/v1/compliance/calendar')).json;
  assert.ok(mine.groups.d60.some((x: any) => x.kind === 'course'));
  assert.ok(!mine.groups.overdue.some((x: any) => x.label === 'Old licence'));
});

test('learners are nudged once when a course is a week out, and once when it is late', async () => {
  await owner((o) => o.query(`UPDATE enrollments SET due_at = now() + interval '3 days' WHERE user_id = $1`, [L1id]));
  const first = await sweepLearnerReminders(deps);
  assert.ok(first >= 1);
  assert.equal(await sweepLearnerReminders(deps), 0, 'a second sweep sends nothing');
  const n = (await call(L1, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'learning_due');
  assert.equal(n.length, 1); assert.equal(n[0].data.title, 'Privacy basics');
  assert.equal((await call(L2, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'learning_due').length, 0);
  await owner((o) => o.query(`UPDATE enrollments SET due_at = now() - interval '2 days' WHERE user_id = $1`, [L1id]));
  assert.equal(await sweepLearnerReminders(deps), 1);
  assert.equal((await call(L1, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'learning_due').length, 2);
  await owner((o) => o.query(`UPDATE enrollments SET status = 'completed' WHERE user_id = $1`, [L1id]));
  await owner((o) => o.query(`UPDATE enrollments SET due_at = now() - interval '9 days' WHERE user_id = $1`, [L1id]));
  assert.equal(await sweepLearnerReminders(deps), 0, 'finished courses are not chased');
});
