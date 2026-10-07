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

test('certificate: shows the course version, takes CE hours from that version, and downloads as a PDF', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Ethics (CE)', ownerNodeId: co.rootNodeId })).json.id;
  const l = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Read', type: 'richtext', text: 'x' })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { ce: { pack: 'ribo', hours: 1, category: 'ethics' } })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  assert.equal((await call(B, 'POST', `/v1/lessons/${l}/complete`)).json.completed, true);
  const code = (await call(B, 'GET', '/v1/my/learning')).json.enrollments.find((e: any) => e.courseId === c).certificateCode;
  await owner((o) => o.query(`UPDATE courses SET ce_hours = 9 WHERE id = $1`, [c]));            // a later change must not rewrite the certificate
  const page = await app.inject({ method: 'GET', url: `/c/${code}` });
  assert.equal(page.statusCode, 200); assert.ok(page.body.includes('v1')); assert.ok(page.body.includes('hours: 1 ') || page.body.includes('hours: 1<') || /hours: 1\b/.test(page.body), page.body.slice(page.body.indexOf('ce')));
  assert.ok(!/hours: 9/.test(page.body));
  const pdf = await app.inject({ method: 'GET', url: `/c/${code}/pdf` });
  assert.equal(pdf.statusCode, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await app.inject({ method: 'GET', url: '/c/000000000000000000/pdf' })).statusCode, 404);
  // a name the standard fonts cannot draw still gets a PDF, in Noto fonts
  await owner((o) => o.query(`UPDATE app_users SET display_name = 'ਗੁਰਪ੍ਰੀਤ Sañjeev नमस्ते' WHERE email = $1`, [B]));
  const uni = await app.inject({ method: 'GET', url: `/c/${code}/pdf` });
  assert.equal(uni.statusCode, 200, 'Unicode names are drawn, not redirected'); assert.equal(uni.headers['content-type'], 'application/pdf');
  if (process.env.CERT_OUT) (await import('node:fs')).writeFileSync(process.env.CERT_OUT, uni.rawPayload);
});

test('courses that need approval: ask, get told, approve or decline', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'By request', ownerNodeId: co.rootNodeId })).json.id;
  const l = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Intro', type: 'richtext', text: 'x' })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { enrollmentMode: 'approval' })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  assert.equal((await call(A, 'POST', `/v1/courses/${c}/enroll`)).status, 403);
  assert.equal((await call(A, 'GET', `/v1/lessons/${l}`)).status, 403);
  assert.equal((await call(A, 'POST', `/v1/lessons/${l}/complete`)).status, 403);
  { const r = await call(A, 'POST', `/v1/courses/${c}/request`, { note: 'For my licence' }); assert.equal(r.status, 201, JSON.stringify(r.json)); }
  assert.equal((await call(A, 'POST', `/v1/courses/${c}/request`, {})).status, 409, 'one pending request at a time');
  assert.equal((await call(A, 'GET', `/v1/courses/${c}`)).json.myRequest.status, 'pending');
  assert.equal((await call(B, 'GET', '/v1/course-requests')).json.requests.length, 0, 'a learner cannot see or answer requests');
  const list = (await call(ADMIN, 'GET', `/v1/course-requests?courseId=${c}`)).json.requests;
  assert.equal(list.length, 1); assert.equal(list[0].note, 'For my licence');
  assert.equal((await call(ADMIN, 'GET', '/v1/notifications')).json.notifications.some((n: any) => n.kind === 'course_request'), true);
  assert.equal((await call(B, 'POST', `/v1/course-requests/${list[0].id}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await call(ADMIN, 'POST', `/v1/course-requests/${list[0].id}/decision`, { decision: 'approve', note: 'Welcome' })).status, 200);
  assert.equal((await call(ADMIN, 'POST', `/v1/course-requests/${list[0].id}/decision`, { decision: 'decline' })).status, 409, 'already answered');
  assert.equal((await call(A, 'GET', `/v1/lessons/${l}`)).status, 200);
  assert.equal((await call(A, 'POST', `/v1/lessons/${l}/complete`)).json.completed, true);
  const told = (await call(A, 'GET', '/v1/notifications')).json.notifications.find((n: any) => n.kind === 'course_decision');
  assert.equal(told.data.decision, 'approved');
  // a declined request can be asked again
  assert.equal((await call(B, 'POST', `/v1/courses/${c}/request`, {})).status, 201);
  const bid = (await call(ADMIN, 'GET', `/v1/course-requests?courseId=${c}`)).json.requests[0].id;
  assert.equal((await call(ADMIN, 'POST', `/v1/course-requests/${bid}/decision`, { decision: 'decline', note: 'Not yet' })).status, 200);
  assert.equal((await call(B, 'GET', `/v1/courses/${c}`)).json.myRequest.status, 'declined');
  assert.equal((await call(B, 'POST', `/v1/courses/${c}/request`, {})).status, 201);
});

test('starter courses: listed, copied as drafts in both languages, authors only, quiz works', async () => {
  const list = (await call(A, 'GET', '/v1/courses/starter')).json.courses;
  assert.equal(list.length, 14); assert.ok(list.every((c: any) => c.lessons >= 3 && c.questions >= 5));
  assert.equal((await call(A, 'POST', '/v1/courses/starter', { key: 'eo-basics' })).status, 403, 'learners cannot add courses');
  assert.equal((await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'nope' })).status, 404);
  const made = await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'privacy-basics' });
  assert.equal(made.status, 201);
  const id = made.json.id;
  const en = (await call(ADMIN, 'GET', `/v1/courses/${id}?locale=en`)).json;
  const fr = (await call(ADMIN, 'GET', `/v1/courses/${id}?locale=fr-CA`)).json;
  assert.equal(en.status, 'draft'); assert.equal(en.lessons.length, 4);
  assert.notEqual(en.title, fr.title);
  assert.notEqual((await call(A, 'POST', `/v1/courses/${id}/enroll`)).status, 201, 'learners cannot start a draft');
  assert.equal((await call(A, 'GET', `/v1/courses/${id}`)).status, 404, 'a draft is hidden from learners');
  assert.ok(!(await call(A, 'GET', '/v1/courses')).json.courses.some((x: any) => x.id === id), 'and missing from their list');
  assert.ok((await call(ADMIN, 'GET', '/v1/courses')).json.courses.some((x: any) => x.id === id));
  const quiz = en.lessons.find((l: any) => l.type === 'quiz');
  const q = (await call(ADMIN, 'GET', `/v1/lessons/${quiz.id}`)).json.quiz.questions;
  assert.equal(q.length, 5);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${id}`, { status: 'published' })).status, 204, 'a reviewer can publish it');
});

