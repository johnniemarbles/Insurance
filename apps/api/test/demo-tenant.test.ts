import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createPool, seedDemoTenant, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
const ADMIN = 'demo.owner@example.com';

async function get(email: string, url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-dev-user-email': email } });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  await seedDemoTenant(db.ownerUrl, { adminEmail: ADMIN });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the demo admin sees every pipeline and all contacts; a branch manager sees only their branch', async () => {
  const admin = await get(ADMIN, '/v1/pipelines');
  assert.equal(admin.status, 200);
  const names = admin.json.pipelines.map((p: any) => p.name);
  assert.ok(names.includes('Travel & Visitor') && names.includes('Super Visa') && names.includes('Life & Health'));

  const adminContacts = await get(ADMIN, '/v1/contacts?limit=200');
  assert.equal(adminContacts.status, 200);
  const manager = await get('aisha.khan@demo.invalid', '/v1/contacts?limit=200');
  assert.equal(manager.status, 200);
  const all = adminContacts.json.contacts.length;
  const mine = manager.json.contacts.length;
  assert.ok(mine > 0 && mine < all, `manager sees ${mine} of ${all}`);

  const mgrPipes = (await get('aisha.khan@demo.invalid', '/v1/pipelines')).json;
  const mgrNames = mgrPipes.pipelines.map((p: any) => p.name);
  assert.ok(mgrNames.includes('Walk-ins (Toronto branch)'), 'Toronto manager sees the Toronto-only pipeline');
  const otherPipes = (await get('wei.chen@demo.invalid', '/v1/pipelines')).json;
  assert.ok(!otherPipes.pipelines.map((p: any) => p.name).includes('Walk-ins (Toronto branch)'), 'Vancouver manager does not');
});

test('a demo inbox email can be linked to a new record, and mail to a shared address suggests its pipeline', async () => {
  const rules = (await get(ADMIN, '/v1/alias-rules')).json.rules;
  assert.ok(rules.some((r: any) => r.alias === 'supervisa@maple-demo.example.com' && r.pipelineName === 'Super Visa'));
  const pipes = (await get(ADMIN, '/v1/pipelines')).json.pipelines;
  const sv = pipes.find((p: any) => p.name === 'Super Visa');
  const post = async (url: string, body: unknown) => { const r = await app.inject({ method: 'POST', url, headers: { 'x-dev-user-email': ADMIN }, payload: body as object }); return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null }; };
  const box = await post('/v1/boxes', { pipelineId: sv.id, stageId: sv.stages[0].id, name: 'Super Visa insurance for my parents' });
  assert.equal(box.status, 201);
  const linked = await post(`/v1/boxes/${box.json.id}/threads`, {
    gmailThreadId: 'demo-inbox-1', subject: 'Super Visa insurance for my parents', acceptedNotice: true,
    messages: [{ gmailMessageId: 'demo-inbox-1-m1a', sentAt: new Date().toISOString(), from: 'anita.verma@example.com', to: [{ email: ADMIN, name: 'Demo Admin' }], body: 'Hello, my parents arrive in December.', attachments: [] }],
  });
  assert.equal(linked.status, 201);
  const found = await get(ADMIN, '/v1/threads/lookup?gmailThreadId=demo-inbox-1');
  assert.equal(found.json.boxes[0].id, box.json.id);
});

test('the demo shows compliance: one partner not cleared, an expiring E&O policy, and a reset does not double it', async () => {
  const check = async () => {
    const c = await get(ADMIN, '/v1/compliance/clearance');
    assert.equal(c.status, 200);
    assert.equal(c.json.notCleared.length, 1);
    assert.deepEqual(c.json.notCleared[0].reasons.sort(), ['licence_expired', 'no_eo', 'not_approved']);
  };
  await check();
  await seedDemoTenant(db.ownerUrl, { adminEmail: ADMIN, reset: true });
  await check();
});
