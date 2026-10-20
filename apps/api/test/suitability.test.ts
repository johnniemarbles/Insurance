// Suitability check before submission (Phase 2, feature 5): PII's rules always run; the AI adds findings only when the
// co-pilot is on, and only findings that cite the records given. The advisor decides or asks compliance; compliance
// clears or returns. A stage that requires "Suitability review" waits for a decided check of the current recommendation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { parseAiFindings, ruleFindings } from '../src/suitability.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const told: string[] = [];
let reply = '';
const ai = { model: 'fake-gemini', complete: async (i: { user: string }) => { told.push(i.user); return reply; } };

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
const ADMIN = 'admin@su.test', P1U = 'p1@su.test', P2U = 'p2@su.test', COMP = 'comp@su.test';
let box = '', pipe = '', stages: { id: string; name: string }[] = [];
const NA = { productLine: 'life_health', annualIncome: 90000, incomeYears: 5, mortgage: 300000, existingIndividual: 0, existingGroup: 50000, liquidAssets: 0, objectives: ['income_replacement', 'education'], monthlyBudget: 150, replacing: false };
const REC = { product: 'Term 20', insurer: 'iA', coverageAmount: 500000, monthlyPremium: 180, reasons: 'Short reason', alternatives: 'Term 10', clientDecision: 'accepted' };

async function signAdvice(na: object, rec: object) {
  return owner(async (c) => {
    const u = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    const n = (await c.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, valid_until)
      VALUES ($1,$2,'needs_analysis','Needs analysis','Raj needs cover for the mortgage and two children''s education.','builtin','signed','Raj Singh',$3,now(),'otp','h',$4,current_date + 300) RETURNING id`, [tenantId, box, u, na])).rows[0].id;
    const r = (await c.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, linked_advice_id)
      VALUES ($1,$2,'recommendation','Recommendation','Term 20 with iA.','builtin','signed','Raj Singh',$3,now(),'otp','h',$4,$5) RETURNING id`, [tenantId, box, u, rec, n])).rows[0].id;
    return { n, r };
  });
}

before(async () => {
  process.env.SUITABILITY_ENABLED = '1';
  process.env.COPILOT_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai, aiProviders: { gemini: ai } });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Suit Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] })).json.id;
  stages = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: { id: string }) => p.id === pipe).stages;
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  await owner((c) => c.query(`INSERT INTO tenant_ai (tenant_id, enabled, partners_enabled, provider) VALUES ($1, true, true, 'gemini')`, [tenantId]));
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.SUITABILITY_ENABLED; delete process.env.COPILOT_ENABLED; });

test('PII\'s rules: cover below need, premium over budget, replacement without disclosure, thin reasons', () => {
  const f = ruleFindings(NA as never, REC as never, { replacementDisclosureSigned: false });
  assert.deepEqual(f.map((x) => `${x.code}:${x.severity}`), ['below_need:gap', 'over_budget:gap', 'thin_reasons:question']);
  assert.match(f[0]!.text, /\$500,000.*\$700,000/);
  const r = ruleFindings({ ...NA, replacing: true } as never, { ...REC, coverageAmount: 900000, monthlyPremium: 100, reasons: 'x'.repeat(60) } as never, { replacementDisclosureSigned: false });
  assert.deepEqual(r.map((x) => x.code), ['replacement_without_disclosure']);
  assert.deepEqual(ruleFindings({ ...NA, replacing: true } as never, { ...REC, coverageAmount: 900000, monthlyPremium: 100, reasons: 'x'.repeat(60) } as never, { replacementDisclosureSigned: true }).map((x) => `${x.code}:${x.severity}`), ['replacement:question']);
});

test('AI findings are kept only when they cite a record that was given', () => {
  const refs = new Set(['N1', 'R1', 'P1']);
  const got = parseAiFindings('```json\n' + JSON.stringify({ findings: [
    { severity: 'gap', text: 'Education is an objective but nothing in the recommendation addresses it.', cites: ['N1', 'R1'] },
    { severity: 'question', text: 'This cites nothing real at all here.', cites: ['Z9'] },
    { severity: 'approve', text: 'Unknown severity becomes a question.', cites: ['P1'] },
  ] }) + '\n```', refs);
  assert.deepEqual(got.map((g) => `${g.severity}:${g.cites.join(',')}`), ['gap:N1,R1', 'question:P1']);
  assert.deepEqual(parseAiFindings('not json', refs), []);
});

