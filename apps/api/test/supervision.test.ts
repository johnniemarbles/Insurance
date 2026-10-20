// Supervision rules and escalation (Phase 2, feature 9): compliance writes rules without code; a rule that applies to a
// deal entering a stage adds paperwork and/or a compliance review; reviews have deadlines and escalate when overdue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { ruleApplies, type Rule } from '../src/supervision.ts';
import { sweepSupervision } from '../src/routes-supervision.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let deps: AppDeps;
let pools: Db[] = [];
let tenantId = '';
const mail: { to: string; subject: string }[] = [];

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
  const id = await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status,display_name) VALUES ($1,$2,$3,'active',$4) RETURNING id`, [tenantId, email, home, email.split('@')[0]])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
    return u as string;
  });
  await call(email, 'POST', '/v1/consent/first-login');
  return id;
}
const ADMIN = 'admin@sv.test', P1U = 'p1@sv.test', P2U = 'p2@sv.test', COMP = 'comp@sv.test', HEAD = 'head@sv.test';
let box = '', small = '', pipe = '', stages: { id: string; name: string }[] = [], ruleId = '', headId = '';
const move = (who: string, b: string, i: number) => call(who, 'PATCH', `/v1/boxes/${b}`, { stageId: stages[i]!.id });

before(async () => {
  process.env.SUPERVISION_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), mailer: { send: async (m: { to: string; subject: string }) => { mail.push(m); } } as never };
  app = buildApp(deps);
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Sup Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const root = await owner(async (c) => (await c.query(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [tenantId])).rows[0].id);
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  headId = await seedUser(HEAD, X, 'compliance');
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }, { name: 'Won', isWon: true }] })).json.id;
  stages = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: { id: string }) => p.id === pipe).stages;
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Big case', valueAmount: 2_000_000 })).json.id;
  small = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Small case', valueAmount: 5000 })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.SUPERVISION_ENABLED; });

test('rule matching: pipeline, stage or any won stage, amounts, product line, province, replacement', () => {
  const base: Rule = { id: 'r', name: 'r', risk: 'high', pipeline_id: null, stage_id: null, min_deal_value: null, min_coverage: null, product_line: null, province: null, replacing_only: false, required_docs: [], review_required: true, review_hours: 48, escalate_to: null };
  const f = { pipelineId: 'p', valueAmount: 1_000_000, coverage: 500_000, productLine: 'life_health', province: 'ON', replacing: false };
  assert.ok(ruleApplies(base, f, { id: 's', isWon: true }));
  assert.ok(!ruleApplies(base, f, { id: 's', isWon: false }), 'no stage named: only won stages');
  assert.ok(ruleApplies({ ...base, pipeline_id: 'p', stage_id: 's' }, f, { id: 's', isWon: false }));
  assert.ok(!ruleApplies({ ...base, min_deal_value: '1000001' }, f, { id: 's', isWon: true }));
  assert.ok(!ruleApplies({ ...base, min_coverage: 1 }, { ...f, coverage: null }, { id: 's', isWon: true }), 'an unknown fact does not match');
  assert.ok(!ruleApplies({ ...base, province: 'BC' }, f, { id: 's', isWon: true }));
  assert.ok(!ruleApplies({ ...base, replacing_only: true }, f, { id: 's', isWon: true }));
});

test('compliance writes rules; partners cannot; switched off it is all 404 and moves are not checked', async () => {
  const body = { name: 'Large cases', risk: 'high', pipelineId: pipe, stageId: stages[1]!.id, minDealValue: 1_000_000, requiredDocs: ['id_record'], reviewRequired: true, reviewHours: 24, escalateTo: headId };
  assert.equal((await call(P1U, 'POST', '/v1/supervision/rules', body)).status, 403);
  assert.equal((await call(COMP, 'POST', '/v1/supervision/rules', { ...body, escalateTo: (await owner(async (c) => (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id)) })).status, 422, 'escalate only to compliance');
  assert.equal((await call(COMP, 'POST', '/v1/supervision/rules', { name: 'Nothing', reviewRequired: false })).status, 422);
  const r = await call(COMP, 'POST', '/v1/supervision/rules', body);
  assert.equal(r.status, 201, r.raw);
  ruleId = r.json.id;
  const list = await call(P1U, 'GET', '/v1/supervision/rules');
  assert.equal(list.json.rules[0].description, 'entering “Submitted”, in Life, deal value at least $1,000,000');
  // Blank conditions sent as null stay blank (not 0).
  const n = await call(COMP, 'POST', '/v1/supervision/rules', { name: 'Nulls', pipelineId: null, stageId: null, minDealValue: null, minCoverage: null, productLine: null, province: null, escalateTo: null, reviewRequired: true });
  assert.equal(n.status, 201, n.raw);
  const nr = (await call(COMP, 'GET', '/v1/supervision/rules')).json.rules.find((r: { id: string }) => r.id === n.json.id);
  assert.deepEqual([nr.minDealValue, nr.minCoverage, nr.province, nr.description], [null, null, null, 'being won']);
  await call(COMP, 'PATCH', `/v1/supervision/rules/${n.json.id}`, { active: false });
  process.env.SUPERVISION_ENABLED = '';
  assert.equal((await call(COMP, 'GET', '/v1/supervision/rules')).status, 404);
  assert.ok((await move(P1U, box, 1)).status < 300, 'switched off: the rule does not block');
  assert.ok((await move(P1U, box, 0)).status < 300);
  process.env.SUPERVISION_ENABLED = '1';
});

test('a rule blocks the move until its paperwork is filed (or waived) and its review is approved', async () => {
  assert.ok((await move(P1U, small, 1)).status < 300, 'a small case is not caught');
  const blocked = await move(P1U, box, 1);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error.message, /Client ID record \(company rule “Large cases”\)/);
  await owner(async (c) => {
    const u = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    await c.query(`INSERT INTO client_id_records (tenant_id, box_id, method, documents_seen, result, verified_on, verifier_id, verifier_name) VALUES ($1,$2,'in_person','{passport}','verified',current_date,$3,'p1')`, [tenantId, box, u]);
  });
  const review = await move(P1U, box, 1);
  assert.equal(review.status, 409);
  assert.match(review.json.error.message, /compliance must review this deal under “Large cases”/);
  const d = await call(P1U, 'GET', `/v1/boxes/${box}/supervision`);
  assert.equal(d.json.rules.length, 1);
  assert.deepEqual(d.json.rules[0].missing, []);
  assert.equal(d.json.rules[0].review, null);
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${box}/supervision/${ruleId}/request`, {})).status, 404);
  const req = await call(P1U, 'POST', `/v1/boxes/${box}/supervision/${ruleId}/request`, { note: 'Client is a physician; financials attached.' });
  assert.equal(req.status, 201, req.raw);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/supervision/${ruleId}/request`, {})).status, 409, 'one pending at a time');
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${small}/supervision/${ruleId}/request`, {})).status, 422, 'the rule does not apply to the small case');
  const notes = await owner(async (c) => (await c.query(`SELECT u.email FROM notifications n JOIN app_users u ON u.id = n.user_id WHERE n.kind = 'compliance_review' AND n.data->>'supervision' = 'requested' ORDER BY 1`)).rows.map((r) => r.email));
  assert.ok(notes.includes('comp@sv.test') && notes.includes('head@sv.test') && notes.includes('admin@sv.test'), String(notes));
  assert.ok(!notes.includes(P1U) && !notes.includes(P2U), 'partners are not told');
});

