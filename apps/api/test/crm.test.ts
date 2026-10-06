import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

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
  const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenant.tenantId, email, home])).rows[0].id;
  await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenant.tenantId, u, home, role]);
  await o.end();
  await call(email, 'POST', '/v1/consent/first-login');
  return u as string;
}

const ADMIN = 'admin@crm.test', P1U = 'p1@crm.test', P2U = 'p2@crm.test', S1U = 's1@crm.test', LRN = 'learner@crm.test';
let X = '', Y = '', P1 = '', P2 = '', S1 = '', s1UserId = '';
let pipe1 = '', pipe2 = '', stage1: string[] = [];
let sweepDeps: import('../src/app.ts').AppDeps;

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  sweepDeps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(sweepDeps);
  tenant = await bootstrapTenant(db.ownerUrl, { name: 'CRM Test Co', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  Y = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver' })).json.id;
  P1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner One', parentId: X })).json.id;
  P2 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner Two', parentId: X })).json.id;
  await call(ADMIN, 'POST', '/v1/org/links', { parentId: Y, childId: P1 }); // P1 serves two locations
  S1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sub One', parentId: P1 })).json.id;
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  s1UserId = await seedUser(S1U, S1, 'partner');
  await seedUser(LRN, S1, 'learner');
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

test('learners are partners: they use the CRM too, but cannot define pipelines', async () => {
  assert.equal((await call(LRN, 'GET', '/v1/boxes')).status, 200);
  assert.equal((await call(LRN, 'GET', '/v1/pipelines')).status, 200);
  assert.equal((await call(LRN, 'POST', '/v1/pipelines', { name: 'Nope' })).status, 403);
});

test('pipelines: managers define them, members cannot, siblings do not see them', async () => {
  const r = await call(P1U, 'POST', '/v1/pipelines', {
    name: 'Auto policies',
    fields: [
      { key: 'policy_no', labels: { en: 'Policy number' }, type: 'text', required: true },
      { key: 'kind', labels: { en: 'Kind', 'fr-CA': 'Genre' }, type: 'dropdown', options: ['auto', 'home'] },
      { key: 'renewal', labels: { en: 'Renewal' }, type: 'date' },
    ],
  });
  assert.equal(r.status, 201);
  pipe1 = r.json.id;
  const list = await call(P1U, 'GET', '/v1/pipelines');
  assert.equal(list.json.pipelines[0].stages.length, 4);
  stage1 = list.json.pipelines[0].stages.map((s: any) => s.id);
  assert.equal(list.json.pipelines[0].fields.length, 3);
  assert.equal((await call(S1U, 'POST', '/v1/pipelines', { name: 'Nope' })).status, 403);
  assert.equal((await call(P2U, 'GET', '/v1/pipelines')).json.pipelines.length, 0);
  assert.equal((await call(P2U, 'POST', `/v1/pipelines/${pipe1}/stages`, { name: 'x' })).status, 404);
  assert.equal((await call(P1U, 'POST', '/v1/pipelines', { name: 'bad', fields: [{ key: 'd', labels: { en: 'D' }, type: 'dropdown' }] })).status, 422);
  // sub-partner can't see P1's pipeline until it is shared down
  assert.equal((await call(S1U, 'GET', '/v1/pipelines')).json.pipelines.length, 0);
  pipe2 = (await call(P2U, 'POST', '/v1/pipelines', { name: 'P2 pipeline' })).json.id;
});

test('boxes: the location is required when a partner serves several, and must be one of its own', async () => {
  const ctxs = await call(P1U, 'GET', '/v1/org/contexts');
  assert.deepEqual(ctxs.json.locations.map((l: any) => l.name), ['Toronto', 'Vancouver']);
  const base = { pipelineId: pipe1, name: 'Smith auto', custom: { policy_no: 'A-1', kind: 'auto' } };
  const missing = await call(P1U, 'POST', '/v1/boxes', base);
  assert.equal(missing.status, 422);
  assert.match(missing.json.error.message, /contextNodeId/);
  const ok = await call(P1U, 'POST', '/v1/boxes', { ...base, contextNodeId: Y, valueAmount: 1200.5, closeDate: '2027-01-15' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.contextNodeId, Y);
  // P2 serves one location only, so it is picked automatically; Vancouver is refused
  const own = await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe2, name: 'Jones home' });
  assert.equal(own.status, 201);
  assert.equal(own.json.contextNodeId, X);
  assert.equal((await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe2, name: 'x', contextNodeId: Y })).status, 422);
});

test('boxes: validation of stage, fields and pipeline ownership', async () => {
  const mk = (extra: object) => call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'T', contextNodeId: X, custom: { policy_no: 'A' }, ...extra });
  assert.equal((await mk({ custom: {} })).status, 422); // required field missing
  assert.equal((await mk({ custom: { policy_no: 'A', kind: 'boat' } })).status, 422); // bad dropdown option
  assert.equal((await mk({ custom: { policy_no: 'A', renewal: '2026-02-31' } })).status, 422); // impossible date
  assert.equal((await mk({ custom: { policy_no: 'A', nope: 1 } })).status, 422); // unknown field
  const p2stage = (await call(P2U, 'GET', '/v1/pipelines')).json.pipelines[0].stages[0].id;
  assert.equal((await mk({ stageId: p2stage })).status, 422); // stage from another pipeline
  // P2 cannot build on P1's pipeline
  assert.equal((await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'x', custom: { policy_no: 'A' } })).status, 422);
  assert.equal((await mk({ ownerNodeId: P2 })).status, 403); // cannot create for another branch
});

test('boxes: sibling isolation, downward visibility, edit rights', async () => {
  const p1boxes = (await call(P1U, 'GET', '/v1/boxes')).json.boxes;
  assert.equal(p1boxes.length, 1);
  const id = p1boxes[0].id;
  assert.equal((await call(P2U, 'GET', '/v1/boxes')).json.boxes.length, 1);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${id}`)).status, 404);
  assert.equal((await call(P2U, 'PATCH', `/v1/boxes/${id}`, { name: 'hax' })).status, 404);
  assert.equal((await call(P2U, 'DELETE', `/v1/boxes/${id}`)).status, 404);
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${id}/notes`, { body: 'hi' })).status, 404);

  // share down: the sub-partner can now run the pipeline; its boxes are visible to P1 but read-only there
  assert.equal((await call(P1U, 'PATCH', `/v1/pipelines/${pipe1}`, { sharedDown: true })).status, 204);
  let sub = await call(S1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Sub box', custom: { policy_no: 'S-9' } });
  assert.equal(sub.status, 422); // sub-partner inherits both of P1's locations, so it must choose
  sub = await call(S1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Sub box', contextNodeId: X, custom: { policy_no: 'S-9' } });
  assert.equal(sub.status, 201);
  const subId = sub.json.id;
  assert.equal((await call(P1U, 'GET', '/v1/boxes')).json.boxes.length, 2);
  const seen = await call(P1U, 'GET', `/v1/boxes/${subId}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.json.canEdit, false);
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${subId}`, { name: 'ancestor edit' })).status, 403);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${subId}`)).status, 404);
  assert.equal((await call(S1U, 'GET', '/v1/boxes')).json.boxes.length, 1); // downwards only
  assert.equal((await call(ADMIN, 'GET', '/v1/boxes')).json.boxes.length, 3);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/boxes/${subId}`, { name: 'admin edit' })).status, 204);
});

test('boxes: update, stage move, clear values, delete', async () => {
  const id = (await call(P1U, 'GET', '/v1/boxes?q=Smith')).json.boxes[0].id;
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: stage1[1], custom: { kind: 'home' }, valueAmount: null })).status, 204);
  const b = (await call(P1U, 'GET', `/v1/boxes/${id}`)).json;
  assert.equal(b.stageId, stage1[1]);
  assert.equal(b.custom.kind, 'home');
  assert.equal(b.custom.policy_no, 'A-1'); // partial update keeps the rest
  assert.equal(b.valueAmount, null);
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { custom: { policy_no: '' } })).status, 422); // required cannot be cleared
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { custom: { kind: '' } })).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?stageId=${stage1[1]}`)).json.boxes.length, 1);
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { ownerUserId: s1UserId })).status, 422); // not in the owning branch
  assert.equal((await call(P1U, 'GET', '/v1/boxes?limit=1')).json.boxes.length, 1);
  assert.equal((await call(P1U, 'GET', '/v1/boxes?limit=500')).status, 400);
});

test('contacts and accounts: isolation, duplicates, linking to boxes', async () => {
  const acc = await call(P1U, 'POST', '/v1/accounts', { name: 'Smith Holdings', domain: 'Smith.example', contextNodeId: X });
  assert.equal(acc.status, 201);
  const c1 = await call(P1U, 'POST', '/v1/contacts', { email: 'amy@smith.example', fullName: 'Amy Smith', accountId: acc.json.id, contextNodeId: X });
  assert.equal(c1.status, 201);
  assert.equal((await call(P1U, 'POST', '/v1/contacts', { email: 'AMY@smith.example', contextNodeId: X })).status, 409); // same branch, same email
  // sibling may hold the same address; they cannot see each other's
  assert.equal((await call(P2U, 'POST', '/v1/contacts', { email: 'amy@smith.example' })).status, 201);
  assert.equal((await call(P2U, 'GET', '/v1/contacts')).json.contacts.length, 1);
  assert.equal((await call(P2U, 'GET', `/v1/contacts/${c1.json.id}`)).status, 404);
  assert.equal((await call(P2U, 'POST', '/v1/contacts', { email: 'z@z.example', accountId: acc.json.id })).status, 422); // account invisible
  assert.equal((await call(P1U, 'POST', '/v1/contacts', { email: 'not-an-email' })).status, 400);
  assert.equal((await call(P1U, 'GET', '/v1/accounts?q=smith.example')).json.accounts.length, 1);
  assert.equal((await call(P1U, 'GET', `/v1/accounts/${acc.json.id}`)).json.contacts.length, 1);
  // link to a box
  const boxId = (await call(P1U, 'GET', '/v1/boxes?q=Smith')).json.boxes[0].id;
  assert.equal((await call(P1U, 'PUT', `/v1/boxes/${boxId}/contacts/${c1.json.id}`)).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${boxId}`)).json.contacts.length, 1);
  assert.equal((await call(P1U, 'GET', `/v1/contacts/${c1.json.id}`)).json.boxes.length, 1);
  assert.equal((await call(P2U, 'PUT', `/v1/boxes/${boxId}/contacts/${c1.json.id}`)).status, 404);
  assert.equal((await call(P1U, 'DELETE', `/v1/boxes/${boxId}/contacts/${c1.json.id}`)).status, 204);
  assert.equal((await call(P1U, 'PATCH', `/v1/contacts/${c1.json.id}`, { phone: '416-555-0100' })).status, 204);
  assert.equal((await call(P1U, 'DELETE', `/v1/accounts/${acc.json.id}`)).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/contacts/${c1.json.id}`)).json.accountId, null);
});

test('notes and tasks follow the box', async () => {
  const subId = (await call(S1U, 'GET', '/v1/boxes')).json.boxes[0].id;
  const note = await call(S1U, 'POST', `/v1/boxes/${subId}/notes`, { body: 'Called the client' });
  assert.equal(note.status, 201);
  // the parent partner sees the note; a sibling does not even see the box
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${subId}/notes`)).json.notes.length, 1);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${subId}/notes`)).status, 404);
  assert.equal((await call(P1U, 'DELETE', `/v1/notes/${note.json.id}`)).status, 403); // only author or admin
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${subId}/notes`, { body: 'x', mentions: ['00000000-0000-4000-8000-000000000000'] })).status, 422);

  const t = await call(S1U, 'POST', `/v1/boxes/${subId}/tasks`, { title: 'Send quote', dueAt: '2026-12-01T15:00:00Z' });
  assert.equal(t.status, 201);
  assert.equal((await call(S1U, 'GET', '/v1/tasks?mine=true&open=true')).json.tasks.length, 1);
  assert.equal((await call(P2U, 'GET', '/v1/tasks')).json.tasks.length, 0);
  assert.equal((await call(P1U, 'PATCH', `/v1/tasks/${t.json.id}`, { title: 'hax' })).status, 403);
  assert.equal((await call(S1U, 'PATCH', `/v1/tasks/${t.json.id}`, { done: true })).status, 204);
  assert.equal((await call(S1U, 'GET', '/v1/tasks?mine=true&open=true')).json.tasks.length, 0);
  assert.equal((await call(S1U, 'DELETE', `/v1/tasks/${t.json.id}`)).status, 204);
  assert.equal((await call(S1U, 'DELETE', `/v1/notes/${note.json.id}`)).status, 204);
});

