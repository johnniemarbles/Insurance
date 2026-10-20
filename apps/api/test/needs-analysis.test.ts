// Needs analysis audit (20 Oct 2026): structured fact-find, signed-only gates, replacement trigger, template gates that partners cannot
// remove, recommendation linked to the analysis, validity, compliance review sampling, and the reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepComplianceAlerts } from '../src/compliance-alerts.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
let co: { tenantId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function owner<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  try { return (await o.query(sql, params)).rows as T[]; } finally { await o.end(); }
}
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  const u = (await owner(`INSERT INTO app_users (tenant_id,email,display_name,home_node_id,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [tenantId, email, email.split('@')[0], home]))[0].id;
  await owner(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@na.test', PA = 'pa@na.test', PB = 'pb@na.test', COMP = 'comp@na.test', OTHER = 'other@na.test';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
let pipe = '', stages: { id: string; name: string; requiredDocs: string[] }[] = [];
const stageId = (name: string) => stages.find((s) => s.name === name)!.id;

const NEEDS = {
  productLine: 'life_health', maritalStatus: 'married', dependants: 2, occupation: 'Engineer',
  annualIncome: 90000, monthlyExpenses: 4000, liquidAssets: 20000, mortgage: 400000, otherDebts: 10000,
  existingIndividual: 100000, existingGroup: 90000, replacing: false,
  objectives: ['income_replacement', 'debt_payoff'], method: 'capital_needs', incomeYears: 10, finalExpenses: 15000, educationFund: 50000,
  monthlyBudget: 150, licenceDisclosed: true, insurersDisclosed: true, compensationDisclosed: true, conflictsDisclosed: true,
  advisorLicence: 'LLQP-123456', advisorProvince: 'ON', attestation: true,
};
const GAP = 90000 * 10 + 400000 + 10000 + 15000 + 50000 - (100000 + 90000 + 20000);
const REC = { product: 'Term 20', insurer: 'Maple Life', coverageAmount: GAP, monthlyPremium: 120, reasons: 'Lowest premium that covers the gap', alternatives: 'Term 10 and whole life', clientDecision: 'accepted', illustrationDelivered: true, summaryDelivered: true, applicationCopyDelivered: true };

let pbPipe = '';
async function newBox(name: string, who = PA) {
  if (who === PB && !pbPipe) pbPipe = (await call(PB, 'POST', '/v1/pipeline-templates/ca_life_health/use', { name: 'B life clients' })).json.id;
  const r = await call(who, 'POST', '/v1/boxes', { pipelineId: who === PB ? pbPipe : pipe, name });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id as string;
}
async function sign(who: string, id: string) {
  const s = await call(who, 'POST', `/v1/advice/${id}/send-code`);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const c = await call(who, 'POST', `/v1/advice/${id}/confirm`, { code: s.json.devCode });
  assert.equal(c.status, 200, JSON.stringify(c.json));
}
const mkNeeds = (who: string, box: string, answers: object = NEEDS) => call(who, 'POST', `/v1/boxes/${box}/advice`, { kind: 'needs_analysis', title: 'Needs analysis', clientName: 'Rita Client', clientEmail: 'rita@client.test', answers });
const mkRec = (who: string, box: string, linkedAdviceId: string | null, answers: object = REC) => call(who, 'POST', `/v1/boxes/${box}/advice`, { kind: 'recommendation', title: 'Recommendation', clientName: 'Rita Client', clientEmail: 'rita@client.test', answers, ...(linkedAdviceId ? { linkedAdviceId } : {}) });
const consent = (who: string, box: string) => call(who, 'POST', `/v1/boxes/${box}/consents`, { kind: 'collection_use', channel: 'in_person' });
const move = (who: string, box: string, stage: string) => call(who, 'PATCH', `/v1/boxes/${box}`, { stageId: stageId(stage) });
const reviews = async (status = 'pending') => (await call(COMP, 'GET', `/v1/compliance/advice-reviews?status=${status}`)).json.reviews as any[];

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  await bootstrapTenant(db.ownerUrl, { name: 'Birch Insurance', countryCode: 'CA', adminEmail: OTHER });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(OTHER, 'POST', '/v1/consent/first-login');
  const BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  const NA = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner A');
  const NB = await addBrokerFixture(call, db.ownerUrl, BR, 'Partner B');
  await seedUser(co.tenantId, PA, NA, 'partner'); await seedUser(co.tenantId, PB, NB, 'partner'); await seedUser(co.tenantId, COMP, BR, 'compliance');
  // Sampling off and no new-advisor window, so only flags put a file in the queue unless a test says otherwise.
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewSamplePct', { scope: 'tenant', value: 0 })).status, 200);
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewNewAdvisorDays', { scope: 'tenant', value: 0 })).status, 200);
  const t = await call(PA, 'POST', '/v1/pipeline-templates/ca_life_health/use', { name: 'My life clients' });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  pipe = t.json.id;
  stages = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the life template requires consent, a signed needs analysis and a signed recommendation before the application', () => {
  assert.deepEqual([...stages.find((s) => s.name === 'Application submitted')!.requiredDocs].sort(), ['needs_analysis', 'privacy_consent', 'recommendation']);
});

test('a partner cannot remove a paperwork gate by deleting its stage; an administrator can', async () => {
  const copy = (await call(PA, 'POST', `/v1/pipelines/${pipe}/clone`, { name: 'Copy' })).json.id;
  const st = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === copy).stages;
  const gated = st.find((s: any) => s.name === 'Application submitted');
  assert.deepEqual([...gated.requiredDocs].sort(), ['needs_analysis', 'privacy_consent', 'recommendation'], 'copies keep the gate');
  const del = await call(PA, 'DELETE', `/v1/pipelines/${copy}/stages/${gated.id}`);
  assert.equal(del.status, 403);
  assert.equal((await call(PA, 'DELETE', `/v1/pipelines/${copy}/stages/${st.find((s: any) => s.name === 'Underwriting').id}`)).status, 204, 'ungated stages are still the partner’s');
  assert.equal((await call(ADMIN, 'DELETE', `/v1/pipelines/${copy}/stages/${gated.id}`)).status, 204, 'an administrator can');
});

test('a needs analysis cannot go for signature until the fact-find is complete, and the form travels with the record', async () => {
  const box = await newBox('Incomplete client');
  const a = await mkNeeds(PA, box, { ...NEEDS, annualIncome: undefined, licenceDisclosed: false });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const s = await call(PA, 'POST', `/v1/advice/${a.json.id}/send-code`);
  assert.equal(s.status, 409); assert.equal(s.json.code ?? s.json.error?.code, 'advice_incomplete');
  assert.match(JSON.stringify(s.json), /yearly income/); assert.match(JSON.stringify(s.json), /licence and registration/);
  assert.equal((await call(PA, 'POST', `/v1/advice/${a.json.id}/signing-link`)).status, 409, 'the client link is held back too');
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${a.json.id}`, { answers: NEEDS })).status, 204);
  const got = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json;
  const rec = got.advice.find((x: any) => x.id === a.json.id);
  assert.deepEqual(rec.missing, []); assert.equal(rec.calc.gap, GAP); assert.equal(rec.answers.annualIncome, 90000);
  assert.ok(got.form.needs.length >= 8 && got.form.recommendation.length >= 8, 'the screens get the form from the server');
  assert.equal((await call(PA, 'POST', `/v1/boxes/${box}/advice`, { kind: 'needs_analysis', title: 'x', clientName: 'Rita', answers: [] })).status, 400);
});

