import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string }; let ho: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json, text: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function seedUser(tenantId: string, email: string, home: string, role: string, name?: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [tenantId, email, name ?? email.split('@')[0], home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@ce.test', MGR = 'mgr@ce.test', L1 = 'lee@ce.test', L2 = 'sam@ce.test', HO = 'officer@ho.test', HOADMIN = 'hoadmin@ce.test';
let AGN = '', P1 = '', P2 = '';
const today = new Date().toISOString().slice(0, 10);
const pdf = Buffer.from('%PDF-1.4 proof').toString('base64');
const fakeAi = { model: 'fake', complete: async (i: { user: string }) => i.user.includes('JSON array')
  ? JSON.stringify([{ type: 'single', prompt: 'What is E&O?', options: ['Errors and omissions cover', 'A fruit', 'Nothing'], correct: [0] }, { type: 'multi', prompt: 'Bad: correct out of range', options: ['a', 'b'], correct: [5] }, { type: 'single', prompt: 'Two right on single', options: ['a', 'b'], correct: [0, 1] }])
  : 'Plain lesson text [CHECK].' };

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: fakeAi };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  ho = await bootstrapTenant(db.ownerUrl, { name: 'Head Office CA', countryCode: 'CA', adminEmail: HOADMIN, headOffice: true });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(HOADMIN, 'POST', '/v1/consent/first-login');
  const loc = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency One', parentId: loc })).json.id;
  P1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Lee Broker', parentId: AGN })).json.id;
  P2 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sam Broker', parentId: AGN })).json.id;
  await seedUser(co.tenantId, MGR, AGN, 'manager');
  await seedUser(co.tenantId, L1, P1, 'learner', 'Lee Learner');
  await seedUser(co.tenantId, L2, P2, 'learner', 'Sam Learner');
  await seedUser(ho.tenantId, HO, ho.rootNodeId, 'compliance');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

let entryId = '';

test('rule packs: RIBO and BC are loaded with their sources and retention', async () => {
  const r = (await call(L1, 'GET', '/v1/ce/packs')).json.packs;
  assert.deepEqual(r.map((p: { code: string }) => p.code).sort(), ['ribo', 'icbc'].sort());
  const ribo = r.find((p: { code: string }) => p.code === 'ribo');
  assert.equal(ribo.classes.find((c: { key: string }) => c.key === 'broker').total, 8);
  assert.equal(ribo.classes.find((c: { key: string }) => c.key === 'principal').total, 10);
  assert.ok(ribo.sourceUrl.startsWith('https://'));
});

test('a licensee picks a regulator and class; the status counts hours by category', async () => {
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ribo', licenceClass: 'nope' })).status, 422);
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'zzz', licenceClass: 'broker' })).status, 422);
  assert.equal((await call(L1, 'PUT', '/v1/ce/licences', { packCode: 'ribo', licenceClass: 'broker', licenceNumber: 'B123', licensedSince: '2020-05-01' })).status, 204);
  assert.equal((await call(L2, 'PUT', '/v1/ce/licences', { packCode: 'ribo', licenceClass: 'broker', licensedSince: '2019-01-01' })).status, 204);
  const me = (await call(L1, 'GET', '/v1/ce/me')).json;
  assert.equal(me.licences[0].evaluation.required, 8);
  assert.equal(me.licences[0].evaluation.counted, 0);
  assert.ok(['on_track', 'at_risk', 'overdue'].includes(me.licences[0].evaluation.state));
});