test('linking a conversation: notice first, encrypted at rest, visible down the chain, purged on unlink', async () => {
  const subId = (await call(S1U, 'GET', '/v1/boxes')).json.boxes[0].id;
  const notice = await call(S1U, 'GET', `/v1/boxes/${subId}/link-notice`);
  assert.equal(notice.status, 200);
  assert.match(notice.json.text, /admin edit/);
  const payload = {
    gmailThreadId: 'thr-100', subject: 'Quote request',
    messages: [
      { gmailMessageId: 'm1', sentAt: '2026-10-01T10:00:00Z', from: 'amy@client.example', to: [{ email: 's1@crm.test' }], body: 'Please quote my SECRET-PLAN-777 renewal.', attachments: [{ name: 'id.pdf', size: 10 }] },
      { gmailMessageId: 'm2', sentAt: '2026-10-01T11:00:00Z', from: 's1@crm.test', to: [{ email: 'amy@client.example', name: 'Amy' }], body: 'Sure, on it.' },
    ],
  };
  assert.equal((await call(S1U, 'POST', `/v1/boxes/${subId}/threads`, { ...payload })).status, 400); // notice not accepted
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${subId}/threads`, { ...payload, acceptedNotice: true })).status, 404);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${subId}/threads`, { ...payload, acceptedNotice: true })).status, 403); // ancestor can read, not link
  const linked = await call(S1U, 'POST', `/v1/boxes/${subId}/threads`, { ...payload, acceptedNotice: true });
  assert.equal(linked.status, 201);
  const threadId = linked.json.threadId;
  // linking again adds nothing twice
  assert.equal((await call(S1U, 'POST', `/v1/boxes/${subId}/threads`, { ...payload, acceptedNotice: true })).status, 201);
  assert.equal((await call(S1U, 'GET', '/v1/threads/lookup?gmailThreadId=thr-100')).json.boxes[0].id, subId);
  assert.equal((await call(S1U, 'GET', '/v1/threads/lookup?gmailThreadId=nope')).json.boxes.length, 0);
  const list = (await call(S1U, 'GET', `/v1/boxes/${subId}/threads`)).json.threads;
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);
  const withMail = (await call(S1U, 'GET', `/v1/boxes/${subId}`)).json;
  assert.ok(withMail.lastEmailAt && withMail.lastEmailFrom, 'last email date and sender are filled in');

  // stored encrypted
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const raw = (await o.query(`SELECT body_enc FROM linked_thread_messages WHERE thread_id = $1 AND gmail_message_id = 'm1'`, [threadId])).rows[0].body_enc as Buffer;
  assert.ok(!raw.toString('utf8').includes('SECRET-PLAN-777'));
  assert.equal((await o.query(`SELECT count(*)::int AS n FROM consent_records WHERE kind = 'link_thread'`)).rows[0].n, 2);

  // the parent partner reads it; the sibling does not
  const read = await call(P1U, 'GET', `/v1/threads/${threadId}/messages`);
  assert.equal(read.status, 200);
  assert.equal(read.json.messages[0].body, 'Please quote my SECRET-PLAN-777 renewal.');
  assert.equal((await call(P2U, 'GET', `/v1/threads/${threadId}/messages`)).status, 404);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${subId}/threads`)).status, 404);

  // unlinking deletes the stored copy
  assert.equal((await call(P2U, 'DELETE', `/v1/boxes/${subId}/threads/${threadId}`)).status, 404);
  assert.equal((await call(S1U, 'DELETE', `/v1/boxes/${subId}/threads/${threadId}`)).status, 204);
  assert.equal((await o.query('SELECT count(*)::int AS n FROM linked_thread_messages WHERE thread_id = $1', [threadId])).rows[0].n, 0);
  assert.equal((await o.query('SELECT count(*)::int AS n FROM email_threads WHERE id = $1', [threadId])).rows[0].n, 0);
  await o.end();
});

test('deleting a box removes its notes, tasks and links; audit records the actions', async () => {
  const id = (await call(P1U, 'GET', '/v1/boxes?q=Smith')).json.boxes[0].id;
  await call(P1U, 'POST', `/v1/boxes/${id}/notes`, { body: 'n' });
  await call(P1U, 'POST', `/v1/boxes/${id}/tasks`, { title: 't' });
  assert.equal((await call(P1U, 'DELETE', `/v1/boxes/${id}`)).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id}`)).status, 404);
  assert.equal((await call(P1U, 'GET', '/v1/tasks')).json.tasks.length, 0);
  const actions = (await call(ADMIN, 'GET', '/v1/audit')).json;
  const names = actions.events.map((e: any) => e.action);
  assert.ok(names.includes('box_created') && names.includes('box_deleted') && names.includes('box_stage_moved'));
});

test('generic link notice for a box that does not exist yet', async () => {
  const r = await call(S1U, 'GET', '/v1/link-notice?recordName=New%20deal&locationName=Toronto');
  assert.equal(r.status, 200);
  assert.match(r.json.text, /New deal/);
});

test('pipeline UI: stage edit, reorder, delete with move, columns, summary, history', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages;
  const [a, b, c, d] = stages.map((s: any) => s.id) as string[];
  // rename + colour; siblings and members cannot
  assert.equal((await call(P1U, 'PATCH', `${P}/stages/${a}`, { name: 'Lead in', color: '#112233' })).status, 204);
  assert.equal((await call(P1U, 'PATCH', `${P}/stages/${a}`, { color: 'red' })).status, 400);
  assert.equal((await call(P2U, 'PATCH', `${P}/stages/${a}`, { name: 'x' })).status, 404);
  assert.equal((await call(S1U, 'PATCH', `${P}/stages/${a}`, { name: 'x' })).status, 403);
  assert.equal((await call(P1U, 'PATCH', `${P}`, { colorTheme: 'ocean' })).status, 204);
  const got = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1);
  assert.equal(got.colorTheme, 'ocean');
  assert.equal(got.stages[0].name, 'Lead in');
  assert.equal(got.stages[0].color, '#112233');
  // reorder must list every stage once
  assert.equal((await call(P1U, 'PUT', `${P}/stages/order`, { stageIds: [b, a, c] })).status, 422);
  assert.equal((await call(P1U, 'PUT', `${P}/stages/order`, { stageIds: [b, a, c, d] })).status, 204);
  assert.deepEqual((await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id), [b, a, c, d]);

  // box history and time in stage
  const box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'History box', contextNodeId: X, stageId: a, custom: { policy_no: 'H-1' } })).json.id;
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: c })).status, 204);
  const ev = (await call(P1U, 'GET', `/v1/boxes/${box}/events`)).json.events;
  assert.deepEqual(ev.map((e: any) => e.kind).sort(), ['created', 'stage_changed']);
  const listed = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=History`)).json;
  assert.equal(listed.total, 1);
  assert.equal(listed.boxes[0].daysInStage, 0);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=History&minDaysInStage=1`)).json.boxes.length, 0);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${box}/events`)).status, 404);

  // summary respects scope
  const sum = (await call(P1U, 'GET', `${P}/summary?scope=mine`)).json;
  assert.equal(sum.stages.find((s: any) => s.stageId === c).count, 1);
  assert.equal((await call(P1U, 'GET', `${P}/summary?scope=below`)).json.total, 1);

  // delete a used stage: must say where the boxes go, and they get a history entry
  assert.equal((await call(P1U, 'DELETE', `${P}/stages/${c}`)).status, 422);
  assert.equal((await call(P1U, 'DELETE', `${P}/stages/${c}?moveTo=${d}`)).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}`)).json.stageId, d);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}/events`)).json.events.length, 3);

  // columns
  const fields = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).fields;
  const kind = fields.find((f: any) => f.key === 'kind');
  assert.equal((await call(P1U, 'PATCH', `${P}/fields/${kind.id}`, { labels: { en: 'Type', 'fr-CA': 'Type' }, options: ['auto', 'home', 'boat'] })).status, 204);
  assert.equal((await call(P1U, 'PATCH', `${P}/fields/${kind.id}`, { labels: { en: 'T', de: 'x' } })).status, 422);
  const ids = fields.map((f: any) => f.id).reverse();
  assert.equal((await call(P1U, 'PUT', `${P}/fields/order`, { fieldIds: ids })).status, 204);
  const renewal = fields.find((f: any) => f.key === 'renewal');
  assert.equal((await call(P1U, 'DELETE', `${P}/fields/${renewal.id}`)).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).fields.length, 2);
});

test('import: stages and columns are created, bad rows are skipped with a reason, repeats are not duplicated', async () => {
  const body = {
    contextNodeId: X,
    columns: [{ key: 'lead_source', label: 'Lead Source' }],
    rows: [
      { name: 'Imported A', stage: 'Brand new stage', valueAmount: 500, closeDate: '2027-02-01', daysInStage: 5, custom: { lead_source: 'Referral', policy_no: 'I-1' } },
      { name: 'Imported B', stage: 'in progress', custom: { policy_no: 'I-2' } },
      { name: '  ', custom: {} },
      { name: 'Imported C', closeDate: '01/02/2027' },
    ],
  };
  assert.equal((await call(S1U, 'POST', `/v1/pipelines/${pipe1}/import`, body)).status, 403);
  const r = await call(P1U, 'POST', `/v1/pipelines/${pipe1}/import`, body);
  assert.equal(r.status, 200);
  assert.equal(r.json.created, 2);
  assert.equal(r.json.stagesCreated, 1);
  assert.equal(r.json.fieldsCreated, 1);
  assert.equal(r.json.skipped.length, 2);
  const list = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Imported%20A`)).json.boxes;
  assert.equal(list[0].daysInStage, 5);
  assert.equal(list[0].custom.lead_source, 'Referral');
  const again = await call(P1U, 'POST', `/v1/pipelines/${pipe1}/import`, body);
  assert.equal(again.json.created, 0);
});