test('only a signed, current needs analysis opens the gate; a bare upload needs compliance to verify it', async () => {
  const box = await newBox('Gate client');
  await consent(PA, box);
  assert.equal((await move(PA, box, 'Application submitted')).status, 409);
  // An upload typed as a needs analysis is not enough on its own.
  const up = await call(PA, 'POST', `/v1/boxes/${box}/documents`, { name: 'paper-na.pdf', mime: 'application/pdf', dataBase64: PDF, docType: 'needs_analysis' });
  assert.equal(up.status, 201);
  const g = (await call(PA, 'GET', `/v1/boxes/${box}/gates`)).json.gates.find((x: any) => x.stageName === 'Application submitted');
  assert.ok(g.missing.includes('needs_analysis'), 'an unverified upload does not count');
  assert.ok(g.unverified.includes('needs_analysis'), 'and the screen can say why');
  // The uploader cannot verify their own paperwork; a partner cannot verify at all; compliance can, once, with a note.
  assert.equal((await call(PA, 'POST', `/v1/documents/${up.json.id}/verify`, { note: 'Paper fact-find signed in person' })).status, 403);
  assert.equal((await call(COMP, 'POST', `/v1/documents/${up.json.id}/verify`, { note: 'short' })).status, 400);
  assert.equal((await call(COMP, 'POST', `/v1/documents/${up.json.id}/verify`, { note: 'Paper fact-find signed in person, checked complete' })).status, 204);
  assert.equal((await call(COMP, 'POST', `/v1/documents/${up.json.id}/verify`, { note: 'Paper fact-find signed in person, checked complete' })).status, 409);
  await assert.rejects(owner(`UPDATE box_documents SET verified_note = 'changed after the fact' WHERE id = $1`, [up.json.id]), /cannot have its verification/);
  const g2 = (await call(PA, 'GET', `/v1/boxes/${box}/gates`)).json.gates.find((x: any) => x.stageName === 'Application submitted');
  assert.ok(!g2.missing.includes('needs_analysis'));
  assert.deepEqual(g2.missing, ['recommendation']);
});

