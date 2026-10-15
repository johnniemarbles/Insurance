import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenant: { tenantId: string; rootNodeId: string; adminUserId: string };
type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}
async function seedUser(email: string, home: string, role: string) {
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [tenant.tenantId, email, email.split('@')[0], home])).rows[0].id;
  await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenant.tenantId, u, home, role]);
  await o.end();
  await call(email, 'POST', '/v1/consent/first-login');
  return u as string;
}
const ADMIN = 'admin@lms.test', P1U = 'p1@lms.test', P2U = 'p2@lms.test', S1U = 's1@lms.test', LRN = 'learner@lms.test';
let X = '', P1 = '', P2 = '', S1 = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenant = await bootstrapTenant(db.ownerUrl, { name: 'LMS Test Co', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  S1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sub One', parentId: P1 })).json.id;
  await seedUser(P1U, P1, 'manager');
  await seedUser(P2U, P2, 'manager');
  await seedUser(S1U, S1, 'partner');
  await seedUser(LRN, S1, 'learner');
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

let course = '', quizLesson = '', textLesson = '';

test('authoring: managers build a course; members cannot; drafts stay hidden below', async () => {
  assert.equal((await call(S1U, 'POST', '/v1/courses', { title: 'Nope' })).status, 403);
  const c = await call(P1U, 'POST', '/v1/courses', { title: 'Auto insurance basics', description: 'Start here' });
  assert.equal(c.status, 201);
  course = c.json.id;
  assert.equal((await call(P1U, 'PATCH', `/v1/courses/${course}`, { status: 'published' })).status, 422); // no lessons yet
  textLesson = (await call(P1U, 'POST', `/v1/courses/${course}/lessons`, { title: 'What is auto insurance?', type: 'richtext', text: 'Coverage explained.' })).json.id;
  assert.equal((await call(P1U, 'POST', `/v1/courses/${course}/lessons`, { title: 'Bad link', type: 'link', url: 'http://x.test' })).status, 422);
  quizLesson = (await call(P1U, 'POST', `/v1/courses/${course}/lessons`, { title: 'Check yourself', type: 'quiz', passMark: 60 })).json.id;
  const q = await call(P1U, 'PUT', `/v1/lessons/${quizLesson}/quiz`, { questions: [
    { prompt: 'Is liability mandatory?', type: 'true_false', options: ['True', 'False'], correct: [0] },
    { prompt: 'Pick all coverages', type: 'multi', options: ['Collision', 'Comprehensive', 'Pizza'], correct: [0, 1], points: 2 },
  ] });
  assert.equal(q.status, 204);
  assert.equal((await call(S1U, 'PUT', `/v1/lessons/${quizLesson}/quiz`, { questions: [] })).status, 400);
  // drafts are invisible beneath the owner and to siblings
  assert.equal((await call(S1U, 'GET', '/v1/courses')).json.courses.length, 0);
  assert.equal((await call(P2U, 'GET', '/v1/courses')).json.courses.length, 0);
  assert.equal((await call(P1U, 'PATCH', `/v1/courses/${course}`, { status: 'published' })).status, 204);
  assert.equal((await call(S1U, 'GET', '/v1/courses')).json.courses.length, 1); // published and shared down
  assert.equal((await call(P2U, 'GET', '/v1/courses')).json.courses.length, 0); // siblings still see nothing
});

test('learning: every partner is a learner, answer keys stay on the server, passing a quiz completes the course and issues a certificate', async () => {
  const lesson = await call(LRN, 'GET', `/v1/lessons/${quizLesson}`);
  assert.equal(lesson.status, 200);
  assert.equal(lesson.json.quiz.questions.length, 2);
  assert.equal(lesson.json.quiz.questions[0].correct, undefined);
  assert.equal((await call(P1U, 'GET', `/v1/lessons/${quizLesson}`)).json.quiz.questions[0].correct[0], '0');
  assert.equal((await call(LRN, 'POST', `/v1/lessons/${quizLesson}/complete`)).status, 422); // quizzes cannot be skipped
  const [q1, q2] = lesson.json.quiz.questions.map((x: any) => x.id);
  const bad = await call(LRN, 'POST', `/v1/lessons/${quizLesson}/quiz/attempt`, { answers: { [q1]: ['1'], [q2]: ['2'] } });
  assert.equal(bad.json.passed, false);
  assert.equal(bad.json.scorePct, 0);
  assert.equal((await call(LRN, 'POST', `/v1/lessons/${textLesson}/complete`)).json.completed, false); // quiz still outstanding
  const good = await call(LRN, 'POST', `/v1/lessons/${quizLesson}/quiz/attempt`, { answers: { [q1]: ['0'], [q2]: ['1', '0'] } });
  assert.equal(good.json.passed, true);
  assert.equal(good.json.scorePct, 100);
  assert.equal(good.json.completed, true);
  const mine = (await call(LRN, 'GET', '/v1/my/learning')).json.enrollments;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'completed');
  assert.ok(mine[0].certificateCode);
  const detail = (await call(LRN, 'GET', `/v1/courses/${course}`)).json;
  assert.equal(detail.lessons.every((l: any) => l.done), true);
  assert.equal(detail.canEdit, false);
});

test('assigning and watching: due dates reach everyone beneath, progress is visible upward only', async () => {
  const a = await call(P1U, 'POST', `/v1/courses/${course}/assignments`, { nodeId: P1, dueAt: '2027-01-31T00:00:00Z' });
  assert.equal(a.status, 201);
  assert.ok(a.json.enrolled >= 1);
  assert.equal((await call(P1U, 'POST', `/v1/courses/${course}/assignments`, { nodeId: P2 })).status, 403); // not beneath P1
  assert.equal((await call(S1U, 'POST', `/v1/courses/${course}/assignments`, { nodeId: S1 })).status, 403);
  const mine = (await call(S1U, 'GET', '/v1/my/learning')).json.enrollments;
  assert.equal(mine.length, 1);
  assert.ok(mine[0].dueAt);
  const prog = (await call(P1U, 'GET', `/v1/courses/${course}/progress`)).json.learners;
  assert.ok(prog.every((l: any) => "bestScore" in l && typeof l.attempts === "number"), "report fields present");
  assert.ok(prog.some((p: any) => p.email === LRN && p.status === 'completed'));
  assert.ok(prog.some((p: any) => p.email === S1U && p.status === 'assigned'));
  assert.equal((await call(S1U, 'GET', `/v1/courses/${course}/progress`)).status, 403);
  assert.equal((await call(P2U, 'GET', `/v1/courses/${course}/progress`)).status, 404);
});

test('roles: enrolling adds Learner, keeps Partner and the CRM; Learner is never an invite choice', async () => {
  const me = (await call(S1U, 'GET', '/v1/me')).json;
  const roles = me.roles.map((r: { role: string }) => r.role).sort();
  assert.deepEqual(roles, ['learner', 'partner'], 'assigned and enrolled: both roles');
  const nav = (await call(S1U, 'GET', '/v1/nav')).json;
  assert.ok(nav.items.some((i: { id: string }) => i.id === 'pipelines'), 'CRM access is unchanged');
  const inv = await call(ADMIN, 'POST', '/v1/invitations', { email: 'x.learner@lms.test', nodeId: P1, role: 'learner' });
  assert.equal(inv.status, 422, 'learner cannot be invited directly');
  const def = await call(ADMIN, 'POST', '/v1/invitations', { email: 'x.default@lms.test', nodeId: P1 });
  assert.equal(def.status, 201);
  const list = (await call(ADMIN, 'GET', '/v1/invitations')).json;
  assert.equal((list.invitations ?? list).find((i: { email: string }) => i.email === 'x.default@lms.test').role, 'partner', 'an invite defaults to Partner');
});

test('quiz attempts are limited when the course says so', async () => {
  const c2 = (await call(P1U, 'POST', '/v1/courses', { title: 'Limited' })).json.id;
  const l = (await call(P1U, 'POST', `/v1/courses/${c2}/lessons`, { title: 'One shot', type: 'quiz', maxAttempts: 1 })).json.id;
  await call(P1U, 'PUT', `/v1/lessons/${l}/quiz`, { questions: [{ prompt: 'Yes?', type: 'true_false', options: ['Yes', 'No'], correct: [0] }] });
  await call(P1U, 'PATCH', `/v1/courses/${c2}`, { status: 'published' });
  const qid = (await call(S1U, 'GET', `/v1/lessons/${l}`)).json.quiz.questions[0].id;
  assert.equal((await call(S1U, 'POST', `/v1/lessons/${l}/quiz/attempt`, { answers: { [qid]: ['1'] } })).status, 200);
  assert.equal((await call(S1U, 'POST', `/v1/lessons/${l}/quiz/attempt`, { answers: { [qid]: ['0'] } })).status, 403);
});

test('Quebec-facing courses need a French version before publishing', async () => {
  const c = (await call(P1U, 'POST', '/v1/courses', { title: 'Cours QC', quebecFacing: true })).json.id;
  const l = (await call(P1U, 'POST', `/v1/courses/${c}/lessons`, { title: 'Intro', type: 'richtext', text: 'Hello' })).json.id;
  const blocked = await call(P1U, 'PATCH', `/v1/courses/${c}`, { status: 'published' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /fr-CA/);
  await call(P1U, 'PATCH', `/v1/courses/${c}`, { locale: 'fr-CA', title: 'Cours du Québec' });
  assert.equal((await call(P1U, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 422); // lesson still lacks French
  await call(P1U, 'PATCH', `/v1/lessons/${l}`, { locale: 'fr-CA', title: 'Introduction', text: 'Bonjour' });
  assert.equal((await call(P1U, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  assert.equal((await call(S1U, 'GET', '/v1/courses?locale=fr-CA')).json.courses.find((x: any) => x.id === c).title, 'Cours du Québec');
});
