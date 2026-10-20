// Co-pilot step 3: meeting notes from an uploaded recording. Consent confirmed first; audio only to a provider that
// takes it; the recording never stored; nothing saved until the partner saves the reviewed notes and tasks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { parseMeeting } from '../src/copilot-docs.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const heard: { via: string; bytes: number; mime: string }[] = [];
const told: string[] = [];
const NOTES = JSON.stringify({ summary: 'Raj renewed his mortgage and wants to review life cover.', followUps: [{ title: 'Send the term 20 quote', dueInDays: 3 }, { title: '' }], needsChanges: ['Mortgage now 480,000'], complianceNotes: ['Consent to record given'] });
const textOnly = (via: string) => ({ model: `fake-${via}`, complete: async (i: { user: string }) => { told.push(i.user); return NOTES; } });
const withEars = (via: string) => ({ ...textOnly(via), transcribe: async (i: { audio: Buffer; mime: string }) => { heard.push({ via, bytes: i.audio.length, mime: i.mime }); return 'Speaker 1: Hello Raj. Speaker 2: I renewed my mortgage last week.'; } });

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
const ADMIN = 'admin@mt.test', P1U = 'p1@mt.test', LOC = 'loc@mt.test';
let X = '', P1 = '', box = '';
const AUDIO = Buffer.from('ID3fake-mp3-bytes-for-the-test').toString('base64');
const upload = (who: string, over: Record<string, unknown> = {}) => call(who, 'POST', '/v1/copilot/meetings', { boxId: box, mime: 'audio/mpeg', dataBase64: AUDIO, consentConfirmed: true, ...over });
const setProvider = (p: string) => owner((c) => c.query('UPDATE tenant_ai SET provider = $2 WHERE tenant_id = $1', [tenantId, p]));

before(async () => {
  process.env.COPILOT_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'),
    ai: textOnly('default'), aiProviders: { anthropic: textOnly('anthropic'), gemini: withEars('gemini') } });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Meetings Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  await seedUser(P1U, P1, 'admin');
  await seedUser(LOC, X, 'manager');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  await owner((c) => c.query(`INSERT INTO tenant_ai (tenant_id, enabled, partners_enabled, provider) VALUES ($1, true, true, 'gemini')`, [tenantId]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the model\'s notes are checked: lists trimmed, empty tasks dropped, prose kept when it is not JSON', () => {
  const n = parseMeeting('```json\n' + NOTES + '\n```');
  assert.equal(n.followUps.length, 1);
  assert.deepEqual(n.followUps[0], { title: 'Send the term 20 quote', dueInDays: 3 });
  assert.deepEqual(n.needsChanges, ['Mortgage now 480,000']);
  assert.deepEqual(parseMeeting('Just a summary'), { summary: 'Just a summary', followUps: [], needsChanges: [], complianceNotes: [] });
  assert.equal(parseMeeting(JSON.stringify({ summary: 'x', followUps: [{ title: 'a', dueInDays: 9999 }] })).followUps[0]!.dueInDays, 365);
});

test('consent first, audio types only, the editor only', async () => {
  assert.match((await upload(P1U, { consentConfirmed: false })).json.error.message, /told the meeting was recorded/);
  assert.equal((await upload(P1U, { mime: 'video/mp4' })).status, 422);
  assert.equal((await upload(LOC)).status, 403);
  assert.equal(heard.length, 0);
});

test('a recording becomes a transcript and notes for review; the audio is not stored and nothing is saved yet', async () => {
  const before1 = await owner(async (c) => (await c.query('SELECT count(*)::int AS n FROM notes')).rows[0].n);
  const r = await upload(P1U);
  assert.equal(r.status, 200, r.raw);
  assert.equal(heard.length, 1);
  assert.deepEqual(heard[0], { via: 'gemini', bytes: Buffer.from(AUDIO, 'base64').length, mime: 'audio/mpeg' });
  assert.match(told.at(-1)!, /<transcript>\nSpeaker 1: Hello Raj/);
  assert.equal(r.json.summary, 'Raj renewed his mortgage and wants to review life cover.');
  assert.equal(r.json.transcribedBy, 'gemini');
  assert.equal(await owner(async (c) => (await c.query('SELECT count(*)::int AS n FROM notes')).rows[0].n), before1);
  const log = await owner(async (c) => (await c.query(`SELECT kind, question_chars FROM copilot_log WHERE kind = 'meeting'`)).rows);
  assert.deepEqual(log, [{ kind: 'meeting', question_chars: 0 }]);
});

test('Anthropic takes no audio: PII\'s Gemini transcribes; with no audio provider at all, it says so', async () => {
  await setProvider('anthropic');
  heard.length = 0;
  const r = await upload(P1U);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.transcribedBy, 'gemini');
  assert.equal(r.json.provider, 'anthropic');
  const app2 = buildApp({ config: loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' }),
    appPool: pools[0]!, authPool: pools[1]!, authenticate: devAuthenticator(pools[1]!), keys: localKeyProvider('0123456789abcdef0123'), ai: textOnly('default'), aiProviders: { anthropic: textOnly('anthropic') } });
  const res = await app2.inject({ method: 'POST', url: '/v1/copilot/meetings', headers: { 'x-dev-user-email': P1U }, payload: { boxId: box, mime: 'audio/mpeg', dataBase64: AUDIO, consentConfirmed: true } });
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error.message, /OpenAI or Google Gemini/);
  await app2.close();
  await setProvider('gemini');
});

test('saving the reviewed notes adds one note and the chosen tasks to the deal', async () => {
  assert.equal((await call(LOC, 'POST', '/v1/copilot/meetings/save', { boxId: box, summary: 'Notes here' })).status, 403);
  const s = await call(P1U, 'POST', '/v1/copilot/meetings/save', { boxId: box, summary: 'Raj wants to review life cover.', transcript: 'Speaker 1: Hello Raj.', tasks: [{ title: 'Send the term 20 quote', dueOn: '2026-10-23' }] });
  assert.equal(s.status, 201, s.raw);
  const note = await owner(async (c) => (await c.query('SELECT body FROM notes WHERE id = $1', [s.json.noteId])).rows[0].body);
  assert.match(note, /^Meeting notes \(from a recording, client consent confirmed; summarised with AI, reviewed by the advisor\):/);
  assert.match(note, /Transcript:\nSpeaker 1: Hello Raj\./);
  const tasks = await owner(async (c) => (await c.query('SELECT title, due_at::date::text AS due FROM tasks WHERE box_id = $1', [box])).rows);
  assert.deepEqual(tasks, [{ title: 'Send the term 20 quote', due: '2026-10-23' }]);
});
