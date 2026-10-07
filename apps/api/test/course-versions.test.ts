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

test('assignment rules: preview first, role filter, days-after-joining due date, and late joiners', async () => {
  const lead = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Calgary' })).json.id;
  const mk = async (email: string, role: string) => owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [co.tenantId, email, email.split('@')[0], lead])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, u, lead, role]);
  });
  await mk('cy@cv.test', 'learner'); await mk('di@cv.test', 'manager');
  const p1 = (await call(ADMIN, 'POST', `/v1/courses/${course}/assignments/preview`, { nodeId: lead })).json;
  assert.equal(p1.total, 2); assert.equal(p1.willEnrol, 2);
  const p2 = (await call(ADMIN, 'POST', `/v1/courses/${course}/assignments/preview`, { nodeId: lead, role: 'manager' })).json;
  assert.equal(p2.total, 1); assert.equal(p2.sample[0].name, 'di');
  assert.equal((await call(ADMIN, 'POST', `/v1/courses/${course}/assignments`, { nodeId: lead, role: 'learner', dueInDays: 14, dueAt: '2030-01-01T00:00:00Z' })).status, 422, 'date and days together are refused');
  assert.equal((await call(A, 'POST', `/v1/courses/${course}/assignments/preview`, { nodeId: lead })).status, 403);
  const r = await call(ADMIN, 'POST', `/v1/courses/${course}/assignments`, { nodeId: lead, role: 'learner', dueInDays: 14 });
  assert.equal(r.status, 201); assert.equal(r.json.enrolled, 1);
  const due = (await owner((o) => o.query(`SELECT due_at > now() + interval '13 days' AND due_at < now() + interval '15 days' AS ok FROM enrollments e JOIN app_users u ON u.id = e.user_id WHERE u.email = 'cy@cv.test'`))).rows[0].ok;
  assert.equal(due, true);
  assert.equal((await call(ADMIN, 'POST', `/v1/courses/${course}/assignments/preview`, { nodeId: lead, role: 'learner' })).json.willEnrol, 0);
  await mk('ed@cv.test', 'learner');                                   // joins after the rule was made
  const { sweepAssignments } = await import('../src/routes-forecast.ts');
  assert.equal(await sweepAssignments({ config: undefined, appPool: pools[0], authPool: pools[1] } as unknown as AppDeps), 1);
  assert.equal((await call(ADMIN, 'GET', `/v1/courses/${course}/assignments`)).json.assignments[0].enrolled, 2);
});

test('quiz attempt rules: numbered tries, wait between them, pass ends it', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Rules quiz', ownerNodeId: co.rootNodeId })).json.id;
  const ql = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Check', type: 'quiz', passMark: 100 })).json.id;
  assert.equal((await call(ADMIN, 'PUT', `/v1/lessons/${ql}/quiz`, { questions: [{ prompt: 'Pick A', options: ['A', 'B'], correct: [0] }] })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/lessons/${ql}`, { cooldownMinutes: 30, maxAttempts: 5 })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  const qid = (await call(ADMIN, 'GET', `/v1/lessons/${ql}`)).json.quiz.questions[0].id;
  const wrong = await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['1'] } });
  assert.equal(wrong.status, 200); assert.equal(wrong.json.passed, false); assert.equal(wrong.json.attemptNo, 1); assert.equal(wrong.json.attemptsLeft, 4); assert.ok(wrong.json.nextAttemptAt);
  assert.equal((await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['0'] } })).status, 409, 'too soon');
  const view = (await call(A, 'GET', `/v1/lessons/${ql}`)).json.quiz;
  assert.equal(view.status.reason, 'cooldown'); assert.equal(view.cooldownMinutes, 30); assert.equal(view.attempts[0].attemptNo, 1);
  await owner((o) => o.query(`UPDATE quiz_attempts SET attempted_at = now() - interval '31 minutes' WHERE lesson_id = $1`, [ql]));
  const ok = await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['0'] } });
  assert.equal(ok.json.passed, true); assert.equal(ok.json.attemptNo, 2);
  assert.equal((await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['0'] } })).status, 409, 'already passed');
  const rec = (await owner((o) => o.query(`SELECT attempt_no, course_version FROM quiz_attempts WHERE lesson_id = $1 ORDER BY attempt_no`, [ql]))).rows;
  assert.deepEqual(rec.map((r: any) => [r.attempt_no, r.course_version]), [[1, 1], [2, 1]]);
});

test('step-by-step courses: later lessons stay locked, and continue points at the right lesson', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'In order', ownerNodeId: co.rootNodeId })).json.id;
  const a = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'First', type: 'richtext', text: 'x' })).json.id;
  const b = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Second', type: 'richtext', text: 'y' })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { sequential: true })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { sequential: false })).status, 409, 'locked while published');
  const first = (await call(B, 'GET', `/v1/courses/${c}`)).json;
  assert.deepEqual(first.lessons.map((l: any) => l.locked), [false, true]);
  assert.equal((await call(B, 'GET', `/v1/lessons/${b}`)).status, 403);
  assert.equal((await call(B, 'POST', `/v1/lessons/${b}/complete`)).status, 403);
  assert.equal((await call(ADMIN, 'GET', `/v1/lessons/${b}`)).status, 200, 'authors are not held back');
  assert.equal((await call(B, 'POST', `/v1/lessons/${a}/complete`)).status, 200);
  const next = (await call(B, 'GET', `/v1/courses/${c}`)).json;
  assert.deepEqual(next.lessons.map((l: any) => l.locked), [false, false]);
  assert.equal(next.resumeLessonId, b);
  await call(B, 'GET', `/v1/lessons/${b}`);
  assert.equal((await call(B, 'GET', `/v1/courses/${c}`)).json.resumeLessonId, b);
  assert.equal((await call(B, 'POST', `/v1/lessons/${b}/complete`)).json.completed, true);
  assert.equal((await call(B, 'GET', `/v1/courses/${c}`)).json.resumeLessonId, null);
});
