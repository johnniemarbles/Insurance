// File review sampling (Phase 3, feature 10): a monthly risk-weighted sample per compliance officer, a checklist PII
// pre-fills, findings with a fix-by date, the advisor's fix, the reviewer's close, late reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { CHECKLIST, drawSample, riskScore } from '../src/file-reviews.ts';
import { sweepFileReviews } from '../src/routes-file-reviews.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let deps: AppDeps;
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
const ADMIN = 'admin@fr.test', P1U = 'p1@fr.test', P2U = 'p2@fr.test', COMP = 'comp@fr.test', COMPY = 'compy@fr.test';
const boxes: string[] = [];
let other = '';
const allYes = () => Object.fromEntries(CHECKLIST.map((c) => [c.key, 'yes']));
const tomorrow = () => new Date(Date.now() + 86_400_000 * 7).toISOString().slice(0, 10);

before(async () => {
  process.env.FILE_REVIEWS_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'FR Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  const Y = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, Y, 'Partner Two');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(COMP, X, 'compliance');
  await seedUser(COMPY, Y, 'compliance');
  const pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).json.id;
  for (let i = 0; i < 6; i++) boxes.push((await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: `Deal ${i}`, valueAmount: i === 0 ? 2_000_000 : 1000 })).json.id);
  other = (await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Toronto deal' })).json.id;
  // Deal 0 also has an open screening hit: it should be first for risk.
  await owner(async (c) => {
    const u = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    await c.query(`UPDATE boxes SET owner_user_id = $1 WHERE id = ANY($2)`, [u, boxes]);
    await c.query(`INSERT INTO screening_results (tenant_id, box_id, list, result, screened_on, reviewer_id, reviewer_name) VALUES ($1,$2,'pep','hit',current_date,$3,'p1')`, [tenantId, boxes[0], u]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.FILE_REVIEWS_ENABLED; });

test('risk score and the draw: up to half for risk, the rest at random', () => {
  const r = riskScore({ replacing: true, amount: 2_000_000, adviceFlags: 2, openHits: 1, cashReports: 0, newAdvisor: false, pastFindings: 0, idVerified: false, privacyConsent: true });
  assert.deepEqual(r.reasons, ['screening_hit', 'replacement', 'large_amount', 'no_id', 'advice_flags']);
  assert.equal(r.score, 90);
  const cands = [{ id: 'a', score: 90 }, { id: 'b', score: 50 }, { id: 'c', score: 10 }, { id: 'd', score: 0 }, { id: 'e', score: 30 }];
  const s = drawSample(cands, 4, () => 0.5);
  assert.deepEqual(s.filter((x) => x.reason === 'risk').map((x) => x.pick.id), ['a', 'b']);
  assert.equal(s.length, 4);
  assert.equal(new Set(s.map((x) => x.pick.id)).size, 4);
  assert.deepEqual(drawSample(cands, 0), []);
});

test('switched off: 404; officers only; each officer samples only deals they can see', async () => {
  process.env.FILE_REVIEWS_ENABLED = '';
  assert.equal((await call(COMP, 'GET', '/v1/file-reviews')).status, 404);
  process.env.FILE_REVIEWS_ENABLED = '1';
  assert.equal((await call(P1U, 'GET', '/v1/file-reviews')).status, 403);
  const d = await call(COMP, 'POST', '/v1/file-reviews/draw');
  assert.equal(d.status, 200, d.raw);
  assert.equal(d.json.added, 5, 'the default sample of 5');
  const l = await call(COMP, 'GET', '/v1/file-reviews');
  assert.equal(l.json.reviews.length, 5);
  assert.ok(!l.json.reviews.some((r: { boxId: string }) => r.boxId === other), 'never a deal outside their branch');
  const top = l.json.reviews.find((r: { boxId: string }) => r.boxId === boxes[0]);
  assert.equal(top.reason, 'risk');
  assert.ok(top.riskReasons.includes('screening_hit'));
  assert.equal((await call(COMP, 'POST', '/v1/file-reviews/draw')).json.added, 0, 'drawn once a month');
  // The sweep draws for the other officer, in their own branch only.
  const s = await sweepFileReviews(deps);
  assert.ok(s.drawn >= 1);
  // (The branch fixtures add an officer per branch too, so either Toronto officer may have drawn it.)
  const byBranch = await owner(async (c) => (await c.query(`SELECT b.name AS deal, n.name AS branch FROM file_reviews f JOIN boxes b ON b.id = f.box_id JOIN app_users u ON u.id = f.reviewer_id JOIN org_nodes n ON n.id = u.home_node_id ORDER BY 1`)).rows);
  assert.deepEqual(byBranch.filter((r) => r.deal === 'Toronto deal').map((r) => r.branch), ['Toronto']);
  assert.ok(byBranch.filter((r) => r.deal !== 'Toronto deal').every((r) => r.branch === 'Surrey'), JSON.stringify(byBranch));
});

test('the checklist is pre-filled; every item must be answered; a "no" means findings with a fix-by date', async () => {
  const [rv] = (await call(COMP, 'GET', '/v1/file-reviews')).json.reviews.filter((r: { boxId: string }) => r.boxId === boxes[0]);
  const d = await call(COMP, 'GET', `/v1/file-reviews/${rv.id}`);
  assert.equal(d.json.suggested.id_on_file, 'no');
  assert.equal(d.json.suggested.screening_clear, 'no');
  assert.equal(d.json.suggested.replacement_disclosure, 'na');
  assert.equal((await call(COMPY, 'POST', `/v1/file-reviews/${rv.id}/decide`, { checklist: allYes(), outcome: 'passed', findings: 'Looks fine to me.' })).status, 404, 'another branch\'s officer cannot see it');
  assert.equal((await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/decide`, { checklist: { id_on_file: 'no' }, outcome: 'findings', findings: 'No ID on file at all.', fixBy: tomorrow() })).status, 422);
  assert.equal((await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/decide`, { checklist: { ...allYes(), id_on_file: 'no' }, outcome: 'passed', findings: 'All good overall.' })).status, 422);
  const ok = await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/decide`, { checklist: { ...allYes(), id_on_file: 'no', screening_clear: 'no' }, outcome: 'findings', findings: 'No ID record and the PEP hit has not been reviewed.', fixBy: tomorrow() });
  assert.equal(ok.status, 200, ok.raw);
  const told = await owner(async (c) => (await c.query(`SELECT u.email FROM notifications n JOIN app_users u ON u.id = n.user_id WHERE n.data->>'fileReview' = 'findings'`)).rows.map((r) => r.email));
  assert.deepEqual(told, [P1U]);
});

test('the advisor fixes, the reviewer closes or reopens; late fixes are reminded once', async () => {
  const [rv] = (await call(P1U, 'GET', `/v1/boxes/${boxes[0]}/file-reviews`)).json.reviews;
  assert.equal(rv.status, 'findings');
  assert.equal((await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/fixed`, { note: 'I fixed it myself.' })).status, 403);
  // Late: the fix-by date passes before the advisor fixes it.
  await owner((c) => c.query(`UPDATE file_reviews SET fix_by = current_date - 1 WHERE id = $1`, [rv.id]));
  const s1 = await sweepFileReviews(deps);
  assert.equal(s1.late, 2, 'advisor and reviewer');
  assert.equal((await sweepFileReviews(deps)).late, 0, 'once only');
  const f = await call(P1U, 'POST', `/v1/file-reviews/${rv.id}/fixed`, { note: 'ID recorded and the PEP hit reviewed by compliance.' });
  assert.equal(f.status, 200, f.raw);
  assert.equal((await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/close`, { action: 'reopen', note: 'short' })).status, 422);
  const re = await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/close`, { action: 'reopen', note: 'The PEP review note is missing.', fixBy: tomorrow() });
  assert.equal(re.json.status, 'findings', re.raw);
  await call(P1U, 'POST', `/v1/file-reviews/${rv.id}/fixed`, { note: 'PEP review note added by compliance.' });
  const c = await call(COMP, 'POST', `/v1/file-reviews/${rv.id}/close`, { action: 'close', note: 'Checked.' });
  assert.equal(c.json.status, 'closed', c.raw);
  await assert.rejects(owner((q) => q.query(`UPDATE file_reviews SET status = 'findings' WHERE id = $1`, [rv.id])), /cannot (move|be changed)/);
});

test('compliance can add a deal by hand, but never their own', async () => {
  const r = await call(COMP, 'POST', `/v1/boxes/${boxes[5]}/file-review`);
  assert.ok([201, 422].includes(r.status), r.raw);
  const mine = (await call(COMP, 'POST', '/v1/boxes', { pipelineId: (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines[0].id, name: 'Officer deal' })).json.id;
  await owner(async (q) => q.query(`UPDATE boxes SET owner_user_id = (SELECT id FROM app_users WHERE email = $1) WHERE id = $2`, [COMP, mine]));
  assert.equal((await call(COMP, 'POST', `/v1/boxes/${mine}/file-review`)).status, 403);
});
