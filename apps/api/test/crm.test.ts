import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig } from '@pii/platform';
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
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool) });
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