test('the signed needs analysis and its recommendation open the gate; the recommendation must answer a signed analysis on the same file', async () => {
  const box = await newBox('Full client');
  await consent(PA, box);
  const na = (await mkNeeds(PA, box)).json.id;
  // A recommendation needs a needs analysis on this record to answer.
  assert.equal((await mkRec(PA, box, null)).status, 422);
  const otherBox = await newBox('Someone else');
  const foreign = (await mkNeeds(PA, otherBox)).json.id;
  assert.equal((await mkRec(PA, box, foreign)).status, 422);
  const rec = (await mkRec(PA, box, na)).json.id;
  const early = await call(PA, 'POST', `/v1/advice/${rec}/send-code`);
  assert.equal(early.status, 409); assert.match(JSON.stringify(early.json), /needs analysis must be signed first/i);
  await sign(PA, na);
  const list = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice;
  const signedNa = list.find((x: any) => x.id === na);
  assert.match(signedNa.validUntil, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(signedNa.validUntil).getUTCFullYear(), new Date().getUTCFullYear() + 1, 'twelve months by default');
  await sign(PA, rec);
  assert.equal((await move(PA, box, 'Application submitted')).status, 204);
  // The sealed copy of each is typed paperwork on the record.
  const docs = (await call(PA, 'GET', `/v1/boxes/${box}/documents`)).json.documents.map((d: any) => d.docType);
  assert.ok(docs.includes('needs_analysis') && docs.includes('recommendation'));
  assert.equal((await reviews()).filter((r) => r.boxId === box).length, 0, 'nothing flagged, nothing sampled');
});

test('an expired needs analysis no longer opens the gate, and says so', async () => {
  const box = await newBox('Stale client');
  await consent(PA, box);
  const na = (await mkNeeds(PA, box)).json.id;
  await sign(PA, na);
  const rec = (await mkRec(PA, box, na)).json.id;
  await sign(PA, rec);
  await owner(`SET session_replication_role = replica; UPDATE advice_records SET valid_until = current_date - 1 WHERE id = '${na}'; SET session_replication_role = origin;`);
  const m = await move(PA, box, 'Application submitted');
  assert.equal(m.status, 409);
  assert.match(JSON.stringify(m.json), /expired/i);
});