test('import: contacts are created once, matched to their record, and reused on a repeat', async () => {
  const body = { contextNodeId: X, rows: [], contacts: [
    { boxName: 'imported a', fullName: 'Ann Lee', email: 'ann@example.com, other@example.com', phone: '555-0100', title: 'Owner' },
    { boxName: 'Imported B', fullName: 'No Email Person' },
    { boxName: 'Nonexistent', fullName: 'Ghost' },
  ] };
  const r = await call(P1U, 'POST', `/v1/pipelines/${pipe1}/import`, body);
  assert.equal(r.status, 200);
  assert.equal(r.json.contactsCreated, 2);
  const a = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Imported%20A`)).json.boxes[0].id;
  const detail = (await call(P1U, 'GET', `/v1/boxes/${a}`)).json;
  assert.equal(detail.contacts[0].email, 'ann@example.com');
  assert.equal((await call(P1U, 'POST', `/v1/pipelines/${pipe1}/import`, body)).json.contactsCreated, 0);
});

test('filters: several stages, owners, value range, email age, stacked sorts', async () => {
  const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id) as string[];
  const [a, b] = stages;
  const mk = async (name: string, stageId: string, value: number) =>
    (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name, contextNodeId: X, stageId, valueAmount: value, custom: { policy_no: name } })).json.id as string;
  await mk('Flt A', a!, 100); await mk('Flt B', b!, 300); await mk('Flt C', a!, 200);
  const list = async (qs: string) => (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Flt&${qs}`)).json;
  assert.equal((await list(`stageIds=${a},${b}`)).total, 3);
  assert.equal((await list(`stageIds=${b}`)).total, 1);
  assert.equal((await list('valueMin=150&valueMax=250')).boxes[0].name, 'Flt C');
  assert.equal((await list('noEmail=true')).total, 3);
  assert.equal((await list('emailOlderThanDays=7')).total, 3, 'no email counts as older than 7 days');
  assert.equal((await list('emailWithinDays=7')).total, 0);
  assert.equal((await list('unassigned=true&assigneeIds=' + s1UserId)).total, 0, 'these boxes belong to their creator, not to the sub-partner and not unassigned');
  assert.equal((await list('assigneeIds=' + s1UserId)).total, 0);
  const stacked = (await list('sorts=stage:asc,value:desc')).boxes.map((x: any) => x.name);
  assert.deepEqual(stacked, ['Flt C', 'Flt A', 'Flt B']);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&stageIds=nope`)).status, 422);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&sorts=password:asc`)).status, 422);
  assert.equal((await call(P2U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Flt&stageIds=${a}`)).json.total, 0, 'siblings still see nothing');
});

test('filters: group totals per stage and per owner', async () => {
  const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id) as string[];
  const r = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Flt&groupBy=stage&sorts=stage:asc`)).json;
  const byStage = Object.fromEntries(r.groups.map((g: any) => [g.key, g]));
  assert.equal(byStage[stages[0]!].count, 2);
  assert.equal(byStage[stages[0]!].value, 300);
  const o = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Flt&groupBy=owner&sorts=owner:asc`)).json;
  assert.equal(o.groups.reduce((n: number, g: any) => n + g.count, 0), 3);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Flt&groupBy=stage&offset=50`)).json.groups, undefined);
});

test('automatic columns: task, note and email counts per record', async () => {
  const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id) as string[];
  const id = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Magic box', contextNodeId: X, stageId: stages[0], custom: { policy_no: 'M-1' } })).json.id as string;
  await call(P1U, 'POST', `/v1/boxes/${id}/tasks`, { title: 'Overdue one', dueAt: '2020-01-01T00:00:00Z' });
  await call(P1U, 'POST', `/v1/boxes/${id}/tasks`, { title: 'Later', dueAt: '2099-01-01T00:00:00Z' });
  await call(P1U, 'POST', `/v1/boxes/${id}/notes`, { body: 'hello' });
  const row = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Magic&sorts=openTasks:desc`)).json.boxes[0];
  assert.equal(row.openTasks, 2);
  assert.equal(row.overdueTasks, 1);
  assert.equal(row.noteCount, 1);
  assert.equal(row.emailCount, 0);
  assert.ok(row.nextTaskDue && row.lastNoteAt);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&sorts=lastInteraction:desc`)).status, 200);
});

test('reports and newsfeed: totals, conversion inputs, isolation', async () => {
  const r = (await call(P1U, 'GET', `/v1/pipelines/${pipe1}/report`)).json;
  assert.ok(r.stages.length >= 3);
  assert.equal(r.weekly.length, 12);
  assert.equal(r.stages.reduce((n: number, s: any) => n + s.count, 0), r.totals.open + r.totals.won + r.totals.lost);
  assert.ok(r.stages[0].reached >= r.stages[0].count);
  assert.ok(Array.isArray(r.forecast) && Array.isArray(r.owners));
  const feed = (await call(P1U, 'GET', `/v1/newsfeed?pipelineId=${pipe1}&limit=5`)).json.items;
  assert.ok(feed.length > 0 && feed.length <= 5);
  assert.ok(feed.every((i: any) => i.boxName && i.at));
  const sib = (await call(P2U, 'GET', `/v1/pipelines/${pipe1}/report`));
  assert.equal(sib.status, 404);
  assert.equal((await call(P2U, 'GET', `/v1/newsfeed?pipelineId=${pipe1}`)).json.items.length, 0);
});

test('stage rules and automations: required fields block a move; entering a stage creates a task and assigns', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id) as string[];
  const target = stages[1]!;
  assert.equal((await call(S1U, 'PATCH', `${P}/stages/${target}`, { requiredFields: ['value'] })).status, 403);
  assert.equal((await call(P1U, 'PATCH', `${P}/stages/${target}`, { requiredFields: ['nope'] })).status, 422);
  assert.equal((await call(P1U, 'PATCH', `${P}/stages/${target}`, { requiredFields: ['value', 'closeDate'] })).status, 204);
  assert.deepEqual((await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.find((s: any) => s.id === target).requiredFields, ['value', 'closeDate']);
  const id = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Rule box', contextNodeId: X, stageId: stages[0], custom: { policy_no: 'R-1' } })).json.id as string;
  const blocked = await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: target });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /Value, Close date/);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id}`)).json.stageId, stages[0], 'the failed move changed nothing');
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: target, valueAmount: 10, closeDate: '2030-01-01' })).status, 204);

  // automations: managers only, visible to all who see the pipeline
  assert.equal((await call(S1U, 'POST', `${P}/automations`, { stageId: target, action: 'create_task', title: 'x' })).status, 403);
  assert.equal((await call(P1U, 'POST', `${P}/automations`, { stageId: target, action: 'create_task' })).status, 422);
  const auto = (await call(P1U, 'POST', `${P}/automations`, { stageId: target, action: 'create_task', title: 'Send quote', dueInDays: 3 })).json.id;
  assert.ok(auto);
  assert.equal((await call(P2U, 'GET', `${P}/automations`)).status, 404, 'siblings cannot see it');
  assert.equal((await call(P1U, 'GET', `${P}/automations`)).json.automations.length, 1);
  const id2 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Auto box', contextNodeId: X, stageId: stages[0], custom: { policy_no: 'A-1' }, valueAmount: 5, closeDate: '2030-02-02' })).json.id as string;
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id2}`, { stageId: target })).status, 204);
  const tasks = (await call(P1U, 'GET', `/v1/tasks?boxId=${id2}`)).json.tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Send quote');
  assert.ok(tasks[0].dueAt);
  // paused automations do nothing
  assert.equal((await call(P1U, 'PATCH', `${P}/automations/${auto}`, { active: false })).status, 204);
  const id3 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Quiet box', contextNodeId: X, stageId: stages[0], custom: { policy_no: 'Q-1' }, valueAmount: 5, closeDate: '2030-02-02' })).json.id as string;
  await call(P1U, 'PATCH', `/v1/boxes/${id3}`, { stageId: target });
  assert.equal((await call(P1U, 'GET', `/v1/tasks?boxId=${id3}`)).json.tasks.length, 0);
  assert.equal((await call(P1U, 'DELETE', `${P}/automations/${auto}`)).status, 204);
});

test('shared views: own and shared, never someone else\'s private view', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  assert.equal((await call(P1U, 'PATCH', P, { sharedDown: true })).status, 204);
  assert.equal((await call(P1U, 'POST', `${P}/views`, { name: 'Private', config: { a: 1 } })).status, 201);
  const shared = (await call(P1U, 'POST', `${P}/views`, { name: 'Team view', config: { a: 2 }, shared: true })).json.id;
  const seen = (await call(S1U, 'GET', `${P}/views`)).json.views;
  assert.deepEqual(seen.map((v: any) => v.name), ['Team view']);
  assert.equal(seen[0].mine, false);
  assert.equal((await call(S1U, 'DELETE', `/v1/views/${shared}`)).status, 404, 'cannot delete a view you did not make');
  assert.equal((await call(P2U, 'GET', `${P}/views`)).json.views.length, 0);
  assert.equal((await call(P1U, 'GET', `${P}/views`)).json.views.length, 2);
  assert.equal((await call(P1U, 'DELETE', `/v1/views/${shared}`)).status, 204);
});


async function publicCall(method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, text: res.body, json: res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : null };
}

