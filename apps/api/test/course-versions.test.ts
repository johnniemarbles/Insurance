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
let co: { tenantId: string; rootNodeId: string };
async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const ADMIN = 'admin@cv.test', A = 'ann@cv.test', B = 'bob@cv.test';
let course = '', l1 = '', l2 = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') } as AppDeps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  for (const e of [A, B]) {
    await owner(async (o) => {
      const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [co.tenantId, e, co.rootNodeId])).rows[0].id;
      await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'learner')`, [co.tenantId, u, co.rootNodeId]);
    });
    await call(e, 'POST', '/v1/consent/first-login');
  }
  course = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Privacy basics', ownerNodeId: co.rootNodeId })).json.id;
  l1 = (await call(ADMIN, 'POST', `/v1/courses/${course}/lessons`, { title: 'One', type: 'richtext', text: 'first' })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('publishing makes version 1; a published course is locked', async () => {
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { status: 'published' })).status, 204);
  assert.equal((await call(ADMIN, 'GET', `/v1/courses/${course}`)).json.version, 1);
  assert.equal((await call(ADMIN, 'POST', `/v1/courses/${course}/lessons`, { title: 'Two', type: 'richtext', text: 'x' })).status, 409);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/lessons/${l1}`, { text: 'changed' })).status, 409);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/lessons/${l1}`)).status, 409);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { title: 'Privacy basics (2026)' })).status, 204, 'a title fix is allowed');
  const v = (await call(ADMIN, 'GET', `/v1/courses/${course}/versions`)).json.versions;
  assert.equal(v.length, 1); assert.equal(v[0].version, 1); assert.equal(v[0].lessons, 1);
  assert.equal((await call(A, 'GET', `/v1/courses/${course}/versions`)).status, 403);
});

test('learners are pinned; republishing unchanged content keeps the version', async () => {
  assert.equal((await call(A, 'POST', `/v1/lessons/${l1}/complete`)).json.completed, true);
  assert.equal((await call(B, 'POST', `/v1/courses/${course}/enroll`)).status, 201);
  assert.equal((await call(A, 'GET', '/v1/my/learning')).json.enrollments[0].courseVersion, 1);
  await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { status: 'draft' });
  await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { status: 'published' });
  assert.equal((await call(ADMIN, 'GET', `/v1/courses/${course}`)).json.version, 1);
});

test('changed content makes version 2: finished learners stay on 1, others move to 2', async () => {
  await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { status: 'draft' });
  l2 = (await call(ADMIN, 'POST', `/v1/courses/${course}/lessons`, { title: 'Two', type: 'richtext', text: 'second' })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${course}`, { status: 'published' })).status, 204);
  assert.equal((await call(ADMIN, 'GET', `/v1/courses/${course}`)).json.version, 2);
  const a = (await call(A, 'GET', '/v1/my/learning')).json.enrollments[0];
  const b = (await call(B, 'GET', '/v1/my/learning')).json.enrollments[0];
  assert.equal(b.courseVersion, 2); assert.equal(b.outdated, false);
  assert.equal(a.latestVersion, 2);
  const vs = (await call(ADMIN, 'GET', `/v1/courses/${course}/versions`)).json.versions;
  assert.deepEqual(vs.map((x: any) => x.version), [2, 1]); assert.equal(vs[0].lessons, 2); assert.equal(vs[1].lessons, 1);
});

test('a version row can never be changed or removed', async () => {
  await assert.rejects(owner((o) => o.query(`UPDATE course_versions SET snapshot = '{}'`)), /cannot be changed/);
  await assert.rejects(owner((o) => o.query(`DELETE FROM course_versions WHERE version = 1`)), /cannot be removed/);
});
