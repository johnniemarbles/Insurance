// Trainer dashboard (plan v6, section 9): course assignments and completion for the branches the trainer is assigned to.
// The trainer sees progress and dates only. A learner, or a trainer of another branch, sees none of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

const ADMIN = 'admin@td.test', TRAINER = 'trainer@td.test', LEARN_TOR = 'learner-tor@td.test', LEARN_OTT = 'learner-ott@td.test', OTT_TRAINER = 'trainer-ott@td.test';
let TOR = '', OTT = '', COURSE = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Training Dash Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  TOR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  OTT = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Ottawa' })).json.id;
  const people: [string, string, string][] = [[TRAINER, TOR, 'trainer'], [OTT_TRAINER, OTT, 'trainer'], [LEARN_TOR, TOR, 'learner'], [LEARN_OTT, OTT, 'learner']];
  const ids: Record<string, string> = {};
  await owner(async (o) => {
    for (const [email, node, role] of people) {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], node])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4::org_role)`, [co.tenantId, u, node, role]);
      ids[email] = u;
    }
  });
  for (const [email] of people) await call(email, 'POST', '/v1/consent/first-login');
  COURSE = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Privacy basics', ownerNodeId: co.rootNodeId })).json.id;
  // Learners are only enrolled in published courses, and a trainer sees a course's title only once it is published.
  await owner((o) => o.query(`UPDATE courses SET status = 'published' WHERE id = $1`, [COURSE]));
  await owner(async (o) => {
    await o.query(`INSERT INTO enrollments (tenant_id,user_id,course_id,learner_node_id,status,progress_pct,due_at) SELECT tenant_id, $1, $2, $3, 'in_progress', 40, now() + interval '3 days' FROM org_nodes WHERE id = $3`, [ids[LEARN_TOR], COURSE, TOR]);
    await o.query(`INSERT INTO enrollments (tenant_id,user_id,course_id,learner_node_id,status,due_at) SELECT tenant_id, $1, $2, $3, 'assigned', now() - interval '2 days' FROM org_nodes WHERE id = $3`, [ids[LEARN_OTT], COURSE, OTT]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a trainer sees its branch: assignments, progress, and what is due', async () => {
  const r = await call(TRAINER, 'GET', '/v1/training/dashboard');
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.totals.assigned, 1);
  assert.equal(r.json.totals.inProgress, 1);
  assert.equal(r.json.totals.completed, 0);
  assert.equal(r.json.totals.overdue, 0);
  assert.equal(r.json.courses[0].title, 'Privacy basics');
  assert.deepEqual(r.json.branches.map((b: any) => b.name), ['Toronto']);
});

test('the Ottawa trainer sees Ottawa only: its learner is overdue', async () => {
  const r = await call(OTT_TRAINER, 'GET', '/v1/training/dashboard');
  assert.equal(r.json.totals.assigned, 1);
  assert.equal(r.json.totals.overdue, 1);
  assert.deepEqual(r.json.branches.map((b: any) => b.name), ['Ottawa']);
});

test('a learner has no training dashboard', async () => {
  assert.equal((await call(LEARN_TOR, 'GET', '/v1/training/dashboard')).status, 403);
});