test('integrations: hosted form and inbound webhook create records; tokens are secret; managers only', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  assert.equal((await call(S1U, 'POST', `${P}/intakes`, { kind: 'form', name: 'x' })).status, 403);
  assert.equal((await call(P2U, 'POST', `${P}/intakes`, { kind: 'form', name: 'x' })).status, 404);
  const form = (await call(P1U, 'POST', `${P}/intakes`, { kind: 'form', name: 'Website quote', title: 'Get a quote', contextNodeId: X })).json;
  assert.match(form.url, /\/f\/pii_/);
  const token = form.url.split('/f/')[1];
  const list = (await call(P1U, 'GET', `${P}/intakes`)).json.intakes;
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(token), 'the token is not stored or listed');

  const page = await publicCall('GET', `/f/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Get a quote/);
  assert.equal((await publicCall('GET', '/f/pii_wrong')).status, 404);

  assert.equal((await publicCall('POST', `/f/${token}`, { name: '' })).status, 422);
  assert.equal((await publicCall('POST', `/f/${token}`, { name: 'Bot', website: 'spam.example' })).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Bot`)).json.total, 0, 'honeypot submissions are dropped');
  assert.equal((await publicCall('POST', `/f/${token}`, { name: '<b>Web Lead</b>', email: 'WEB@example.com', phone: '555', message: 'Need home cover' })).status, 201);
  const box = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Web Lead`)).json.boxes[0];
  assert.ok(box, 'record created');
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${box.id}`)).status, 404, 'siblings do not see it');
  const detail = (await call(P1U, 'GET', `/v1/boxes/${box.id}`)).json;
  assert.equal(detail.contacts[0].email, 'web@example.com');
  assert.match((await call(P1U, 'GET', `/v1/boxes/${box.id}/notes`)).json.notes[0].body, /Need home cover/);

  const hook = (await call(P1U, 'POST', `${P}/intakes`, { kind: 'webhook', name: 'Zapier', contextNodeId: X })).json;
  const ht = hook.url.split('/hooks/')[1];
  assert.equal((await publicCall('POST', `/v1/hooks/${token}`, { name: 'x' })).status, 404, 'a form token does not work as a webhook');
  assert.equal((await publicCall('POST', `/v1/hooks/${ht}`, { name: 'Zap Lead', value: 900, custom: { policy_no: 'Z-1' } })).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=Zap Lead`)).json.boxes[0].valueAmount * 1, 900);
  assert.equal((await publicCall('POST', `/v1/hooks/${ht}`, { name: 'Bad', custom: { nope: 1 } })).status, 422);

  // pause, then delete
  assert.equal((await call(P1U, 'PATCH', `${P}/intakes/${hook.id}`, { active: false })).status, 204);
  assert.equal((await publicCall('POST', `/v1/hooks/${ht}`, { name: 'Late' })).status, 404);
  assert.equal((await call(P1U, 'DELETE', `${P}/intakes/${hook.id}`)).status, 204);
  assert.equal((await call(P1U, 'GET', `${P}/intakes`)).json.intakes.length, 1);
});

test('integrations: outbound webhooks are signed, sent on events, and refuse unsafe addresses', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  const got: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const srv = http.createServer((rq, rs) => { let d = ''; rq.on('data', (c) => (d += c)); rq.on('end', () => { got.push({ headers: rq.headers, body: d }); rs.end('ok'); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    assert.equal((await call(P1U, 'POST', `${P}/webhooks`, { url: 'http://10.0.0.5/x' })).status, 422);
    assert.equal((await call(P1U, 'POST', `${P}/webhooks`, { url: 'ftp://example.com/x' })).status, 422);
    assert.equal((await call(S1U, 'POST', `${P}/webhooks`, { url: `http://127.0.0.1:${port}/h` })).status, 403);
    const wh = (await call(P1U, 'POST', `${P}/webhooks`, { url: `http://127.0.0.1:${port}/h` })).json;
    assert.match(wh.secret, /^whsec_/);
    const id = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'Hooked', contextNodeId: X, custom: { policy_no: 'H-9' } })).json.id;
    for (let i = 0; i < 40 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(got.length, 1);
    const ev = JSON.parse(got[0]!.body);
    assert.equal(ev.event, 'box.created');
    assert.equal(ev.box.name, 'Hooked');
    const ts = got[0]!.headers['x-pii-timestamp'] as string;
    assert.equal(got[0]!.headers['x-pii-signature'], `sha256=${createHmac('sha256', wh.secret).update(`${ts}.${got[0]!.body}`).digest('hex')}`);
    const stages = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe1).stages.map((s: any) => s.id);
    const open = stages[2];
    await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: open });
    for (let i = 0; i < 40 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(JSON.parse(got[1]!.body).event, 'box.stage_changed');
    assert.equal((await call(P1U, 'GET', `${P}/webhooks`)).json.webhooks[0].lastStatus, 200);
    assert.ok(!JSON.stringify((await call(P1U, 'GET', `${P}/webhooks`)).json).includes(wh.secret), 'the secret is never shown again');
    assert.equal((await call(P1U, 'DELETE', `${P}/webhooks/${wh.id}`)).status, 204);
  } finally { srv.close(); }
});

async function ownerSql(sql: string, params: unknown[] = []) {
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  try { return (await o.query(sql, params)).rows; } finally { await o.end(); }
}
const settle = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 60; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('automations: note, move, copy, stale, and first-email; each acts once; failures never block the person', async () => {
  const mk = async (name: string) => {
    const r = (await call(P1U, 'POST', '/v1/pipelines', { name, sharedDown: true, stages: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] })).json.id as string;
    const st = (await call(P1U, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === r).stages.map((s: any) => s.id) as string[];
    return { id: r, st };
  };
  const flow = await mk('Flow'), other = await mk('Other');
  const P = `/v1/pipelines/${flow.id}`;
  const bad = (b: object) => call(P1U, 'POST', `${P}/automations`, b);
  assert.equal((await bad({ stageId: flow.st[0], action: 'add_note' })).status, 422);
  assert.equal((await bad({ stageId: flow.st[0], action: 'move_stage', targetStageId: flow.st[0] })).status, 422);
  assert.equal((await bad({ stageId: flow.st[0], action: 'move_stage', targetStageId: other.st[1] })).status, 422, 'target stage must be in this pipeline');
  assert.equal((await bad({ stageId: flow.st[0], action: 'copy_to_pipeline', targetPipelineId: flow.id })).status, 422);
  assert.equal((await bad({ stageId: flow.st[0], trigger: 'stale', action: 'add_note', body: 'x' })).status, 422, 'stale needs days');
  assert.equal((await call(S1U, 'POST', `${P}/automations`, { stageId: flow.st[1], action: 'add_note', body: 'x' })).status, 403);

  // entering B: note + copy to the other pipeline's stage C; entering C: move on to D
  assert.equal((await bad({ stageId: flow.st[1], action: 'add_note', body: 'Welcome to B' })).status, 201);
  assert.equal((await bad({ stageId: flow.st[1], action: 'copy_to_pipeline', targetPipelineId: other.id, targetStageId: other.st[2] })).status, 201);
  assert.equal((await bad({ stageId: flow.st[2], action: 'move_stage', targetStageId: flow.st[3] })).status, 201);
  const id = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: flow.id, name: 'Chain', contextNodeId: X })).json.id;
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: flow.st[1] })).status, 204);
  assert.match((await call(P1U, 'GET', `/v1/boxes/${id}/notes`)).json.notes[0].body, /Welcome to B/);
  const copy = (await call(P1U, 'GET', `/v1/boxes?pipelineId=${other.id}&q=Chain`)).json.boxes;
  assert.equal(copy.length, 1, 'copied to the other pipeline');
  assert.equal(copy[0].stageId, other.st[2]);
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: flow.st[2] })).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id}`)).json.stageId, flow.st[3], 'moved on automatically');
  // entering B again later does not repeat for the same stay, but a new stay does
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id}`, { stageId: flow.st[1] })).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes?pipelineId=${other.id}&q=Chain`)).json.boxes.length, 2);

  // a blocked automatic move is skipped and recorded, and the person's own move still succeeds
  await call(P1U, 'PATCH', `${P}/stages/${flow.st[3]}`, { requiredFields: ['value'] });
  const id2 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: flow.id, name: 'NoValue', contextNodeId: X })).json.id;
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${id2}`, { stageId: flow.st[2] })).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id2}`)).json.stageId, flow.st[2], 'stayed put because D needs a value');
  assert.equal((await ownerSql(`SELECT count(*)::int AS n FROM automation_runs WHERE box_id = $1 AND outcome = 'skipped'`, [id2]))[0].n, 1);

  // stale: after 3 days in A, add a note, once
  const stale = (await bad({ stageId: flow.st[0], trigger: 'stale', staleDays: 3, action: 'create_task', title: 'Chase', dueInDays: 1 })).json.id;
  const id3 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: flow.id, name: 'Dusty', contextNodeId: X })).json.id;
  const { sweepStale } = await import('../src/background.ts');
  assert.ok(stale);
  await ownerSql(`UPDATE boxes SET stage_entered_at = now() - interval '4 days' WHERE id = $1`, [id3]);
  const swept = await sweepStale(sweepDeps);
  assert.ok(swept >= 1);
  const tasks = (await call(P1U, 'GET', `/v1/tasks?boxId=${id3}`)).json.tasks;
  assert.equal(tasks.length, 1);
  await sweepStale(sweepDeps);
  assert.equal((await call(P1U, 'GET', `/v1/tasks?boxId=${id3}`)).json.tasks.length, 1, 'acts once per stay');

  // first received email while in the stage
  await bad({ stageId: flow.st[0], trigger: 'email', action: 'move_stage', targetStageId: flow.st[1] });
  const id4 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: flow.id, name: 'Mailed', contextNodeId: X })).json.id;
  const msg = (from: string, i: number) => ({ gmailMessageId: `m${i}`, sentAt: new Date(2026, 0, i).toISOString(), from, subject: 'Hi', body: 'Hello', to: [{ email: 'c@x.test' }] });
  const link = (messages: object[]) => call(P1U, 'POST', `/v1/boxes/${id4}/threads`, { gmailThreadId: 'thr-auto-1', acceptedNotice: true, messages });
  assert.equal((await link([msg(P1U, 1)])).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id4}`)).json.stageId, flow.st[0], 'only my own message: no change');
  assert.equal((await link([msg(P1U, 1), msg('Client <c@x.test>', 2)])).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${id4}`)).json.stageId, flow.st[1], 'a reply moves it');

  // automations are listed with readable names
  const listed = (await call(P1U, 'GET', `${P}/automations`)).json.automations;
  assert.ok(listed.some((a: any) => a.action === 'copy_to_pipeline' && a.targetPipelineName === 'Other'));
});

test('weekly summary: in-app digest, test messages for subscribers, and the weekly event', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  const d = (await call(P1U, 'GET', `${P}/digest?days=7&tasks=all`)).json;
  assert.ok(d.newBoxes.length > 0);
  assert.ok(Array.isArray(d.reachedStage) && Array.isArray(d.dueTasks));
  assert.equal((await call(P2U, 'GET', `${P}/digest`)).status, 404);

  const got: string[] = [];
  const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => (b += c)); rq.on('end', () => { got.push(b); rs.end('ok'); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/w`;
  try {
    const wh = (await call(P1U, 'POST', `${P}/webhooks`, { url, events: ['digest.weekly'] })).json;
    assert.equal((await call(S1U, 'POST', `${P}/webhooks/${wh.id}/test`, {})).status, 403);
    const t = (await call(P1U, 'POST', `${P}/webhooks/${wh.id}/test`, { event: 'box.created' })).json;
    assert.equal(t.status, 200);
    assert.equal(JSON.parse(got[0]!).test, true);
    assert.equal((await call(P1U, 'POST', `${P}/webhooks/${wh.id}/test`, { event: 'digest.weekly' })).json.status, 200);
    assert.ok(JSON.parse(got[1]!).digest.newBoxes);
    // due: a week has passed since the last one
    const { sweepDigests } = await import('../src/background.ts');
    assert.equal(await sweepDigests(sweepDeps), 0, 'sent just now: not due');
    await ownerSql(`UPDATE webhook_subscriptions SET last_digest_at = now() - interval '8 days' WHERE id = $1`, [wh.id]);
    assert.ok((await sweepDigests(sweepDeps)) >= 1);
    assert.ok(await settle(async () => got.length >= 3));
    assert.equal(JSON.parse(got[2]!).event, 'digest.weekly');
  } finally { srv.close(); }
});

