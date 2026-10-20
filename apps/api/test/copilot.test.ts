// Co-pilot: provider choice, partners' own keys (encrypted, never shown), and Ask PII answering only from records
// the asking person can see, with citations that point at real records.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { citedRefs, intents, searchTerms } from '../src/copilot-context.ts';
import { keyLooksRight, type AiProvider } from '../src/ai.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
type Seen = { via: string; system: string; user: string };
const seen: Seen[] = [];
let reply = 'Raj Singh has a life review deal [C1] [C2]. Also [C99].';
const fake = (via: string) => ({ model: `fake-${via}`, complete: async (i: { system: string; user: string }) => { seen.push({ via, ...i }); return reply; } });
const factoryKeys: { provider: AiProvider; key: string }[] = [];

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function seedUser(email: string, home: string, role: string) {
  await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@cp.test', P1U = 'p1@cp.test', P2U = 'p2@cp.test', P1STAFF = 'staff@cp.test';
let X = '', P1 = '', P2 = '', raj = '';
const KEY = 'AIzaSyFAKEfakeFAKEfakeFAKEfake1234';

before(async () => {
  process.env.COPILOT_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'),
    ai: fake('default'), aiProviders: { anthropic: fake('anthropic'), gemini: fake('gemini') },
    aiFactory: (provider, key) => { factoryKeys.push({ provider, key }); return fake(`partner-${provider}`); } });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Copilot Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P1STAFF, P1, 'partner');
  await seedUser(P2U, P2, 'admin');
  raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test' })).json.id;
  await call(P2U, 'POST', '/v1/contacts', { fullName: 'Raj Patel', email: 'rajp@client.test' });
  await owner(async (c) => {
    const pl = (await c.query(`INSERT INTO pipelines (tenant_id, owner_node_id, name) VALUES ($1,$2,'Life') RETURNING id`, [tenantId, P1])).rows[0].id;
    const st = (await c.query(`INSERT INTO stages (tenant_id, pipeline_id, name, position) VALUES ($1,$2,'Quote',1) RETURNING id`, [tenantId, pl])).rows[0].id;
    const b = (await c.query(`INSERT INTO boxes (tenant_id, pipeline_id, stage_id, owner_node_id, context_node_id, name) VALUES ($1,$2,$3,$4,$5,'Singh life review') RETURNING id`, [tenantId, pl, st, P1, X])).rows[0].id;
    await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [b, raj, tenantId]);
  });
  await owner((c) => c.query(`INSERT INTO tenant_ai (tenant_id, enabled, partners_enabled) VALUES ($1, true, false)`, [tenantId]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('pure rules: search words, intents, citations that exist', () => {
  assert.deepEqual(searchTerms('What did we tell Raj Singh about his renewal?'), ['renewal', 'singh', 'raj']);
  assert.deepEqual(intents('Which policies renew next month?'), { renewals: true, tasks: false });
  assert.deepEqual(intents('Mes tâches en retard'), { renewals: false, tasks: true });
  const snips = [{ ref: 'C1', type: 'client' as const, id: 'a', label: 'A', text: '' }, { ref: 'C2', type: 'deal' as const, id: 'b', label: 'B', text: '' }];
  assert.deepEqual(citedRefs('x [C2] y [C1] z [C2] [C7]', snips).map((s) => s.ref), ['C2', 'C1']);
  assert.equal(keyLooksRight('gemini', KEY), true);
  assert.equal(keyLooksRight('anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(keyLooksRight('openai', KEY), false);
  assert.equal(keyLooksRight('anthropic', 'sk-ant- spaces in it here and there'), false);
});

test('switched off: every co-pilot route answers 404', async () => {
  process.env.COPILOT_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', '/v1/copilot/settings')).status, 404);
    assert.equal((await call(P1U, 'POST', '/v1/copilot/ask', { question: 'Raj Singh' })).status, 404);
  } finally { process.env.COPILOT_ENABLED = '1'; }
});

test('provider: only a company admin chooses, and only among keys this server has', async () => {
  assert.equal((await call(P1U, 'PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: false })).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/copilot/settings', { provider: 'openai', allowPartnerKeys: false })).status, 422);
  assert.equal((await call(ADMIN, 'PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: false })).status, 200);
  const s = (await call(P1U, 'GET', '/v1/copilot/settings')).json;
  assert.deepEqual(s.providersAvailable, ['anthropic', 'gemini']);
  assert.deepEqual(s.using, { provider: 'gemini', source: 'pii', model: 'fake-gemini' });
});

test('Ask PII sends only visible records and keeps only real citations', async () => {
  seen.length = 0;
  const r = await call(P1U, 'POST', '/v1/copilot/ask', { question: 'What is happening with Raj?' });
  assert.equal(r.status, 200, r.raw);
  assert.equal(seen.at(-1)!.via, 'gemini');
  const sent = seen.at(-1)!.user;
  assert.match(sent, /\[C1\] Client Raj Singh/);
  assert.match(sent, /Deal "Singh life review"/);
  assert.doesNotMatch(sent, /Raj Patel/); // a sibling partner's client never reaches the AI service
  assert.deepEqual(r.json.citations.map((c: any) => c.ref), ['C1', 'C2']);
  assert.equal(r.json.citations[0].id, raj);
  assert.equal(r.json.keySource, 'pii');
  // Nothing matched: no AI call at all.
  const before = seen.length;
  const none = await call(P1U, 'POST', '/v1/copilot/ask', { question: 'zzzqqq xxyyzz' });
  assert.equal(none.status, 200);
  assert.equal(seen.length, before);
  assert.equal(none.json.citations.length, 0);
  // The log keeps counts, never the question or the answer.
  const log = await owner(async (c) => (await c.query('SELECT * FROM copilot_log ORDER BY created_at')).rows);
  assert.equal(log.length, 2);
  assert.ok(!('question' in log[0]) && !('answer' in log[0]));
  assert.equal(log[0].records_cited, 2);
});

test('partners need the company partner switch; staff of a partner too', async () => {
  assert.equal((await call(P1STAFF, 'POST', '/v1/copilot/ask', { question: 'Raj' })).status, 403);
  await owner((c) => c.query('UPDATE tenant_ai SET partners_enabled = true WHERE tenant_id = $1', [tenantId]));
  assert.equal((await call(P1STAFF, 'POST', '/v1/copilot/ask', { question: 'Raj' })).status, 200);
});

test('partner keys: only when allowed, only by the partner admin, encrypted, last four shown, used, withdrawn', async () => {
  assert.equal((await call(P1U, 'PUT', '/v1/copilot/my-key', { provider: 'gemini', apiKey: KEY })).status, 403); // company has not allowed it
  assert.equal((await call(ADMIN, 'PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: true })).status, 200);
  assert.equal((await call(P1U, 'PUT', '/v1/copilot/my-key', { provider: 'openai', apiKey: KEY })).status, 422); // wrong format for OpenAI
  assert.equal((await call(P1STAFF, 'PUT', '/v1/copilot/my-key', { provider: 'gemini', apiKey: KEY })).status, 403); // not the partner admin
  const set = await call(P1U, 'PUT', '/v1/copilot/my-key', { provider: 'gemini', apiKey: KEY });
  assert.equal(set.status, 200, set.raw);
  assert.deepEqual(set.json, { provider: 'gemini', last4: '1234' });
  const stored = await owner(async (c) => (await c.query('SELECT key_enc FROM ai_partner_keys WHERE revoked_at IS NULL')).rows[0].key_enc as Buffer);
  assert.ok(!stored.toString('latin1').includes('AIza'), 'the key is stored encrypted');
  const s = (await call(P1U, 'GET', '/v1/copilot/settings')).json;
  assert.deepEqual({ ...s.myKey, createdAt: undefined }, { provider: 'gemini', last4: '1234', yours: true, createdAt: undefined });
  assert.ok(!JSON.stringify(s).includes(KEY));
  assert.equal(s.using.source, 'partner');
  // The partner's staff use the partner's key; another partner uses PII's and cannot see the row.
  factoryKeys.length = 0;
  const r = await call(P1STAFF, 'POST', '/v1/copilot/ask', { question: 'Raj Singh' });
  assert.equal(r.json.keySource, 'partner');
  assert.deepEqual(factoryKeys, [{ provider: 'gemini', key: KEY }]);
  assert.equal((await call(P2U, 'GET', '/v1/copilot/settings')).json.using.source, 'pii');
  assert.equal((await call(P2U, 'GET', '/v1/copilot/settings')).json.myKey, null);
  // The company setting off again: partner keys stop being used at once.
  await call(ADMIN, 'PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: false });
  assert.equal((await call(P1U, 'POST', '/v1/copilot/ask', { question: 'Raj Singh' })).json.keySource, 'pii');
  await call(ADMIN, 'PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: true });
  assert.equal((await call(P1U, 'DELETE', '/v1/copilot/my-key')).status, 204);
  assert.equal((await call(P1U, 'POST', '/v1/copilot/ask', { question: 'Raj Singh' })).json.keySource, 'pii');
  assert.equal((await call(P1U, 'DELETE', '/v1/copilot/my-key')).status, 404);
});

test('the existing assistant follows the company provider too', async () => {
  seen.length = 0;
  assert.equal((await call(P1U, 'POST', '/v1/ai/ask', { question: 'How do I add a task?' })).status, 200);
  assert.equal(seen.at(-1)!.via, 'gemini');
});
