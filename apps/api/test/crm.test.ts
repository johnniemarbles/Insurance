import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
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
  s1UserId = await seedUser(S1U, S1, 'member');
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
