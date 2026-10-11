/**
 * HTTP-level tenant wall. Complements the SQL isolation suite (tests/isolation)
 * and the branch-scoped checks in api.test.ts / crm.test.ts by proving two
 * companies on the same deployment cannot see each other's CRM data through the API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];

const A = 'admin-a@iso.test';
const B = 'admin-b@iso.test';

type M = 'GET' | 'POST' | 'PATCH' | 'DELETE';
async function call(email: string | null, method: M, url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: email ? { 'x-dev-user-email': email } : {},
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}

let boxA = '';
let contactA = '';
let pipeA = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({
    APP_ENV: 'test',
    REGION: 'ca-qc',
    DATABASE_URL: db.ownerUrl,
    APP_DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true',
  });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool) });

  await bootstrapTenant(db.ownerUrl, { name: 'Company A', countryCode: 'CA', adminEmail: A });
  await bootstrapTenant(db.ownerUrl, { name: 'Company B', countryCode: 'CA', adminEmail: B });

  for (const email of [A, B]) {
    await call(email, 'POST', '/v1/consent/first-login');
  }

  const loc = (await call(A, 'POST', '/v1/org/locations', { name: 'Branch A' })).json.id as string;
  await call(A, 'POST', '/v1/org/partners', { name: 'Partner A', parentId: loc });
  const pipe = await call(A, 'POST', '/v1/pipelines', { name: 'A sales' });
  assert.equal(pipe.status, 201, JSON.stringify(pipe.json));
  pipeA = pipe.json.id;

  let box = await call(A, 'POST', '/v1/boxes', { pipelineId: pipeA, name: 'Secret client A', contextNodeId: loc });
  if (box.status !== 201) {
    box = await call(A, 'POST', '/v1/boxes', { pipelineId: pipeA, name: 'Secret client A' });
  }
  assert.equal(box.status, 201, JSON.stringify(box.json));
  boxA = box.json.id;

  const contact = await call(A, 'POST', '/v1/contacts', { email: 'client-a@example.com', fullName: 'Client A' });
  assert.equal(contact.status, 201, JSON.stringify(contact.json));
  contactA = contact.json.id;
});

after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

test('cross-tenant: each admin only sees their own company on /v1/me', async () => {
  const meA = await call(A, 'GET', '/v1/me');
  const meB = await call(B, 'GET', '/v1/me');
  assert.equal(meA.status, 200);
  assert.equal(meB.status, 200);
  assert.equal(meA.json.tenant.name, 'Company A');
  assert.equal(meB.json.tenant.name, 'Company B');
  assert.notEqual(meA.json.tenant.id, meB.json.tenant.id);
});

test('cross-tenant: B cannot list or open A\u2019s pipelines, boxes or contacts', async () => {
  const pipesB = await call(B, 'GET', '/v1/pipelines');
  assert.equal(pipesB.status, 200);
  assert.equal(pipesB.json.pipelines.filter((p: any) => p.id === pipeA).length, 0);

  const boxesB = await call(B, 'GET', '/v1/boxes');
  assert.equal(boxesB.status, 200);
  assert.equal(boxesB.json.boxes.filter((b: any) => b.id === boxA).length, 0);
  assert.equal((await call(B, 'GET', `/v1/boxes/${boxA}`)).status, 404);
  assert.equal((await call(B, 'PATCH', `/v1/boxes/${boxA}`, { name: 'stolen' })).status, 404);
  assert.equal((await call(B, 'DELETE', `/v1/boxes/${boxA}`)).status, 404);

  const contactsB = await call(B, 'GET', '/v1/contacts');
  assert.equal(contactsB.status, 200);
  assert.equal(contactsB.json.contacts.filter((c: any) => c.id === contactA).length, 0);
  assert.equal((await call(B, 'GET', `/v1/contacts/${contactA}`)).status, 404);
});

test('cross-tenant: B cannot write notes or tasks on A\u2019s box', async () => {
  assert.equal((await call(B, 'POST', `/v1/boxes/${boxA}/notes`, { body: 'peek' })).status, 404);
  assert.equal((await call(B, 'POST', `/v1/boxes/${boxA}/tasks`, { title: 'peek' })).status, 404);
});

test('cross-tenant: users and org lists stay inside the company', async () => {
  const usersB = await call(B, 'GET', '/v1/users');
  assert.equal(usersB.status, 200);
  const emails = usersB.json.users.map((u: any) => u.email);
  assert.ok(emails.includes(B));
  assert.ok(!emails.includes(A));

  const nodesB = await call(B, 'GET', '/v1/org/nodes');
  assert.equal(nodesB.status, 200);
  const names = nodesB.json.nodes.map((n: any) => n.name);
  assert.ok(names.includes('Company B'));
  assert.ok(!names.includes('Company A'));
  assert.ok(!names.includes('Branch A'));
});

test('cross-tenant: A still sees its own data', async () => {
  assert.equal((await call(A, 'GET', `/v1/boxes/${boxA}`)).status, 200);
  assert.equal((await call(A, 'GET', `/v1/contacts/${contactA}`)).status, 200);
  assert.ok((await call(A, 'GET', '/v1/pipelines')).json.pipelines.some((p: any) => p.id === pipeA));
});