test('a replacement makes a signed replacement disclosure part of the gate, and flags the file for review', async () => {
  const box = await newBox('Replacing client');
  await consent(PA, box);
  const na = (await mkNeeds(PA, box, { ...NEEDS, replacing: true, replacingNote: 'Replacing an old term policy with lower cover' })).json.id;
  await sign(PA, na);
  const rec = (await mkRec(PA, box, na)).json.id;
  await sign(PA, rec);
  const m = await move(PA, box, 'Application submitted');
  assert.equal(m.status, 409); assert.match(JSON.stringify(m.json), /Replacement disclosure/);
  const g = (await call(PA, 'GET', `/v1/boxes/${box}/gates`)).json.gates.find((x: any) => x.stageName === 'Application submitted');
  assert.ok(g.required.includes('replacement_disclosure'));
  const q = (await reviews()).filter((r) => r.boxId === box);
  assert.ok(q.some((r) => r.reason === 'flagged' && r.flags.includes('replacement')));
  // The disclosure is vendor-tier paperwork; once recorded as signed, the record moves.
  const d = (await call(PA, 'POST', `/v1/boxes/${box}/advice`, { kind: 'replacement_disclosure', title: 'Replacement disclosure', body: 'Comparison given in writing.', clientName: 'Rita Client', clientEmail: 'rita@client.test' })).json.id;
  const up = (await call(PA, 'POST', `/v1/boxes/${box}/documents`, { name: 'replacement-signed.pdf', mime: 'application/pdf', dataBase64: PDF })).json.id;
  assert.equal((await call(PA, 'POST', `/v1/advice/${d}/vendor-signed`, { vendorName: 'DocuSign', vendorRef: 'ENV-9', documentId: up })).status, 200);
  assert.equal((await move(PA, box, 'Application submitted')).status, 204);
});

test('flags on a recommendation: below the need and over budget; the client choosing less needs their acknowledgement', async () => {
  const box = await newBox('Underinsured client');
  const na = (await mkNeeds(PA, box)).json.id;
  await sign(PA, na);
  const r1 = (await mkRec(PA, box, na, { ...REC, coverageAmount: 250000, monthlyPremium: 300, clientDecision: 'accepted_less' })).json.id;
  const s = await call(PA, 'POST', `/v1/advice/${r1}/send-code`);
  assert.equal(s.status, 409); assert.match(JSON.stringify(s.json), /acknowledgement/i);
  assert.equal((await call(PA, 'PATCH', `/v1/advice/${r1}`, { answers: { ...REC, coverageAmount: 250000, monthlyPremium: 300, clientDecision: 'accepted_less', clientAcknowledgement: 'I chose a smaller amount to fit my budget today' } })).status, 204);
  await sign(PA, r1);
  const a = (await call(PA, 'GET', `/v1/boxes/${box}/advice`)).json.advice.find((x: any) => x.id === r1);
  assert.deepEqual([...a.flags].sort(), ['below_need', 'client_chose_less', 'over_budget']);
  const q = (await reviews()).find((r) => r.adviceId === r1);
  assert.ok(q && q.reason === 'flagged');
  assert.equal(a.review.status, 'pending', 'the advisor sees the file is under review');
});