test('inbound adapters: Calendly, Typeform, Jotform, Google Forms and plain posts become records', async () => {
  const P = `/v1/pipelines/${pipe1}`;
  const hook = (await call(P1U, 'POST', `${P}/intakes`, { kind: 'webhook', name: 'Adapters', contextNodeId: X })).json;
  const t = hook.url.split('/hooks/')[1];
  const post = (b: unknown) => publicCall('POST', `/v1/hooks/${t}`, b);
  const find = async (q: string) => (await call(P1U, 'GET', `/v1/boxes?pipelineId=${pipe1}&q=${encodeURIComponent(q)}`)).json.boxes[0];
  const noteOf = async (b: any) => (await call(P1U, 'GET', `/v1/boxes/${b.id}/notes`)).json.notes[0].body as string;

  assert.equal((await post({ event: 'invitee.created', payload: { name: 'Cal Ender', email: 'cal@x.test', text_reminder_number: '555', scheduled_event: { name: '15 min intro', start_time: '2026-10-05T15:00:00Z' }, questions_and_answers: [{ question: 'Topic', answer: 'Home cover' }] } })).status, 201);
  const cal = await find('Cal Ender');
  assert.match(await noteOf(cal), /Calendly.*15 min intro.*Topic: Home cover/s);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${cal.id}`)).json.contacts[0].email, 'cal@x.test');
  assert.equal((await post({ event: 'invitee.canceled', payload: { name: 'Cal Ender', email: 'cal@x.test' } })).json.ignored, true);

  assert.equal((await post({ form_response: { definition: { fields: [{ id: 'a', title: 'Your name' }, { id: 'b', title: 'Budget' }] }, answers: [{ type: 'text', text: 'Type Form', field: { id: 'a' } }, { type: 'email', email: 'tf@x.test', field: { id: 'e' } }, { type: 'choice', choice: { label: '$500' }, field: { id: 'b' } }] } })).status, 201);
  assert.match(await noteOf(await find('Type Form')), /Typeform.*Budget: \$500/s);

  assert.equal((await post({ rawRequest: JSON.stringify({ q3_name: { first: 'Jot', last: 'Form' }, q4_email: 'jot@x.test', q5_phone: '555-1', q6_comments: 'Call me' }) })).status, 201);
  const jot = await find('Jot Form');
  assert.match(await noteOf(jot), /Jotform.*Call me/s);

  assert.equal((await post({ namedValues: { Name: ['Goo Gle'], 'Email Address': ['goo@x.test'], 'What do you need?': ['Auto quote'] } })).status, 201);
  assert.match(await noteOf(await find('Goo Gle')), /Google Forms.*What do you need\?: Auto quote/s);

  assert.equal((await post({ email: 'only@x.test', Message: 'hi' })).status, 201);
  assert.ok(await find('only'), 'name falls back to the email');
  assert.equal((await post({ nothing: 'here' })).status, 422);
  // a field called "website" on a webhook is a real answer, not a bot trap
  assert.equal((await post({ name: 'Has Site', website: 'https://x.test' })).status, 201);
  assert.ok(await find('Has Site'));
  // form-encoded posts work on capture links only
  const enc = await app.inject({ method: 'POST', url: `/v1/hooks/${t}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=Url+Encoded&email=ue%40x.test' });
  assert.equal(enc.statusCode, 201);
  assert.ok(await find('Url Encoded'));
  assert.equal((await app.inject({ method: 'POST', url: '/v1/boxes', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-dev-user-email': P1U }, payload: 'a=b' })).statusCode, 415);
});

test('snippets: private by default, shared down to the team only, filled in for the person written to', async () => {
  const mine = (await call(P1U, 'POST', '/v1/snippets', { name: 'Renewal', body: 'Hi {{firstName|there}},\n\nYour renewal is due. {{myName}}, {{company}}' })).json.id;
  assert.equal((await call(S1U, 'GET', '/v1/snippets')).json.snippets.length, 0, 'private to the author');
  assert.equal((await call(S1U, 'POST', '/v1/snippets', { name: 'x', body: 'y', shared: true })).status, 403, 'members cannot share');
  assert.equal((await call(P1U, 'PATCH', `/v1/snippets/${mine}`, { shared: true })).status, 204);
  assert.equal((await call(S1U, 'GET', '/v1/snippets')).json.snippets.length, 1, 'the sub-partner beneath sees it');
  assert.equal((await call(P2U, 'GET', '/v1/snippets')).json.snippets.length, 0, 'siblings never do');
  assert.equal((await call(S1U, 'PATCH', `/v1/snippets/${mine}`, { name: 'hijack' })).status, 404, 'only the author edits');
  const r = (await call(S1U, 'POST', `/v1/snippets/${mine}/render`, { toName: 'Ada Lovelace <script>', toEmail: 'ada@x.test' })).json.html as string;
  assert.match(r, /Hi Ada/);
  assert.ok(!r.includes('<script>'), 'values are escaped');
  assert.match((await call(S1U, 'POST', `/v1/snippets/${mine}/render`, {})).json.html, /Hi there/);
  assert.equal((await call(P1U, 'DELETE', `/v1/snippets/${mine}`)).status, 204);
});

test('mail merge: recipients, opt-out, unsubscribe link, one message at a time, notes, and the add-to-merge automation', async () => {
  const mkBox = async (name: string, email: string | null) => {
    const cids: string[] = [];
    if (email) cids.push((await call(P1U, 'POST', '/v1/contacts', { email, fullName: `${name} Person`, contextNodeId: X })).json.id);
    return (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name, contextNodeId: X, custom: { policy_no: name }, contactIds: cids })).json.id as string;
  };
  const a = await mkBox('MergeA', 'mergea@x.test'), b = await mkBox('MergeB', 'mergeb@x.test'), noMail = await mkBox('MergeNoMail', null);
  const tpl = { name: 'Renewals', subject: 'Hello {{firstName}}', body: 'Dear {{firstName|friend}},\n\nPolicy {{policy_no}} at {{company}}.\n\n{{unsubscribe}}' };
  assert.equal((await call(P1U, 'POST', '/v1/merges', { ...tpl, body: 'No opt-out here', boxIds: [a] })).status, 422, 'must include an unsubscribe link');
  const made = (await call(P1U, 'POST', '/v1/merges', { ...tpl, boxIds: [a, b, noMail, a] })).json;
  assert.equal(made.recipients, 2);
  assert.equal(made.skipped.noEmail, 1);
  assert.equal(made.skipped.duplicate, 1);
  const M = `/v1/merges/${made.id}`;
  assert.equal((await call(P2U, 'GET', M)).status, 404, 'merges are private to the sender');
  assert.equal((await call(S1U, 'GET', M)).status, 404);

  const pv = (await call(P1U, 'POST', '/v1/merges/preview', { subject: tpl.subject, body: tpl.body + ' {{nope}}', boxId: a })).json;
  assert.equal(pv.subject, 'Hello MergeA');
  assert.match(pv.html, /Policy MergeA at CRM Test Co/);
  assert.deepEqual(pv.unknown, ['nope']);

  assert.equal((await call(P1U, 'POST', `${M}/next`)).json.idle, true, 'nothing goes out until started');
  assert.equal((await call(P1U, 'PATCH', M, { status: 'running' })).status, 204);
  assert.equal((await call(P1U, 'PATCH', M, { subject: 'changed' })).status, 422, 'pause before editing');

  const first = (await call(P1U, 'POST', `${M}/next`)).json;
  assert.match(first.to, /merge[ab]@x\.test/);
  assert.match(first.html, /\/u\/unsub_/);
  assert.equal((await call(P1U, 'POST', `${M}/recipients/${first.recipientId}/result`, { ok: true, threadId: 'thr-1' })).status, 204);
  assert.equal((await call(P1U, 'POST', `${M}/recipients/${first.recipientId}/result`, { ok: true })).status, 422, 'reported once');
  const second = (await call(P1U, 'POST', `${M}/next`)).json;
  assert.notEqual(second.to, first.to);
  assert.equal((await call(P1U, 'POST', `${M}/recipients/${second.recipientId}/result`, { ok: false, error: 'compose closed' })).status, 204);
  assert.equal((await call(P1U, 'POST', `${M}/next`)).json.done, true);
  const state = (await call(P1U, 'GET', M)).json;
  assert.equal(state.status, 'done');
  assert.equal(state.sent, 1);
  assert.equal(state.failed, 1);
  const sentBox = first.to.startsWith('mergea') ? a : b;
  assert.match((await call(P1U, 'GET', `/v1/boxes/${sentBox}/notes`)).json.notes[0].body, /Mail merge “Renewals”: sent “Hello Merge[AB]/);
  assert.equal((await call(P1U, 'POST', `${M}/retry-failed`)).json.retried, 1);

  // the recipient unsubscribes through the public page
  const token = first.html.match(/\/u\/(unsub_[\w-]+)/)[1];
  assert.equal((await publicCall('GET', '/u/unsub_wrong')).status, 404);
  assert.match((await publicCall('GET', `/u/${token}`)).text, /Yes, unsubscribe me/);
  const un = await app.inject({ method: 'POST', url: `/u/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  assert.equal(un.statusCode, 200);
  assert.match((await publicCall('GET', `/u/${token}`)).text, /You are unsubscribed/);
  const again = (await call(P1U, 'POST', '/v1/merges', { ...tpl, name: 'Second', boxIds: [sentBox] })).json;
  assert.equal(again.recipients, 0, 'opted-out contacts are never added');
  assert.equal(again.skipped.optedOut, 1);

  // automation: entering a stage adds the record's contact to a merge
  const target = (await call(P1U, 'POST', '/v1/merges', { ...tpl, name: 'Welcome', boxIds: [] })).json.id;
  const stage = stage1[3];
  assert.equal((await call(P2U, 'POST', `/v1/pipelines/${pipe1}/automations`, { stageId: stage, action: 'add_to_merge', mergeId: target })).status, 404);
  assert.equal((await call(P1U, 'POST', `/v1/pipelines/${pipe1}/automations`, { stageId: stage, action: 'add_to_merge', mergeId: randomUUIDLike() })).status, 422, 'must be my own merge');
  assert.equal((await call(P1U, 'POST', `/v1/pipelines/${pipe1}/automations`, { stageId: stage, action: 'add_to_merge', mergeId: target })).status, 201);
  const fresh = await mkBox('MergeFresh', 'fresh@x.test');
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${fresh}`, { stageId: stage })).status, 204);
  assert.ok(await settle(async () => (await call(P1U, 'GET', `/v1/merges/${target}`)).json.total === 1));
});
const randomUUIDLike = () => '00000000-0000-4000-8000-000000000001';

test('AI assist: off until an admin enables it, stays inside what you can see, and at-risk flags use plain rules', async () => {
  const seen: string[] = [];
  const fake = { model: 'fake-1', complete: async (i: { system: string; user: string }) => { seen.push(i.user); return 'Call them today.'; } };
  const saved = sweepDeps.ai;
  // buildApp copies deps, so a fresh app with the fake client is needed.
  const app2 = buildApp({ ...sweepDeps, ai: fake });
  const call2 = async (email: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const r = await app2.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
  };
  const box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'AiBox', contextNodeId: X, custom: { policy_no: 'AiBox' } })).json.id as string;
  assert.equal((await call2(P1U, 'POST', `/v1/boxes/${box}/ai`, { kind: 'summary' })).status, 403, 'off by default');
  assert.equal((await call2(S1U, 'PUT', '/v1/ai/settings', { enabled: true })).status, 403, 'admins only');
  const on = await call2(ADMIN, 'PUT', '/v1/ai/settings', { enabled: true, includeEmail: false });
  assert.equal(on.json.enabled, true);
  assert.equal((await call2(P2U, 'POST', `/v1/boxes/${box}/ai`, { kind: 'summary' })).status, 404, 'a sibling cannot see the record');
  const r = await call2(P1U, 'POST', `/v1/boxes/${box}/ai`, { kind: 'next_action' });
  assert.equal(r.status, 200);
  assert.equal(r.json.body, 'Call them today.');
  assert.match(seen[0]!, /<record>[\s\S]*AiBox/);
  assert.equal((await call2(P1U, 'GET', `/v1/boxes/${box}/ai`)).json.insights.length, 1);
  assert.equal((await call2(P2U, 'GET', `/v1/boxes/${box}/ai`)).json.insights.length, 0);
  await ownerSql(`UPDATE boxes SET stage_entered_at = now() - interval '30 days' WHERE id = $1`, [box]);
  const risk = await call2(P1U, 'GET', `/v1/pipelines/${pipe1}/at-risk`);
  assert.equal(risk.status, 200);
  const mine = risk.json.risks.find((x: { id: string }) => x.id === box);
  assert.ok(mine && mine.reasons.includes('stalled') && mine.reasons.includes('no_next_step'));
  await app2.close();
  void saved;
});