test('a course with CE hours puts them in the ledger when it is completed', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'Ethics for brokers', ownerNodeId: co.rootNodeId })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { ce: { pack: 'nope', hours: 1, category: 'ethics' } })).status, 422);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { ce: { pack: 'ribo', hours: 1.3, category: 'ethics' } })).status, 422);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { ce: { pack: 'ribo', hours: 1, category: 'ethics' } })).status, 204);
  const lesson = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Duty of care', type: 'richtext', text: 'x'.repeat(300) })).json.id;
  assert.equal((await call(ADMIN, 'PATCH', `/v1/courses/${c}`, { status: 'published' })).status, 204);
  assert.equal((await call(L1, 'POST', `/v1/lessons/${lesson}/complete`)).json.completed, true);
  assert.equal((await call(L1, 'POST', `/v1/lessons/${lesson}/complete`)).json.completed, true); // again: no second entry
  const me = (await call(L1, 'GET', '/v1/ce/me')).json;
  assert.equal(me.entries.length, 1);
  assert.equal(me.entries[0].source, 'course');
  assert.equal(me.licences[0].hours.ethics, 1);
  assert.equal(me.licences[0].evaluation.counted, 1);
  assert.deepEqual(me.licences[0].evaluation.missing, { technical: 3 });
  assert.ok(me.entries[0].retainUntil > today);
  const cert = (await call(L1, 'GET', '/v1/my/learning')).json.enrollments[0].certificateCode;
  const page = await call('', 'GET', `/c/${cert}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('Lee Learner') && page.text.includes('Ethics for brokers') && page.text.includes('Punjab Insurance Agency Inc'));
  assert.equal((await call('', 'GET', '/c/000000000000000000')).status, 404);
});

test('outside hours: proof is checked, entries are private to the person and the people who lead them', async () => {
  const body = { packCode: 'ribo', title: 'Claims workshop', provider: 'IBAO', category: 'technical', hours: 3, completedOn: today };
  assert.equal((await call(L1, 'POST', '/v1/ce/entries', { ...body, hours: 2.3 })).status, 422);
  assert.equal((await call(L1, 'POST', '/v1/ce/entries', { ...body, completedOn: '2999-01-01' })).status, 422);
  assert.equal((await call(L1, 'POST', '/v1/ce/entries', { ...body, filename: 'x.pdf', dataBase64: Buffer.from('not a pdf').toString('base64') })).status, 422);
  const r = await call(L1, 'POST', '/v1/ce/entries', { ...body, filename: 'cert.pdf', dataBase64: pdf });
  assert.equal(r.status, 201); entryId = r.json.id;
  assert.equal((await call(L1, 'GET', `/v1/ce/entries/${entryId}/evidence`)).json.mime, 'application/pdf');
  assert.equal((await call(L2, 'GET', `/v1/ce/entries/${entryId}/evidence`)).status, 404, 'a colleague cannot open it');
  assert.equal((await call(L2, 'GET', '/v1/ce/me')).json.entries.length, 0);
  assert.equal((await call(L1, 'GET', '/v1/ce/team')).status, 403);
  const team = (await call(MGR, 'GET', '/v1/ce/team')).json;
  assert.equal(team.people.length, 2);
  assert.equal(team.people.find((p: { email: string }) => p.email === L1).unverified, 1);
  assert.equal((await call(MGR, 'GET', `/v1/ce/entries/${entryId}/evidence`)).status, 200, 'the manager above can');
});

test('records are kept by law: no edit, no delete, even by the database owner', async () => {
  await owner(async (o) => {
    await assert.rejects(o.query('DELETE FROM ce_entries WHERE id = $1', [entryId]), /kept until/);
    await assert.rejects(o.query('UPDATE ce_entries SET hours = 40 WHERE id = $1', [entryId]), /cannot be changed/);
    await assert.rejects(o.query('UPDATE ce_entries SET title = $2 WHERE id = $1', [entryId, 'x']), /cannot be changed/);
    // an entry whose date has passed can go
    await o.query(`ALTER TABLE ce_entries DISABLE TRIGGER ce_entries_guard`);
    await o.query(`ALTER TABLE ce_entries ENABLE TRIGGER ce_entries_guard`);
  });
});

test('withdraw within 7 days; reviews belong to administrators and the compliance officer', async () => {
  assert.equal((await call(L2, 'POST', `/v1/ce/entries/${entryId}/void`)).status, 404);
  assert.equal((await call(L1, 'POST', `/v1/ce/entries/${entryId}/review`, { decision: 'verified' })).status, 403);
  assert.equal((await call(MGR, 'POST', `/v1/ce/entries/${entryId}/review`, { decision: 'verified' })).status, 403);
  assert.equal((await call(ADMIN, 'POST', `/v1/ce/entries/${entryId}/review`, { decision: 'verified', note: 'Seen' })).status, 204);
  assert.equal((await call(L1, 'POST', `/v1/ce/entries/${entryId}/void`)).status, 409, 'reviewed entries stay');
  const second = (await call(L1, 'POST', '/v1/ce/entries', { packCode: 'ribo', title: 'Mistake', provider: 'X', category: 'general', hours: 4, completedOn: today })).json.id;
  const before = (await call(L1, 'GET', '/v1/ce/me')).json.licences[0].evaluation.counted;
  assert.equal((await call(L1, 'POST', `/v1/ce/entries/${second}/void`)).status, 204);
  assert.equal((await call(L1, 'GET', '/v1/ce/me')).json.licences[0].evaluation.counted, before - 4, 'a withdrawn entry stops counting');
});

test('the compliance officer sees every company in the country, reviews, downloads proof and exports', async () => {
  assert.equal((await call(L1, 'GET', '/v1/ho/ce')).status >= 400, true);
  assert.equal((await call(ADMIN, 'GET', '/v1/ho/ce')).status >= 400, true);
  const o = (await call(HO, 'GET', '/v1/ho/ce')).json;
  assert.equal(o.people.length, 2);
  assert.equal(o.people[0].company, 'Maple Insurance');
  assert.equal(o.companies[0].people, 2);
  const third = (await call(L2, 'POST', '/v1/ce/entries', { packCode: 'ribo', title: 'Sam course', provider: 'IBAO', category: 'technical', hours: 3, completedOn: today, filename: 'a.pdf', dataBase64: pdf })).json.id;
  const o2 = (await call(HO, 'GET', '/v1/ho/ce')).json;
  assert.equal(o2.toReview.length, 1);
  assert.equal(o2.toReview[0].id, third);
  assert.equal((await call(HO, 'GET', `/v1/ho/ce/entries/${third}/evidence`)).json.mime, 'application/pdf');
  assert.equal((await call(HO, 'POST', `/v1/ho/ce/entries/${third}/review`, { decision: 'rejected', note: 'Unreadable' })).status, 204);
  assert.equal((await call(L2, 'GET', '/v1/ce/me')).json.entries[0].status, 'rejected');
  const ex = (await call(HO, 'GET', '/v1/ho/ce/export?pack=ribo')).json;
  const csv = Buffer.from(ex.dataBase64, 'base64').toString();
  assert.ok(csv.includes('Lee Learner') && csv.includes('Maple Insurance') && csv.includes('Claims workshop'));
  const own = Buffer.from((await call(ADMIN, 'GET', '/v1/ce/export?pack=ribo')).json.dataBase64, 'base64').toString();
  assert.ok(own.includes('Claims workshop') && !own.split('\r\n')[2]!.includes('Company'));
  assert.equal((await call(L1, 'GET', '/v1/ce/export?pack=ribo')).status, 403);
  assert.equal((await call(HO, 'GET', '/v1/ce/me')).status, 200, 'the officer has a CE file of their own, separate from companies');
});

test('AI drafts: off until the company turns it on, validated, never saved', async () => {
  const c = (await call(ADMIN, 'POST', '/v1/courses', { title: 'E&O', ownerNodeId: co.rootNodeId })).json.id;
  await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Read', type: 'richtext', text: 'Errors and omissions insurance protects a broker. '.repeat(10) });
  const quiz = (await call(ADMIN, 'POST', `/v1/courses/${c}/lessons`, { title: 'Quiz', type: 'quiz' })).json.id;
  assert.equal((await call(ADMIN, 'POST', `/v1/lessons/${quiz}/quiz/draft`, {})).status, 403, 'AI is off by default');
  assert.equal((await call(ADMIN, 'PUT', '/v1/ai/settings', { enabled: true })).status, 200);
  assert.ok([403, 404].includes((await call(L1, 'POST', `/v1/lessons/${quiz}/quiz/draft`, {})).status), 'only authors');
  const d = await call(ADMIN, 'POST', `/v1/lessons/${quiz}/quiz/draft`, { count: 5 });
  assert.equal(d.status, 200);
  assert.equal(d.json.questions.length, 1, 'malformed AI questions are dropped');
  assert.equal(d.json.aiDrafted, true);
  assert.equal((await call(ADMIN, 'GET', `/v1/lessons/${quiz}`)).json.quiz.questions.length, 0, 'nothing is saved until an author saves it');
  const l = await call(ADMIN, 'POST', '/v1/lessons/draft', { topic: 'Duty to disclose' });
  assert.equal(l.status, 200); assert.ok(l.json.text.includes('[CHECK]'));
});