test('compliance\'s queue, the deadline and escalation, and the decision', async () => {
  const q = await call(COMP, 'GET', '/v1/supervision/queue');
  assert.equal(q.json.pending.length, 1);
  assert.equal(q.json.pending[0].overdue, false);
  assert.equal((await call(P1U, 'GET', '/v1/supervision/queue')).status, 403);
  // Overdue: the sweep tells the named person once, by notification and email.
  await owner((c) => c.query(`UPDATE supervision_reviews SET due_at = now() - interval '1 hour'`));
  assert.equal(await sweepSupervision(deps), 1);
  assert.equal(await sweepSupervision(deps), 0, 'once only');
  const esc = await owner(async (c) => (await c.query(`SELECT user_id FROM notifications WHERE data->>'supervision' = 'overdue'`)).rows.map((r) => r.user_id));
  assert.deepEqual(esc, [headId]);
  assert.match(mail.at(-1)!.subject, /Overdue compliance review: Big case/);
  assert.equal((await call(COMP, 'GET', '/v1/supervision/queue')).json.pending[0].overdue, true);
  // The decision.
  const [p] = (await call(COMP, 'GET', '/v1/supervision/queue')).json.pending;
  assert.equal((await call(COMP, 'POST', `/v1/supervision/reviews/${p.id}/decide`, { decision: 'approved', note: 'short' })).status, 400);
  const ok = await call(COMP, 'POST', `/v1/supervision/reviews/${p.id}/decide`, { decision: 'approved', note: 'Financials support the amount; approved.' });
  assert.equal(ok.status, 200, ok.raw);
  assert.ok((await move(P1U, box, 1)).status < 300, 'now the deal can move');
  await assert.rejects(owner((c) => c.query(`UPDATE supervision_reviews SET status = 'rejected' WHERE id = $1`, [p.id])), /cannot be changed/);
  const told = await owner(async (c) => (await c.query(`SELECT data->>'supervision' AS s FROM notifications n JOIN app_users u ON u.id = n.user_id WHERE u.email = $1 AND n.kind = 'compliance_review'`, [P1U])).rows.map((r) => r.s));
  assert.ok(told.includes('approved'));
});

test('switching a rule off stops it applying', async () => {
  const r2 = await call(COMP, 'POST', '/v1/supervision/rules', { name: 'Every win', reviewRequired: true });
  assert.equal((await move(P1U, small, 2)).status, 409);
  assert.equal((await call(COMP, 'PATCH', `/v1/supervision/rules/${r2.json.id}`, { active: false })).status, 200);
  assert.ok((await move(P1U, small, 2)).status < 300);
});