test('a manager can give a learner extra tries at a quiz', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'One try', ownerNodeId: co.rootNodeId })).json.id;
  const ql = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Check', type: 'quiz', passMark: 100, maxAttempts: 1 })).json.id;
  assert.equal((await call(ADMIN, 'PUT', `/v1/lessons/${ql}/quiz`, { questions: [{ prompt: 'Pick A', options: ['A', 'B'], correct: [0] }] })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  const qid = (await call(ADMIN, 'GET', `/v1/lessons/${ql}`)).json.quiz.questions[0].id;
  assert.equal((await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['1'] } })).json.attemptsLeft, 0);
  assert.equal((await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['0'] } })).status, 403, 'out of tries');
  const aId = (await owner((o) => o.query(`SELECT id FROM app_users WHERE email = $1`, [A]))).rows[0].id;
  assert.equal((await call(B, 'POST', `/v1/lessons/${ql}/quiz/extra-attempts`, { userId: aId, extra: 1 })).status, 403, 'a learner cannot grant tries');
  assert.equal((await call(ADMIN, 'POST', `/v1/lessons/${ql}/quiz/extra-attempts`, { userId: aId, extra: 1 })).status, 204);
  const told = (await call(A, 'GET', '/v1/notifications')).json.notifications.find((n: any) => n.kind === 'quiz_attempts');
  assert.ok(told && told.data.extra === 1, 'the learner is told');
  const view = (await call(A, 'GET', `/v1/lessons/${ql}`)).json.quiz;
  assert.equal(view.maxAttempts, 2); assert.equal(view.status.allowed, true);
  const ok = await call(A, 'POST', `/v1/lessons/${ql}/quiz/attempt`, { answers: { [qid]: ['0'] } });
  assert.equal(ok.json.passed, true); assert.equal(ok.json.attemptNo, 2);
  assert.equal((await call(ADMIN, 'POST', `/v1/lessons/${ql}/quiz/extra-attempts`, { userId: '00000000-0000-4000-8000-000000000000', extra: 1 })).status, 404);
});