test('switched off: 404, and a stage that requires a suitability review does not wait for one', async () => {
  await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${stages[1]!.id}`, { requiredDocs: ['suitability_review'] });
  process.env.SUITABILITY_ENABLED = '';
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}/suitability`)).status, 404);
  assert.ok((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id })).status < 300);
  assert.ok((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[0]!.id })).status < 300);
  process.env.SUITABILITY_ENABLED = '1';
  const blocked = await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error.message, /Suitability review/);
  // Nobody can upload a document typed as a suitability review.
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/documents`, { name: 'x.pdf', mime: 'application/pdf', docType: 'suitability_review', dataBase64: 'JVBERi0x' })).status, 400);
});

test('needs signed, linked advice; only the deal\'s editor runs it; rules plus cited AI findings are kept', async () => {
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/suitability`)).status, 422);
  await signAdvice(NA, REC);
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${box}/suitability`)).status, 404);
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${box}/suitability`)).status, 403);
  reply = JSON.stringify({ findings: [{ severity: 'gap', text: 'Education is an objective but the recommendation does not address it.', cites: ['N1', 'R1'] }, { severity: 'question', text: 'Uncited finding is dropped here.', cites: [] }] });
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/suitability`);
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.status, 'open');
  assert.equal(r.json.aiUsed, true);
  assert.deepEqual(r.json.findings.map((f: { source: string; code: string }) => `${f.source}:${f.code}`), ['rule:below_need', 'rule:over_budget', 'rule:thin_reasons', 'ai:ai']);
  assert.match(told.at(-1)!, /\[N1\] Needs analysis[\s\S]*\[R1\] Recommendation/);
  const log = await owner(async (c) => (await c.query(`SELECT kind, question_chars, records_sent FROM copilot_log WHERE kind = 'suitability'`)).rows);
  assert.deepEqual(log, [{ kind: 'suitability', question_chars: 0, records_sent: 2 }]);
  // Still blocked: the check is open.
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id })).status, 409);
});

test('the advisor proceeds with a reason, unless the company says gaps need compliance', async () => {
  const [chk] = (await call(P1U, 'GET', `/v1/boxes/${box}/suitability`)).json.checks;
  const set = await call(ADMIN, 'PUT', '/v1/settings/compliance.suitabilityGapsNeedCompliance', { scope: 'tenant', value: true });
  assert.ok(set.status < 300, set.raw);
  const gated = (await call(P1U, 'GET', `/v1/boxes/${box}/suitability`)).json.gapsNeedCompliance;
  assert.equal(gated, true);
  const r = await call(P1U, 'POST', `/v1/suitability/${chk.id}/decide`, { action: 'proceed', note: 'Client wants this amount now.' });
  assert.equal(r.status, 409);
  assert.match(r.json.error.message, /compliance/);
  assert.equal((await call(P2U, 'POST', `/v1/suitability/${chk.id}/decide`, { action: 'refer', note: 'Please look at this one.' })).status, 404);
  const ref = await call(P1U, 'POST', `/v1/suitability/${chk.id}/decide`, { action: 'refer', note: 'Client chose a lower amount for now; please check.' });
  assert.equal(ref.status, 200, ref.raw);
  assert.equal(ref.json.status, 'referred');
  const q = await call(COMP, 'GET', '/v1/suitability/queue');
  assert.equal(q.json.referred.length, 1);
  assert.equal((await call(P1U, 'GET', '/v1/suitability/queue')).status, 403);
});

test('compliance clears or returns; a newer recommendation needs a new check', async () => {
  const [chk] = (await call(P1U, 'GET', `/v1/boxes/${box}/suitability`)).json.checks;
  assert.equal((await call(P1U, 'POST', `/v1/suitability/${chk.id}/review`, { action: 'clear', note: 'Clearing my own check.' })).status, 403);
  const c = await call(COMP, 'POST', `/v1/suitability/${chk.id}/review`, { action: 'clear', note: 'Client signed an acknowledgement of the lower amount.' });
  assert.equal(c.status, 200, c.raw);
  assert.ok((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id })).status < 300, 'the gate now passes');
  // A cleared check is final.
  assert.equal((await call(COMP, 'POST', `/v1/suitability/${chk.id}/review`, { action: 'return', note: 'Changed my mind on this.' })).status, 422);
  await assert.rejects(owner((q) => q.query(`UPDATE suitability_checks SET status = 'open' WHERE id = $1`, [chk.id])), /cannot move/);
  // A newer signed recommendation makes the old check stale.
  await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[0]!.id });
  await signAdvice(NA, { ...REC, coverageAmount: 900000, monthlyPremium: 120, reasons: 'Covers the mortgage, five years of income and education as set out in the needs analysis.' });
  const list = await call(P1U, 'GET', `/v1/boxes/${box}/suitability`);
  assert.equal(list.json.checks[0].current, false);
  assert.equal((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id })).status, 409);
  reply = JSON.stringify({ findings: [] });
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/suitability`);
  assert.equal(r.json.status, 'no_gaps', r.raw);
  assert.ok((await call(P1U, 'PATCH', `/v1/boxes/${box}`, { stageId: stages[1]!.id })).status < 300);
});

test('with the co-pilot off, the rules still run and nothing goes to the AI service', async () => {
  process.env.COPILOT_ENABLED = '';
  const before = told.length;
  await signAdvice(NA, REC);
  const r = await call(P1U, 'POST', `/v1/boxes/${box}/suitability`);
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.json.aiUsed, false);
  assert.equal(told.length, before);
  assert.ok(r.json.findings.every((f: { source: string }) => f.source === 'rule'));
  process.env.COPILOT_ENABLED = '1';
});
