// Co-pilot step 2: the rulebook (upload by compliance only, passages, answers that quote real passages, no AI call when
// nothing matches, no client records sent), letter drafts (signed records only, the editor only, TO CONFIRM gaps,
// saved as a note only when reviewed), and the audit-ready score (no AI, under the viewer's access).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { cited, documentText, orQuery, splitPassages } from '../src/copilot-docs.ts';
import { addBrokerFixture, officerFor } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenantId = '';
const seen: { system: string; user: string }[] = [];
let reply = 'Replacements need a signed disclosure [R1]. See also [R9].';
const fake = { model: 'fake-gemini', complete: async (i: { system: string; user: string }) => { seen.push(i); return reply; } };

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
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
    return u as string;
  });
  await call(email, 'POST', '/v1/consent/first-login');
  return id;
}
const ADMIN = 'admin@cpt.test', P1U = 'p1@cpt.test', P2U = 'p2@cpt.test', LOC = 'loc@cpt.test';
let COMP = '', X = '', P1 = '', P2 = '', box = '', p2box = '', p1User = '', pipe = '', sBound = '';

const MANUAL = `# Replacement of coverage

Before replacing an existing life policy, the advisor must give the client a signed replacement disclosure and keep it on file.

The disclosure explains new contestability and suicide exclusion periods.

# Anti-money laundering

Verify identity for any single premium over 10,000 dollars, using an approved method.`;