test('video starter course: five video lessons per language with a transcript, clips are served (with ranges)', async () => {
  const made = await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'using-pii-video' });
  assert.equal(made.status, 201);
  for (const loc of ['en', 'fr-CA']) {
    const c = (await call(ADMIN, 'GET', `/v1/courses/${made.json.id}?locale=${loc}`)).json;
    const vids = c.lessons.filter((l: any) => l.type === 'video');
    assert.equal(vids.length, 5);
    const l = (await call(ADMIN, 'GET', `/v1/lessons/${vids[0].id}?locale=${loc}`)).json;
    assert.match(l.body.url, loc === 'en' ? /^\/media\/pii-guide-1-en\.mp4$/ : /^\/media\/pii-guide-1-fr\.mp4$/);
    assert.ok(l.body.text.length > 40);
    const clip = await app.inject({ method: 'GET', url: l.body.url });
    assert.equal(clip.statusCode, 200); assert.equal(clip.headers['content-type'], 'video/mp4'); assert.ok(clip.rawPayload.length > 10_000);
    const part = await app.inject({ method: 'GET', url: l.body.url, headers: { range: 'bytes=0-99' } });
    assert.equal(part.statusCode, 206); assert.equal(part.rawPayload.length, 100);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/media/..%2Fpackage.json' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/media/nope.mp4' })).statusCode, 404);
});

test('a starter course can be added once per company; a published title cannot be published twice', async () => {
  const first = await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'aml-fraud' });
  assert.equal(first.status, 201);
  const again = await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'aml-fraud' });
  assert.equal(again.status, 200); assert.equal(again.json.id, first.json.id); assert.equal(again.json.existing, true);
  const list = (await call(ADMIN, 'GET', '/v1/courses/starter')).json.courses;
  assert.equal(list.find((c: any) => c.key === 'aml-fraud').courseId, first.json.id);
  assert.equal(list.find((c: any) => c.key === 'claims-handling').courseId, null);
  // archive the copy and the starter can be added again
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${first.json.id}`, { status: 'archived' })).status, 204);
  const third = await call(ADMIN, 'POST', '/v1/courses/starter', { key: 'aml-fraud' });
  assert.equal(third.status, 201); assert.notEqual(third.json.id, first.json.id);
  // two courses with the same title: the second cannot be published while the first is
  const mk = async () => (await call(ADMIN, 'POST', '/v1/courses', { title: 'Twin course' })).json.id;
  const a = await mk(), b = await mk();
  for (const id of [a, b]) assert.equal((await call(ADMIN, 'POST', `/v1/courses/${id}/lessons`, { title: 'L', type: 'richtext', text: 'x' })).status, 201);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${a}`, { status: 'published' })).status, 204);
  const blocked = await call(ADMIN, 'PATCH', `/v1/courses/${b}`, { status: 'published' });
  assert.equal(blocked.status, 409); assert.match(JSON.stringify(blocked.json), /already published/);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${b}`, { title: 'Twin course 2' })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${b}`, { status: 'published' })).status, 204);
});

test('learning paths: authors build them, learners start them, assigning enrols a branch in every published course', async () => {
  const c2 = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Path second', ownerNodeId: co.rootNodeId })).json.id;
  await call(ADMIN, 'POST', `/v1/courses/${c2}/lessons`, { title: 'Only', type: 'richtext', text: 'x' });
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c2}`, { status: 'published' })).status, 204);
  const mk = await call(ADMIN, 'POST', '/v1/paths', { name: 'New broker', courseIds: [course, c2] });
  assert.equal(mk.status, 201);
  const pid = mk.json.id;
  assert.equal((await call(A, 'POST', '/v1/paths', { name: 'No', courseIds: [course] })).status, 403, 'learners cannot create');
  assert.equal((await call(ADMIN, 'POST', '/v1/paths', { name: 'Bad', courseIds: ['00000000-0000-4000-8000-000000000000'] })).status, 422);
  const list = (await call(A, 'GET', '/v1/paths')).json.paths;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].courses.map((c: any) => c.id), [course, c2]);
  assert.equal(list[0].canEdit, false);
  const as = await call(ADMIN, 'POST', `/v1/paths/${pid}/assignments`, { nodeId: co.rootNodeId, dueInDays: 14 });
  assert.equal(as.status, 201);
  assert.equal(as.json.courses >= 1, true);
  assert.equal((await call(B, 'POST', `/v1/paths/${pid}/start`)).status, 200);
  assert.equal((await call(A, 'PATCH', `/v1/paths/${pid}`, { name: 'x' })).status, 403);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/paths/${pid}`, { courseIds: [c2] })).status, 204);
  assert.equal((await call(ADMIN, 'GET', '/v1/paths')).json.paths[0].courses.length, 1);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/paths/${pid}`)).status, 204);
  assert.equal((await call(ADMIN, 'GET', '/v1/paths')).json.paths.length, 0);
});
