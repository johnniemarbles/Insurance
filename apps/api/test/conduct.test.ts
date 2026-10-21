// Conduct risk flags (Phase 3, feature 11): explainable rules over advice, policies and complaints; flags seen only by
// compliance and only within their branch; a decision quiets a flag until its numbers change; complaints logged on deals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { earlyLapses, premiumToIncome, replacementChurn } from '../src/conduct.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';

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
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status,display_name) VALUES ($1,$2,$3,'active',$4) RETURNING id`, [tenantId, email, home, email.split('@')[0]])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@cf.test', P1U = 'p1@cf.test', P2U = 'p2@cf.test', COMP = 'comp@cf.test', COMPY = 'compy@cf.test';
let P1 = '', X = '', box = '', raj = '';

before(async () => {
  process.env.CONDUCT_FLAGS_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'CF Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const Y = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, Y, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  await seedUser(COMPY, Y, 'compliance');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test' })).json.id;
  await owner(async (c) => {
    const u = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    // Four P1 deals, three of them replacing cover: replacement churn. The first has a premium far above income.
    for (let i = 0; i < 4; i++) {
      const b = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: `Case ${i}` })).json.id;
      if (i === 0) box = b;
      const na = (await c.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, valid_until)
        VALUES ($1,$2,'needs_analysis','NA','b','builtin','signed','c',$3,now(),'otp','h',$4,current_date + 300) RETURNING id`, [tenantId, b, u, { productLine: 'life_health', replacing: i < 3, annualIncome: 40000 }])).rows[0].id;
      await c.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, linked_advice_id)
        VALUES ($1,$2,'recommendation','R','b','builtin','signed','c',$3,now(),'otp','h',$4,$5)`, [tenantId, b, u, { monthlyPremium: i === 0 ? 900 : 100, clientDecision: 'accepted' }, na]);
    }
    // Policies: P1 issued 5 in the last year, 2 lapsed within months; Raj owns 3 of them; P2 has its own.
    const pol = async (node: string, branch: string, n: string, status: string, eff: string, upd: string) => (await c.query(
      `INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents, modal_premium_cents, premium_frequency, status, effective_date, updated_at)
       VALUES ($1,$2,$3,'manulife',$4,'Term 20','BC',120000,10000,'monthly',$5,$6,$7) RETURNING id`, [tenantId, branch, node, n, status, eff, upd])).rows[0].id;
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await pol(P1, X, `P1-${i}`, i < 2 ? 'lapsed' : 'active', '2026-01-15', i < 2 ? '2026-06-01' : '2026-01-15'));
    await pol(P2, Y, 'P2-0', 'lapsed', '2026-01-15', '2026-05-01');
    for (const id of ids.slice(2)) await c.query(`INSERT INTO policy_parties (tenant_id, policy_id, contact_id, role) VALUES ($1,$2,$3,'owner')`, [tenantId, id, raj]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.CONDUCT_FLAGS_ENABLED; });

test('the rules: thresholds and severities, with the numbers behind each flag', () => {
  assert.deepEqual(replacementChurn([{ node: 'n', name: 'A', recs: 4, replacements: 3 }]).map((f) => [f.severity, f.numbers.share]), [['high', 0.75]]);
  assert.deepEqual(replacementChurn([{ node: 'n', name: 'A', recs: 20, replacements: 3 }]), [], '15% is under the threshold');
  assert.deepEqual(earlyLapses([{ node: 'n', name: 'A', issued: 5, early: 2 }]).map((f) => f.severity), ['high']);
  assert.deepEqual(premiumToIncome([{ box: 'b', name: 'B', monthlyPremium: 100, annualIncome: 100000 }]), []);
  const p = premiumToIncome([{ box: 'b', name: 'B', monthlyPremium: 900, annualIncome: 40000 }]);
  assert.equal(p[0]!.fingerprint, 'premium_to_income:annualPremium=10800,income=40000,share=0.27');
});

test('switched off: 404; compliance only, and only within their branch', async () => {
  process.env.CONDUCT_FLAGS_ENABLED = '';
  assert.equal((await call(COMP, 'GET', '/v1/conduct/flags')).status, 404);
  process.env.CONDUCT_FLAGS_ENABLED = '1';
  assert.equal((await call(P1U, 'GET', '/v1/conduct/flags')).status, 403);
  const f = await call(COMP, 'GET', '/v1/conduct/flags');
  assert.equal(f.status, 200, f.raw);
  const codes = f.json.flags.map((x: { code: string; subjectName: string }) => `${x.code}:${x.subjectName}`).sort();
  assert.deepEqual(codes, ['early_lapse:Partner One', 'many_policies:Raj Singh', 'premium_to_income:Case 0', 'replacement_churn:Partner One']);
  const y = await call(COMPY, 'GET', '/v1/conduct/flags');
  assert.ok(!y.json.flags.some((x: { subjectName: string }) => x.subjectName === 'Partner One' || x.subjectName === 'Raj Singh'), 'Toronto sees nothing of Surrey');
});

test('complaints: recorded on the deal, resolved by compliance, and two in a year raise a flag', async () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await call(P2U, 'POST', `/v1/boxes/${box}/complaints`, { receivedOn: today, channel: 'email', category: 'advice', summary: 'Not my deal at all.' })).status, 404);
  const c1 = await call(P1U, 'POST', `/v1/boxes/${box}/complaints`, { receivedOn: today, channel: 'email', category: 'premium', summary: 'Client says the premium was not explained.' });
  assert.equal(c1.status, 201, c1.raw);
  await call(COMP, 'POST', `/v1/boxes/${box}/complaints`, { receivedOn: '2026-01-10', channel: 'regulator', category: 'advice', summary: 'FSRA forwarded a complaint about advice.' });
  assert.equal((await call(P1U, 'POST', `/v1/complaints/${c1.json.id}/resolve`, { outcome: 'I resolved it myself.' })).status, 403);
  const f = await call(COMP, 'GET', '/v1/conduct/flags');
  const codes = f.json.flags.map((x: { code: string }) => x.code);
  assert.ok(codes.includes('complaints'));
  assert.ok(codes.includes('complaint_unresolved'), 'the January complaint is still open after 30 days');
  const r = await call(COMP, 'POST', `/v1/complaints/${c1.json.id}/resolve`, { outcome: 'Premium walked through again; client satisfied.' });
  assert.equal(r.status, 200, r.raw);
  await assert.rejects(owner((q) => q.query(`UPDATE client_complaints SET outcome = 'changed later on' WHERE id = $1`, [c1.json.id])), /resolved complaint/);
});

test('a decision quiets a flag until its numbers change', async () => {
  const f = (await call(COMP, 'GET', '/v1/conduct/flags')).json.flags.find((x: { code: string }) => x.code === 'replacement_churn');
  assert.equal(f.open, true);
  assert.equal((await call(COMP, 'POST', '/v1/conduct/flags/review', { subjectType: f.subjectType, subjectId: f.subjectId, code: f.code, fingerprint: 'replacement_churn:old', decision: 'no_concern', note: 'Reviewed the three cases.' })).status, 422, 'stale numbers are refused');
  const r = await call(COMP, 'POST', '/v1/conduct/flags/review', { subjectType: f.subjectType, subjectId: f.subjectId, code: f.code, fingerprint: f.fingerprint, decision: 'no_concern', note: 'All three replacements had signed disclosures and clear client benefit.' });
  assert.equal(r.status, 201, r.raw);
  const again = (await call(COMP, 'GET', '/v1/conduct/flags')).json.flags.find((x: { code: string }) => x.code === 'replacement_churn');
  assert.equal(again.open, false);
  assert.equal(again.lastReview.decision, 'no_concern');
  // Another replacement on a new deal changes the numbers: open again.
  const pipe = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines[0].id;
  const b = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Case 4' })).json.id;
  await owner(async (c) => {
    const u = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    await c.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers)
      VALUES ($1,$2,'needs_analysis','NA','b','builtin','signed','c',$3,now(),'otp','h','{"replacing": true}')`, [tenantId, b, u]);
  });
  const reopened = (await call(COMP, 'GET', '/v1/conduct/flags')).json.flags.find((x: { code: string }) => x.code === 'replacement_churn');
  assert.equal(reopened.open, true);
  assert.equal(reopened.lastReview.sameNumbers, false);
});