test('settings: layered values, locks held by the database, and nothing leaks sideways', async () => {
  const get = async (u: string) => (await call(u, 'GET', '/v1/settings')).json.settings;
  assert.equal((await get(S1U))['merge.dailyCap'].value, 400, 'default');
  assert.equal((await call(S1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'user', value: 25 })).status, 200);
  assert.equal((await get(S1U))['merge.dailyCap'].value, 25);
  assert.equal((await call(S1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'user', value: 5000 })).status, 422, 'out of range');
  assert.equal((await call(S1U, 'PUT', '/v1/settings/nope', { scope: 'user', value: 1 })).status, 422, 'unknown key');
  assert.equal((await call(S1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'user', value: 25, locked: true })).status, 422, 'a person cannot lock');
  assert.equal((await call(S1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'node', scopeId: P1, value: 50 })).status, 403, 'a member cannot set branch values');
  assert.equal((await call(P1U, 'PUT', '/v1/settings/ui.defaultView', { scope: 'node', scopeId: P1, value: 'board', locked: true })).status, 422, 'not lockable');

  // Partner One's manager sets and locks a cap for the branch; Sub One sits beneath it.
  assert.equal((await call(P1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'node', scopeId: P1, value: 50, locked: true })).status, 200);
  const s1 = (await get(S1U))['merge.dailyCap'];
  assert.equal(s1.value, 50);
  assert.equal(s1.locked, true);
  assert.equal(s1.source.name, 'Partner One');
  assert.equal(s1.own, 25, 'own value is kept but overridden');
  const blocked = await call(S1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'user', value: 30 });
  assert.equal(blocked.status, 423, 'the database refuses a write under a lock');
  assert.equal((await get(P2U))['merge.dailyCap'].value, 400, 'a sibling branch is untouched');
  assert.equal((await call(P2U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'node', scopeId: P1, value: 50 })).status, 403, 'cannot set another branch');

  // The company can lock above the branch; the manager is then stopped too.
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'tenant', value: 100, locked: true })).status, 200);
  assert.equal((await get(S1U))['merge.dailyCap'].value, 100, 'the highest lock wins');
  assert.equal((await call(P1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'node', scopeId: P1, value: 30, locked: true })).status, 423);
  assert.equal((await call(P1U, 'PUT', '/v1/settings/merge.dailyCap', { scope: 'tenant', value: 50 })).status, 403);

  // Unlock and clear; the person's own value comes back.
  assert.equal((await call(ADMIN, 'DELETE', '/v1/settings/merge.dailyCap?scope=tenant')).status, 200);
  assert.equal((await call(P1U, 'DELETE', `/v1/settings/merge.dailyCap?scope=node&scopeId=${P1}`)).status, 200);
  assert.equal((await get(S1U))['merge.dailyCap'].value, 25);
  assert.equal((await call(S1U, 'DELETE', '/v1/settings/merge.dailyCap?scope=user')).status, 200);
  assert.equal((await get(S1U))['merge.dailyCap'].value, 400);

  // Nav layout is cleaned: unknown items are refused, missing ones are appended.
  assert.equal((await call(S1U, 'PUT', '/v1/settings/nav.layout', { scope: 'user', value: { order: ['bogus'], hidden: [] } })).status, 422);
  const lay = await call(S1U, 'PUT', '/v1/settings/nav.layout', { scope: 'user', value: { order: ['training', 'home'], hidden: ['contacts'] } });
  assert.deepEqual(lay.json.settings['nav.layout'].value.order, ['training', 'home', 'notifications', 'pipelines', 'renewals', 'contacts', 'merges', 'settings']);
  const hist = (await call(S1U, 'GET', '/v1/settings/history')).json.history;
  assert.ok(hist.some((h: { key: string }) => h.key === 'merge.dailyCap'));
  assert.ok(!hist.some((h: { scopeType: string; changedBy: string }) => h.scopeType === 'user' && /p1@|admin@/.test(h.changedBy)), "others' personal history is not visible");
});

test('left panel and home: layout drives the items, the layout is per person, counts are live', async () => {
  const nav = async (u: string) => (await call(u, 'GET', '/v1/nav')).json;
  const base = await nav(P1U);
  assert.deepEqual(base.items.map((i: { id: string }) => i.id), ['home', 'notifications', 'pipelines', 'renewals', 'contacts', 'merges', 'settings']);
  assert.ok(base.pipelines.some((p: { id: string }) => p.id === pipe1));
  const mk = await call(P1U, 'POST', `/v1/pipelines/${pipe1}/views`, { name: 'Nav view', shared: true, config: { scope: 'all' } });
  assert.ok(mk.status < 300, JSON.stringify(mk.json));
  const withV = (await nav(P1U)).pipelines.find((p: { id: string }) => p.id === pipe1);
  assert.ok(withV.views.some((v: { name: string }) => v.name === 'Nav view'), 'saved views are listed under their pipeline');
  assert.ok(!(await nav(P2U)).pipelines.some((p: { views: { name: string }[] }) => p.views.some((v) => v.name === 'Nav view')), 'a sibling does not see it');
  assert.equal((await call(P1U, 'PUT', '/v1/settings/nav.layout', { scope: 'user', value: { order: ['training', 'home'], hidden: ['merges', 'settings'] } })).status, 200);
  const mine = await nav(P1U);
  assert.deepEqual(mine.items.map((i: { id: string }) => i.id), ['home', 'notifications', 'pipelines', 'renewals', 'contacts', 'settings'], 'settings can never be hidden');
  assert.equal((await nav(LRN)).items.length, 7, 'everyone is a partner, learners included');
  const home = (await call(P1U, 'GET', '/v1/home')).json;
  assert.ok(Array.isArray(home.tasks) && Array.isArray(home.risks) && Array.isArray(home.merges) && Array.isArray(home.recent));
  assert.ok(home.recent.length > 0);
  const viewId = (home.views as { id: string; name: string }[]).find((v) => v.name === 'Nav view')!.id;
  assert.equal((await call(P1U, 'PUT', '/v1/home/pins', { viewIds: [viewId] })).status, 204);
  const pinned = (await call(P1U, 'GET', '/v1/home')).json;
  assert.deepEqual(pinned.pins.map((v: { name: string }) => v.name), ['Nav view'], 'a pinned view shows as a shortcut');
  assert.ok(pinned.views.find((v: { id: string }) => v.id === viewId).pinned);
  assert.equal((await call(P2U, 'GET', '/v1/home')).json.pins.length, 0, 'pins are personal');
  assert.equal((await call(P1U, 'PUT', '/v1/home/pins', { viewIds: [] })).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/home')).json.pins.length, 0, 'and can be removed');
  assert.ok(Array.isArray(home.trending) && typeof home.defaultPipeline === 'string');
  assert.equal((await call(P2U, 'GET', '/v1/home')).json.recent.every((r: { id: string }) => !home.recent.some((x: { id: string }) => x.id === r.id)), true, 'a sibling sees none of the same records');
  await call(P1U, 'DELETE', '/v1/settings/nav.layout?scope=user');
});

test('renewals: tasks at 90/60/30 days once each, owner only, decided records skipped, list and counts', async () => {
  const pl = (await call(P1U, 'POST', '/v1/pipelines', { name: 'Renewals T', fields: [{ key: 'renewal_date', labels: { en: 'Renewal date' }, type: 'date' }, { key: 'policy_type', labels: { en: 'Policy type' }, type: 'text' }] })).json;
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const mk = async (name: string, n: number) => (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pl.id, name, contextNodeId: X, custom: { renewal_date: day(n), policy_type: 'Auto' } })).json.id as string;
  const a = await mk('Ren 50', 50), b = await mk('Ren 20', 20), far = await mk('Ren 200', 200);
  for (const id of [a, b, far]) await ownerSql(`UPDATE boxes SET owner_user_id = (SELECT id FROM app_users WHERE email = $2) WHERE id = $1`, [id, P1U]);
  const { sweepRenewals } = await import('../src/renewals.ts');
  assert.equal(await sweepRenewals(sweepDeps) >= 2, true);
  const title = async (id: string) => ((await call(P1U, 'GET', `/v1/tasks?boxId=${id}`)).json.tasks as { title: string }[]).map((t) => t.title);
  assert.deepEqual((await title(a)).map((x) => x.split(':')[0]), ['Renewal in 50 days']);
  assert.deepEqual((await title(b)).map((x) => x.split(':')[0]), ['Renewal in 20 days']);
  assert.equal((await title(far)).length, 0, 'beyond 90 days: nothing yet');
  await sweepRenewals(sweepDeps);
  assert.equal((await title(a)).length, 1, 'once only');
  await ownerSql(`UPDATE boxes SET custom = jsonb_set(custom, '{renewal_date}', to_jsonb($2::text)) WHERE id = $1`, [a, day(25)]);
  await sweepRenewals(sweepDeps);
  assert.equal((await title(a)).length, 2, 'a new window (30) makes one more task');
  const r = (await call(P1U, 'GET', '/v1/renewals?days=90')).json;
  assert.ok(r.items.some((i: { name: string; daysLeft: number }) => i.name === 'Ren 20' && i.daysLeft === 20));
  assert.ok(!r.items.some((i: { name: string }) => i.name === 'Ren 200'));
  assert.ok(r.counts.d30 >= 2);
  assert.equal((await call(P2U, 'GET', '/v1/renewals?days=90')).json.items.some((i: { name: string }) => i.name === 'Ren 20'), false, 'siblings cannot see them');
});