test('a compliance review: only compliance decides, never on their own advice, with findings; a decision is final', async () => {
  const q = (await reviews()).find((r) => r.reason === 'flagged')!;
  assert.equal((await call(PA, 'POST', `/v1/compliance/advice-reviews/${q.id}/decide`, { outcome: 'passed', findings: 'Looks fine to me overall' })).status, 403);
  assert.equal((await call(COMP, 'POST', `/v1/compliance/advice-reviews/${q.id}/decide`, { outcome: 'passed', findings: 'ok' })).status, 400);
  const d = await call(COMP, 'POST', `/v1/compliance/advice-reviews/${q.id}/decide`, { outcome: 'needs_action', findings: 'Budget mismatch not explained; add a note and re-confirm with the client.' });
  assert.equal(d.status, 204);
  assert.equal((await call(COMP, 'POST', `/v1/compliance/advice-reviews/${q.id}/decide`, { outcome: 'passed', findings: 'Changing my mind now' })).status, 409);
  await assert.rejects(owner(`UPDATE advice_reviews SET status = 'passed' WHERE id = $1`, [q.id]), /cannot be changed/);
  await assert.rejects(owner(`SET ROLE app_runtime; DELETE FROM advice_reviews WHERE id = '${q.id}'`), /permission denied/);
  const n = (await call(PA, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'advice_review_decided');
  assert.ok(n.some((x: any) => x.data.outcome === 'needs_action'), 'the advisor is told');
  // An administrator who is also the advisor cannot review their own file.
  const adminPipe = (await call(ADMIN, 'POST', '/v1/pipeline-templates/ca_life_health/use', { name: 'Head office life' })).json.id;
  const ab = await call(ADMIN, 'POST', '/v1/boxes', { pipelineId: adminPipe, name: 'Admin sells too' });
  assert.equal(ab.status, 201, JSON.stringify(ab.json));
  const box = ab.json.id;
  const na = (await mkNeeds(ADMIN, box, { ...NEEDS, replacing: true, replacingNote: 'Replacing older policy' })).json.id;
  await sign(ADMIN, na);
  const own = (await call(ADMIN, 'GET', '/v1/compliance/advice-reviews?status=pending')).json.reviews.find((r: any) => r.adviceId === na);
  assert.equal((await call(ADMIN, 'POST', `/v1/compliance/advice-reviews/${own.id}/decide`, { outcome: 'passed', findings: 'Reviewing my own file' })).status, 403);
});

test('sampling: new advisors are always reviewed, then a share at random; compliance can ask for a review of any signed file', async () => {
  await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewNewAdvisorDays', { scope: 'tenant', value: 90 });
  const box = await newBox('New advisor client', PB);
  const na = (await mkNeeds(PB, box)).json.id;
  await sign(PB, na);
  assert.ok((await reviews()).some((r) => r.adviceId === na && r.reason === 'new_advisor'));
  await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewNewAdvisorDays', { scope: 'tenant', value: 0 });
  await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewSamplePct', { scope: 'tenant', value: 100 });
  const box2 = await newBox('Sampled client', PB);
  const na2 = (await mkNeeds(PB, box2)).json.id;
  await sign(PB, na2);
  assert.ok((await reviews()).some((r) => r.adviceId === na2 && r.reason === 'random'));
  await call(ADMIN, 'PUT', '/v1/settings/compliance.reviewSamplePct', { scope: 'tenant', value: 0 });
  const box3 = await newBox('Asked client', PB);
  const na3 = (await mkNeeds(PB, box3)).json.id;
  assert.equal((await call(COMP, 'POST', `/v1/advice/${na3}/request-review`)).status, 409, 'only signed advice is reviewed');
  await sign(PB, na3);
  assert.equal((await call(PB, 'POST', `/v1/advice/${na3}/request-review`)).status, 403);
  assert.equal((await call(COMP, 'POST', `/v1/advice/${na3}/request-review`)).status, 201);
  assert.equal((await call(COMP, 'POST', `/v1/advice/${na3}/request-review`)).status, 409, 'one open review at a time');
  assert.ok((await reviews()).some((r) => r.adviceId === na3 && r.reason === 'requested'));
});

test('the summary shows each advisor’s needs-based selling and the gaps, inside the company only', async () => {
  const s = await call(COMP, 'GET', '/v1/compliance/needs-analysis/summary');
  assert.equal(s.status, 200);
  const a = s.json.advisors.find((x: any) => x.email === PA);
  assert.ok(a.needsSigned >= 4 && a.recommendationsSigned >= 3 && a.replacements >= 1 && a.flagged >= 1 && a.reviewsNeedsAction >= 1);
  assert.ok(s.json.reviewsPending >= 1);
  assert.ok(Array.isArray(s.json.pipelinesWithoutGate));
  assert.ok(s.json.expired >= 1, 'the expired analysis is counted');
  assert.equal((await call(PA, 'GET', '/v1/compliance/needs-analysis/summary')).status, 403);
  const other = await call(OTHER, 'GET', '/v1/compliance/needs-analysis/summary');
  assert.equal(other.status, 200); assert.equal(other.json.advisors.length, 0);
  assert.equal((await call(OTHER, 'GET', '/v1/compliance/advice-reviews?status=pending')).json.reviews.length, 0);
});

test('reminders: the advisor before a needs analysis expires, compliance about reviews waiting', async () => {
  const box = await newBox('Review soon client');
  const na = (await mkNeeds(PA, box)).json.id;
  await sign(PA, na);
  await owner(`SET session_replication_role = replica; UPDATE advice_records SET valid_until = current_date + 10 WHERE id = '${na}'; SET session_replication_role = origin;`);
  await sweepComplianceAlerts(deps);
  const mine = (await call(PA, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'needs_review_due');
  assert.ok(mine.some((x: any) => x.data.boxId === box));
  const comp = (await call(COMP, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'advice_reviews_waiting');
  assert.equal(comp.length, 1); assert.ok(comp[0].data.pending >= 1);
  await sweepComplianceAlerts(deps);
  assert.equal((await call(PA, 'GET', '/v1/notifications')).json.notifications.filter((x: any) => x.kind === 'needs_review_due' && x.data.boxId === box).length, 1, 'told once');
});

test('the sealed PDF prints the fact-find, the calculation and the advisor’s licence', async () => {
  const { sealedAdvicePdf } = await import('../src/advice-seal.ts');
  const { answerSections } = await import('../src/needs-analysis.ts');
  const base = { adviceId: 'x', boxId: 'y', kind: 'needs_analysis' as const, title: 'Needs analysis', body: 'Summary', clientName: 'Rita', clientEmail: null, contentHash: 'h', firm: 'Maple', method: 'otp' as const, typedName: null, ip: null, agent: null, signer: 'client' as const };
  const { PDFDocument } = await import('pdf-lib');
  const plain = await PDFDocument.load(await sealedAdvicePdf(base, new Date()));
  const rich = await PDFDocument.load(await sealedAdvicePdf({ ...base, answers: NEEDS, flags: ['replacement'], advisorName: 'Pat Advisor' }, new Date()));
  assert.ok(rich.getPageCount() > plain.getPageCount(), 'the fact-find adds pages');
  const text = answerSections('needs_analysis', NEEDS, ['replacement']).flatMap((s) => [s.title, ...s.rows.flat()]).join('|');
  for (const want of ['Need calculation', `Gap to cover|$${GAP.toLocaleString('en-CA')}`, 'Licence number|LLQP-123456', 'Replaces existing coverage']) assert.ok(text.includes(want), want);
});

test('jumping past the application stage does not skip its paperwork; moving to Lost is never blocked', async () => {
  const box = await newBox('Jumper client');
  const j = await move(PA, box, 'Offer made');
  assert.equal(j.status, 409); assert.match(JSON.stringify(j.json), /required from “Application submitted”/);
  assert.equal((await move(PA, box, 'Lost')).status, 204);
});

test('compliance can waive a replacement disclosure the needs analysis calls for, with a reason', async () => {
  const box = await newBox('Waive replacement client');
  await consent(PA, box);
  const na = (await mkNeeds(PA, box, { ...NEEDS, replacing: true, replacingNote: 'Group cover ending when the client leaves work' })).json.id;
  await sign(PA, na);
  const rec = (await mkRec(PA, box, na)).json.id;
  await sign(PA, rec);
  const w = await call(COMP, 'POST', `/v1/boxes/${box}/gate-overrides`, { stageId: stageId('Application submitted'), docTypes: ['replacement_disclosure'], reason: 'Group cover ends with employment; nothing individual is replaced' });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  assert.equal((await move(PA, box, 'Application submitted')).status, 204);
});