before(async () => {
  process.env.COPILOT_ENABLED = '1';
  process.env.AUDIT_READY_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123'), ai: fake, aiProviders: { gemini: fake } });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Copilot Tools Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  COMP = await officerFor(call, db.ownerUrl, X);
  p1User = await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  await seedUser(LOC, X, 'manager');
  const raj = (await call(P1U, 'POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj@client.test' })).json.id;
  const priya = (await call(P2U, 'POST', '/v1/contacts', { fullName: 'Priya Sharma', email: 'priya@client.test' })).json.id;
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  sBound = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages[1].id;
  assert.equal((await call(COMP, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['needs_analysis', 'id_record'] })).status, 204);
  box = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review' })).json.id;
  p2box = (await call(P2U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Sharma travel' })).json.id;
  await owner(async (c) => {
    await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3), ($4,$5,$3)', [box, raj, tenantId, p2box, priya]);
    await c.query(`UPDATE tenant_ai SET enabled = true, partners_enabled = true, provider = 'gemini' WHERE tenant_id = $1`, [tenantId]);
    await c.query(`INSERT INTO tenant_ai (tenant_id, enabled, partners_enabled, provider) SELECT $1, true, true, 'gemini' WHERE NOT EXISTS (SELECT 1 FROM tenant_ai WHERE tenant_id = $1)`, [tenantId]);
  });
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

const upload = (who: string, title: string, mime: string, data: Buffer | string) =>
  call(who, 'POST', '/v1/copilot/rulebook', { title, mime, fileName: `${title}.x`, dataBase64: Buffer.from(data).toString('base64') });
const signAdvice = (kind: string, title: string, body: string, validUntil: string | null = null) => owner((c) => c.query(
  `INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, valid_until)
   VALUES ($1,$2,$3,$4,$5,'builtin','signed','Raj Singh',$6,now(),'otp','h',$7)`, [tenantId, box, kind, title, body, p1User, validUntil]));

test('pure helpers: passages under headings, Word and PDF text, search, citations', async () => {
  const p = splitPassages(MANUAL);
  assert.deepEqual(p.map((x) => x.heading), ['Replacement of coverage', 'Anti-money laundering']);
  assert.match(p[0]!.body, /contestability/);
  assert.equal(splitPassages('x'.repeat(100) + '. ' + 'y'.repeat(3000), 1800).every((x) => x.body.length <= 1800), true);
  const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Gifts &amp; entertainment</w:t></w:r></w:p><w:p><w:r><w:t>Gifts over $100 need approval.</w:t></w:r></w:p></w:body></w:document>') }));
  const t = await documentText('docx', docx);
  assert.match(t, /^# Gifts & entertainment\nGifts over \$100 need approval\.$/);
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Complaints must be logged within 5 days', { x: 40, y: 700, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
  assert.match(await documentText('pdf', Buffer.from(await pdf.save())), /Complaints must be logged/);
  assert.equal(orQuery(['replacement', 'it', 'policy!']), 'replacement:* | policy:*');
  assert.equal(orQuery([]), null);
  assert.deepEqual(cited('a [R2] b [R1] [R2] [R7]', [{ ref: 'R1' }, { ref: 'R2' }], 'R').map((x) => x.ref), ['R2', 'R1']);
});

test('rulebook: compliance uploads, everyone in the company reads, answers quote real passages', async () => {
  assert.equal((await upload(P1U, 'Compliance manual', 'text/markdown', MANUAL)).status, 403);
  assert.equal((await upload(COMP, 'Spreadsheet', 'application/vnd.ms-excel', 'x')).status, 422);
  const ok = await upload(COMP, 'Compliance manual', 'text/markdown', MANUAL);
  assert.equal(ok.status, 201, ok.raw);
  assert.equal(ok.json.passages, 2);
  assert.equal((await upload(ADMIN, 'Again', 'text/markdown', MANUAL)).status, 422); // the same file twice
  assert.equal((await call(P2U, 'GET', '/v1/copilot/rulebook')).json.documents.length, 1);
  seen.length = 0;
  const a = await call(P1U, 'POST', '/v1/copilot/rulebook/ask', { question: 'What do I need before a replacement?' });
  assert.equal(a.status, 200, a.raw);
  assert.deepEqual(a.json.citations.map((c: any) => [c.ref, c.document, c.section]), [['R1', 'Compliance manual', 'Replacement of coverage']]);
  assert.equal(seen.length, 1);
  assert.match(seen[0]!.user, /\[R1\] Compliance manual › Replacement of coverage/);
  assert.doesNotMatch(seen[0]!.user, /Raj|Singh|raj@client/); // no client records go with a rulebook question
  // Nothing matches: no AI call.
  seen.length = 0;
  const none = await call(P1U, 'POST', '/v1/copilot/rulebook/ask', { question: 'zebra quokka' });
  assert.equal(none.json.passagesSearched, 0);
  assert.equal(seen.length, 0);
  // Retired documents stop answering; only compliance can retire.
  assert.equal((await call(P1U, 'DELETE', `/v1/copilot/rulebook/${ok.json.id}`)).status, 403);
  assert.equal((await call(COMP, 'DELETE', `/v1/copilot/rulebook/${ok.json.id}`)).status, 204);
  assert.equal((await call(P1U, 'POST', '/v1/copilot/rulebook/ask', { question: 'replacement rules' })).json.passagesSearched, 0);
  const log = await owner(async (c) => (await c.query(`SELECT kind, question_chars, records_sent, records_cited FROM copilot_log WHERE kind = 'rulebook' ORDER BY created_at`)).rows);
  assert.equal(log.length, 3);
  assert.deepEqual(log[0], { kind: 'rulebook', question_chars: 36, records_sent: 1, records_cited: 1 });
});

test('letters: drafted from signed, current records only, by the partner who can change the deal', async () => {
  const draft = (who: string, kind: string, b = box) => call(who, 'POST', '/v1/copilot/letters', { boxId: b, kind });
  const miss = await draft(P1U, 'reason_why');
  assert.equal(miss.status, 422);
  assert.match(miss.json.error.message, /needs analysis, recommendation/);
  await signAdvice('needs_analysis', 'Needs analysis 2026', 'Client needs 500,000 term coverage for 20 years to cover the mortgage.');
  await signAdvice('recommendation', 'Recommendation', 'Term 20, 500,000, monthly premium as quoted.');
  await signAdvice('replacement_disclosure', 'Old disclosure', 'Expired text', '2020-01-01');
  reply = 'Dear Raj,\n\nYou asked for coverage for your mortgage [A2]. We recommended Term 20 [A3]. Premium: [TO CONFIRM: monthly premium amount].\n\n{{myName}}';
  seen.length = 0;
  const d = await draft(P1U, 'reason_why');
  assert.equal(d.status, 200, d.raw);
  assert.deepEqual(d.json.sources.map((s: any) => s.type), ['advice', 'advice']);
  assert.deepEqual(d.json.toConfirm, ['monthly premium amount']);
  assert.doesNotMatch(d.json.draft, /\{\{myName\}\}/);
  assert.match(seen[0]!.user, /\[A1\] Deal "Singh life review"/);
  assert.doesNotMatch(seen[0]!.user, /Expired text/);
  assert.match((await draft(P1U, 'replacement_disclosure')).json.error.message, /replacement disclosure/); // expired record does not count
  assert.equal((await draft(P2U, 'follow_up')).status, 404); // a sibling cannot see the deal
  assert.equal((await draft(LOC, 'follow_up')).status, 403); // a manager can see but not change it
  // Saving: never with gaps left in, and only as a note on the deal.
  assert.equal((await call(P1U, 'POST', '/v1/copilot/letters/save', { boxId: box, kind: 'reason_why', body: d.json.draft })).status, 422);
  const s = await call(P1U, 'POST', '/v1/copilot/letters/save', { boxId: box, kind: 'reason_why', body: d.json.draft.replace(/\[TO CONFIRM:[^\]]*\]/, '$42.10 a month') });
  assert.equal(s.status, 201, s.raw);
  const note = await owner(async (c) => (await c.query('SELECT body FROM notes WHERE id = $1', [s.json.noteId])).rows[0].body);
  assert.match(note, /^Reason-why letter \(drafted with AI, reviewed by the advisor\):/);
  const log = await owner(async (c) => (await c.query(`SELECT count(*)::int AS n FROM copilot_log WHERE kind = 'letter'`)).rows[0].n);
  assert.equal(log, 1);
});

test('switched off: rulebook and letters answer 404; the audit-ready score has its own switch', async () => {
  process.env.COPILOT_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', '/v1/copilot/rulebook')).status, 404);
    assert.equal((await call(P1U, 'POST', '/v1/copilot/letters', { boxId: box, kind: 'follow_up' })).status, 404);
    assert.equal((await call(P1U, 'GET', '/v1/audit-ready')).status, 200);
  } finally { process.env.COPILOT_ENABLED = '1'; }
  process.env.AUDIT_READY_ENABLED = '0';
  try { assert.equal((await call(P1U, 'GET', '/v1/audit-ready')).status, 404); } finally { process.env.AUDIT_READY_ENABLED = '1'; }
});

test('audit-ready score: what each open deal still needs, under the viewer\'s access', async () => {
  const r = (await call(P1U, 'GET', '/v1/audit-ready')).json;
  assert.equal(r.deals.length, 1); // P2's deal is not visible
  const d = r.deals[0];
  assert.equal(d.boxId, box);
  assert.equal(d.required, 2);
  assert.equal(d.score, 50); // signed needs analysis on file, ID check missing
  assert.deepEqual(d.missing.map((m: any) => m.type), ['id_record']);
  assert.equal(r.summary.ready, 0);
  const m = (await call(LOC, 'GET', '/v1/audit-ready')).json;
  assert.equal(m.deals.length, 2);
  assert.equal(m.byPartner.length, 2);
  assert.equal(m.deals.find((x: any) => x.boxId === box).canEdit, false);
  assert.equal(m.deals.find((x: any) => x.boxId === p2box).score, 0);
});