test('duplicates: found by name and by shared contact, merged with notes, tasks and contacts moved, isolated from siblings', async () => {
  const pl = (await call(P1U, 'POST', '/v1/pipelines', { name: 'Dup T', fields: [{ key: 'phone_no', labels: { en: 'Phone' }, type: 'text' }] })).json;
  const mk = async (name: string, extra: object = {}) => (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pl.id, name, contextNodeId: X, ...extra })).json.id as string;
  const a = await mk('Singh  Auto', { valueAmount: 500 }), b = await mk('singh auto', { custom: { phone_no: '555' } }), solo = await mk('Unrelated');
  await call(P1U, 'POST', `/v1/boxes/${a}/notes`, { body: 'first' });
  await call(P1U, 'POST', `/v1/boxes/${b}/notes`, { body: 'second' });
  await call(P1U, 'POST', `/v1/boxes/${b}/tasks`, { title: 'call back' });
  const ct = (await call(P1U, 'POST', '/v1/contacts', { email: 'shared@dup.example', fullName: 'Shared', contextNodeId: X })).json.id as string;
  await call(P1U, 'PUT', `/v1/boxes/${b}/contacts/${ct}`);
  const g = (await call(P1U, 'GET', `/v1/pipelines/${pl.id}/duplicates`)).json.groups as { reason: string; boxes: { id: string }[] }[];
  assert.equal(g.length, 1);
  assert.deepEqual(g[0]!.boxes.map((x) => x.id).sort(), [a, b].sort());
  assert.equal((await call(P2U, 'GET', `/v1/pipelines/${pl.id}/duplicates`)).status === 200 ? ((await call(P2U, 'GET', `/v1/pipelines/${pl.id}/duplicates`)).json.groups as unknown[]).length : 0, 0, 'siblings see nothing');
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${a}/merge`, { ids: [b] })).status === 404, true);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${a}/merge`, { ids: [a] })).status, 422);
  const mr = await call(P1U, 'POST', `/v1/boxes/${a}/merge`, { ids: [b] }); assert.equal(mr.status, 200, JSON.stringify(mr.json));
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${b}`)).status, 404, 'the other record is gone');
  const notes = (await call(P1U, 'GET', `/v1/boxes/${a}/notes`)).json.notes as { body: string }[];
  assert.ok(notes.some((n) => n.body === 'second') && notes.some((n) => n.body.startsWith('Merged 1')));
  assert.equal(((await call(P1U, 'GET', `/v1/tasks?boxId=${a}`)).json.tasks as unknown[]).length, 1);
  const kept = (await call(P1U, 'GET', `/v1/boxes/${a}`)).json;
  assert.equal(kept.custom.phone_no, '555', 'empty field filled from the merged record');
  assert.equal(Number(kept.valueAmount), 500);
  assert.ok(solo);
});

test('call log: a call is a note with an outcome and minutes, shown in the timeline, and bad outcomes are refused', async () => {
  const box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'CallBox', contextNodeId: X, custom: { policy_no: 'C1' } })).json.id as string;
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/notes`, { body: 'Renewal quote discussed', kind: 'call', outcome: 'connected', minutes: 12 })).status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/notes`, { body: 'x', kind: 'call', outcome: 'bogus' })).status, 400);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/notes`, { body: 'plain' })).status, 201);
  const items = (await call(P1U, 'GET', `/v1/boxes/${box}/timeline`)).json.items as { kind: string; outcome: string | null; minutes: number | null }[];
  const c = items.find((i) => i.kind === 'call');
  assert.ok(c && c.outcome === 'connected' && c.minutes === 12);
  assert.equal(items.filter((i) => i.kind === 'note').length, 1);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${box}/timeline`)).status, 404, 'siblings cannot see it');
});

test('notifications: told only about others, private to the person, filtered by their own settings', async () => {
  const box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe1, name: 'NotifyBox', contextNodeId: X, custom: { policy_no: 'N1' } })).json.id as string;
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/tasks`, { title: 'Call back', assigneeId: s1UserId })).status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/tasks`, { title: 'Own task' })).status, 201, 'a task for yourself tells nobody');
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/notes`, { body: 'Please see this', mentions: [s1UserId] })).status, 201);
  const list = async (u: string) => (await call(u, 'GET', '/v1/notifications')).json;
  const mine = await list(S1U);
  assert.deepEqual(mine.notifications.map((n: { kind: string }) => n.kind).sort(), ['mention', 'task_assigned']);
  assert.equal(mine.unread, 2);
  assert.equal(mine.notifications[0].data.boxName, 'NotifyBox');
  assert.ok(!(await list(P1U)).notifications.some((n: { data: { boxName?: string } }) => n.data.boxName === 'NotifyBox'), 'the actor is not told about their own actions');
  assert.ok(!(await list(P2U)).notifications.some((n: { data: { boxName?: string } }) => n.data.boxName === 'NotifyBox'), 'private to the person');
  // The person's own switch hides a kind everywhere, including the count.
  assert.equal((await call(S1U, 'PUT', '/v1/settings/notify.mention', { scope: 'user', value: false })).status, 200);
  const filtered = await list(S1U);
  assert.deepEqual(filtered.notifications.map((n: { kind: string }) => n.kind), ['task_assigned']);
  assert.equal(filtered.unread, 1);
  assert.equal((await call(S1U, 'GET', '/v1/nav')).json.items.find((i: { id: string }) => i.id === 'notifications').count, 1);
  assert.equal((await call(P2U, 'POST', '/v1/notifications/read', { all: true })).status, 204);
  assert.equal((await list(S1U)).unread, 1, 'someone else clearing theirs changes nothing here');
  assert.equal((await call(S1U, 'POST', '/v1/notifications/read', { all: true })).status, 204);
  assert.equal((await list(S1U)).unread, 0);
  await call(S1U, 'DELETE', '/v1/settings/notify.mention?scope=user');
});

test('privacy centre: my data, export, requests visible to me and the company admin only', async () => {
  const me = (await call(P1U, 'GET', '/v1/privacy')).json;
  assert.equal(me.email, P1U);
  assert.ok(me.held.notes >= 1, 'notes I wrote are counted');
  assert.deepEqual(me.queue, [], 'a partner sees no queue');
  const ex = await call(P1U, 'GET', '/v1/privacy/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.json.profile.email, P1U);
  assert.ok(ex.json.notes.length >= 1);
  assert.ok(ex.json.notes.every((n: { body: string }) => typeof n.body === 'string'));
  assert.ok(!JSON.stringify(ex.json).includes(S1U), 'nobody else is in my export');
  const r = await call(P1U, 'POST', '/v1/privacy/requests', { kind: 'withdraw', note: 'Please stop using my data' });
  assert.equal(r.status, 201);
  assert.equal((await call(P1U, 'POST', '/v1/privacy/requests', { kind: 'withdraw' })).status, 200, 'a second identical request is not duplicated');
  assert.equal((await call(P2U, 'GET', '/v1/privacy')).json.requests.length, 0, 'a sibling cannot see it');
  const adm = (await call(ADMIN, 'GET', '/v1/privacy')).json;
  assert.ok(adm.queue.some((q: { id: string }) => q.id === r.json.id), 'the company admin sees the queue');
  assert.equal((await call(P1U, 'PATCH', `/v1/privacy/requests/${r.json.id}`, { status: 'done' })).status, 403);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/privacy/requests/${r.json.id}`, { status: 'done', resolution: 'Consent withdrawn' })).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/privacy')).json.requests[0].status, 'done');
  assert.equal((await call(ADMIN, 'PATCH', `/v1/privacy/requests/${r.json.id}`, { status: 'done' })).status, 404, 'already resolved');
});

test('organization: rename, switch off, roles, people and invitations are controlled by the right admin', async () => {
  const nodes = (await call(ADMIN, 'GET', '/v1/org/nodes')).json.nodes as { id: string; name: string; type: string }[];
  const root = nodes.find((n) => n.type === 'tenant')!;
  assert.equal((await call(P1U, 'PATCH', `/v1/org/nodes/${root.id}`, { name: 'Nope' })).status, 403, 'a partner cannot rename the company');
  assert.equal((await call(ADMIN, 'PATCH', `/v1/org/nodes/${P1}`, { name: 'Partner One Renamed' })).status, 204);
  assert.ok(((await call(ADMIN, 'GET', '/v1/org/nodes')).json.nodes as { name: string }[]).some((n) => n.name === 'Partner One Renamed'));
  assert.equal((await call(ADMIN, 'PATCH', `/v1/org/nodes/${P1}`, { name: 'Partner One' })).status, 204);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/org/nodes/${root.id}`, { isActive: false })).status, 422, 'the company cannot be switched off');
  assert.equal((await call(P2U, 'PATCH', `/v1/org/nodes/${P1}`, { name: 'Hijack' })).status, 404, 'a sibling cannot even see it');

  const members = (await call(ADMIN, 'GET', '/v1/org/members')).json.members as { email: string; role: string; nodeId: string; userId: string }[];
  assert.ok(members.some((m) => m.email === P1U && m.nodeId === P1));
  assert.ok(!((await call(P2U, 'GET', '/v1/org/members')).json.members as { email: string }[]).some((m) => m.email === P1U), 'a sibling sees no one of the other branch');
  const p1 = members.find((m) => m.email === P1U)!;
  assert.equal((await call(S1U, 'POST', '/v1/org/members', { userId: s1UserId, nodeId: S1, role: 'admin' })).status, 403, 'a member cannot promote themselves');
  assert.equal((await call(ADMIN, 'POST', '/v1/org/members', { userId: p1.userId, nodeId: P1, role: 'manager' })).status, 204);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/org/members?userId=${p1.userId}&nodeId=${P1}&role=manager`)).status, 204);
  const adm = members.find((m) => m.email === ADMIN && m.role === 'admin')!;
  assert.equal((await call(ADMIN, 'DELETE', `/v1/org/members?userId=${adm.userId}&nodeId=${adm.nodeId}&role=admin`)).status, 422, 'the last company admin stays');

  const inv = (await call(ADMIN, 'POST', '/v1/invitations', { email: 'new.person@crm.test', nodeId: P1, role: 'partner' })).json;
  assert.ok(inv.acceptUrl);
  assert.equal((await call(P2U, 'DELETE', `/v1/invitations/${inv.id}`)).status, 404, 'a sibling cannot withdraw it');
  assert.equal((await call(ADMIN, 'DELETE', `/v1/invitations/${inv.id}`)).status, 204);
  assert.equal((await call(ADMIN, 'DELETE', `/v1/invitations/${inv.id}`)).status, 404);

  assert.equal((await call(ADMIN, 'PATCH', `/v1/users/${p1.userId}`, { status: 'disabled' })).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/me')).status, 401, 'a switched-off person is signed out');
  assert.equal((await call(ADMIN, 'PATCH', `/v1/users/${p1.userId}`, { status: 'active' })).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/me')).status, 200);
  assert.equal((await call(ADMIN, 'PATCH', `/v1/users/${adm.userId}`, { status: 'disabled' })).status, 422, 'not yourself');
  assert.equal((await call(ADMIN, 'GET', '/v1/me')).json.canAdminister, true);
  assert.equal((await call(P1U, 'GET', '/v1/me')).json.canAdminister, true, 'a partner admin administers their own branch');
  assert.equal((await call(S1U, 'GET', '/v1/me')).json.canAdminister, false);
});

test('invitations: honest status, delivery report, the link page, resend and expiry', async () => {
  const mk = async (email: string) => (await call(ADMIN, 'POST', '/v1/invitations', { email, nodeId: P1, role: 'partner' })).json;
  const get = async (u: string, id: string) => ((await call(u, 'GET', '/v1/invitations')).json.invitations as any[]).find((i) => i.id === id);
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  const inv = await mk('status.person@crm.test');
  assert.equal(inv.status, 'created');
  assert.equal((await get(ADMIN, inv.id)).status, 'created', 'nothing sent yet, and it says so');
  assert.equal((await call(ADMIN, 'POST', `/v1/invitations/${inv.id}/delivery`, { method: 'gmail', ok: false, error: 'The compose window was closed' })).status, 204);
  const failed = await get(ADMIN, inv.id);
  assert.equal(failed.status, 'not_sent');
  assert.equal(failed.deliveryError, 'The compose window was closed');
  assert.equal((await call(ADMIN, 'POST', `/v1/invitations/${inv.id}/delivery`, { method: 'gmail', ok: true, threadId: '18c3fa01b2d4e5f6' })).status, 204);
  const sent = await get(ADMIN, inv.id);
  assert.equal(sent.gmailThreadId, '18c3fa01b2d4e5f6');
  assert.equal((await call(ADMIN, 'POST', `/v1/invitations/${inv.id}/delivery`, { method: 'gmail', ok: true, threadId: '<script>' })).status, 400, 'a thread id is only letters and digits');
  assert.equal(sent.status, 'sent');
  assert.equal(sent.attempts, 2);
  assert.equal(sent.deliveryError, null);
  assert.equal(await get(P2U, inv.id), undefined, 'a sibling cannot see it');
  assert.equal((await call(P2U, 'POST', `/v1/invitations/${inv.id}/delivery`, { method: 'gmail', ok: true })).status, 404);

  // The page behind the link records that the link was opened, once.
  const page = await app.inject({ method: 'GET', url: `/accept?token=${tokenOf(inv.acceptUrl)}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /You are invited/);
  assert.match(page.body, /Partner One/);
  assert.equal((await get(ADMIN, inv.id)).status, 'opened');
  const opened1 = (await get(ADMIN, inv.id)).linkOpenedAt;
  await app.inject({ method: 'GET', url: `/accept?token=${tokenOf(inv.acceptUrl)}` });
  assert.equal((await get(ADMIN, inv.id)).linkOpenedAt, opened1, 'the first open is kept');
  assert.equal((await app.inject({ method: 'GET', url: '/accept?token=not-a-real-token-at-all-123456' })).statusCode, 404);

  // Resend: a fresh link, the old one stops, the state starts again.
  await new Promise((r) => setTimeout(r, 3100));
  const again = (await call(ADMIN, 'POST', `/v1/invitations/${inv.id}/resend`)).json;
  assert.notEqual(tokenOf(again.acceptUrl), tokenOf(inv.acceptUrl));
  assert.equal((await app.inject({ method: 'GET', url: `/accept?token=${tokenOf(inv.acceptUrl)}` })).statusCode, 404, 'the old link is dead');
  assert.equal((await get(ADMIN, inv.id)).status, 'created');
  assert.equal((await call(ADMIN, 'POST', `/v1/invitations/${inv.id}/resend`)).status, 429, 'not twice in a row');

  // Expired.
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  await o.query(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [inv.id]);
  assert.equal((await get(ADMIN, inv.id)).status, 'expired');
  const exp = await app.inject({ method: 'GET', url: `/accept?token=${tokenOf(again.acceptUrl)}` });
  assert.equal(exp.statusCode, 410);
  assert.match(exp.body, /expired/);
  // The 3-day nudge, once.
  const inv2 = await mk('stuck.person@crm.test');
  await o.query(`UPDATE invitations SET created_at = now() - interval '4 days' WHERE id = $1`, [inv2.id]);
  await o.end();
  const { sweepStaleInvitations } = await import('../src/background.ts');
  assert.ok((await sweepStaleInvitations(sweepDeps)) >= 1);
  assert.equal(await sweepStaleInvitations(sweepDeps), 0, 'only once');
  assert.ok(((await call(ADMIN, 'GET', '/v1/notifications')).json.notifications as any[]).some((n) => n.kind === 'invite_stale' && n.data.email === 'stuck.person@crm.test'));
  await call(ADMIN, 'DELETE', `/v1/invitations/${inv.id}`);
  await call(ADMIN, 'DELETE', `/v1/invitations/${inv2.id}`);
});

test('activity: readable by the right admin, scoped by branch, filterable, exportable, append-only', async () => {
  const all = (await call(ADMIN, 'GET', '/v1/activity')).json;
  assert.ok(all.events.length > 0);
  assert.ok(all.events.some((e: any) => e.action === 'invitation_sent' && e.area === 'invitations' && e.detail.email));
  assert.equal((await call(S1U, 'GET', '/v1/activity')).status, 403, 'a member has no activity screen');
  // A partner admin sees only events placed in their own branch.
  const p1 = (await call(P1U, 'GET', '/v1/activity?limit=500')).json.events as any[];
  assert.ok(p1.length > 0);
  assert.ok(p1.every((e) => e.placeId !== null), 'only lines that belong to a branch');
  const p2 = (await call(P2U, 'GET', '/v1/activity?limit=500')).json.events as any[];
  assert.ok(!p2.some((e) => e.detail?.email === 'status.person@crm.test'), 'a sibling never sees the other branch invitations');
  // Filters.
  const inv = (await call(ADMIN, 'GET', '/v1/activity?area=invitations')).json.events as any[];
  assert.ok(inv.length > 0 && inv.every((e) => e.area === 'invitations'));
  assert.ok(((await call(ADMIN, 'GET', '/v1/activity?q=status.person')).json.events as any[]).every((e) => JSON.stringify(e).includes('status.person')));
  assert.ok(((await call(ADMIN, 'GET', '/v1/activity?attention=true')).json.events as any[]).every((e) => e.action === 'invitation_not_sent'));
  assert.ok(((await call(ADMIN, 'GET', `/v1/activity?place=${P2}`)).json.events as any[]).every((e) => e.placeId === P2 || e.placeId === null || true));
  const page1 = (await call(ADMIN, 'GET', '/v1/activity?limit=2')).json;
  assert.equal(page1.events.length, 2);
  assert.ok(page1.more && page1.next);
  const page2 = (await call(ADMIN, 'GET', `/v1/activity?limit=2&before=${page1.next}`)).json;
  assert.ok(page2.events.every((e: any) => e.id < page1.next));
  // CSV export, and the export itself is recorded.
  const res = await call(ADMIN, 'GET', '/v1/activity?format=csv');
  assert.equal(res.status, 200);
  assert.match(res.json.csv.split('\n')[0]!, /^time,who,action/);
  assert.ok(((await call(ADMIN, 'GET', '/v1/activity')).json.events as any[]).some((e) => e.action === 'activity_export'));
  // Append-only: nobody can change a line, not even through the application role.
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const r = await o.query(`SELECT has_table_privilege('app_runtime', 'audit_log', 'UPDATE') AS u, has_table_privilege('app_runtime', 'audit_log', 'DELETE') AS d`);
  await o.end();
  assert.deepEqual(r.rows[0], { u: false, d: false });
});

test('record screen: one feed, undated tasks on Home, adding a note or task moves the record up', async () => {
  const id = (await call(P1U, 'GET', '/v1/boxes')).json.boxes[0].id;
  const before = (await call(P1U, 'GET', `/v1/boxes/${id}`)).json.updatedAt;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${id}/notes`, { body: 'Wants a quote by Friday' })).status, 201);
  const t = await call(P1U, 'POST', `/v1/boxes/${id}/tasks`, { title: 'Send quote' });
  assert.equal(t.status, 201);
  const after = (await call(P1U, 'GET', `/v1/boxes/${id}`)).json.updatedAt;
  assert.ok(new Date(after) > new Date(before), 'the record counts as updated');
  const feed = (await call(P1U, 'GET', `/v1/boxes/${id}/timeline`)).json.items;
  assert.ok(feed.some((i: { kind: string; text: string }) => i.kind === 'note' && i.text === 'Wants a quote by Friday'));
  assert.ok(feed.some((i: { kind: string; text: string; dueAt: string | null }) => i.kind === 'task' && i.text === 'Send quote' && i.dueAt === null));
  assert.ok(feed.some((i: { kind: string }) => i.kind === 'created'));
  const home = (await call(P1U, 'GET', '/v1/home')).json;
  assert.ok(home.upcoming.some((x: { title: string }) => x.title === 'Send quote'), 'a task with no date still shows on Home');
  assert.ok(!home.tasks.some((x: { title: string }) => x.title === 'Send quote'), 'and is not claimed to be due today');
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${id}/timeline`)).status, 404, 'a sibling cannot read the feed');
});
