import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { sweepCompliance } from '../src/routes-compliance.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = []; let deps: AppDeps;
let co: { tenantId: string; rootNodeId: string }; let ho: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null };
}
async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  await owner(async (o) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@co.test', HO = 'compliance@ho.test', HOADMIN = 'hoadmin@ho.test', AG = 'agency@co.test', PR = 'producer@co.test', OTHER = 'other@co.test';
let AGN = '', PRN = '', OTN = '';
const pdf = Buffer.from('%PDF-1.4 test').toString('base64');

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  deps = { config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') };
  app = buildApp(deps);
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  ho = await bootstrapTenant(db.ownerUrl, { name: 'Head Office CA', countryCode: 'CA', adminEmail: HOADMIN, headOffice: true });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(HOADMIN, 'POST', '/v1/consent/first-login');
  const loc = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  AGN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency One', parentId: loc })).json.id;
  OTN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Agency Two', parentId: loc })).json.id;
  PRN = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Producer', parentId: AGN })).json.id;
  await seedUser(co.tenantId, AG, AGN, 'admin'); await seedUser(co.tenantId, PR, PRN, 'partner'); await seedUser(co.tenantId, OTHER, OTN, 'admin');
  await seedUser(ho.tenantId, HO, ho.rootNodeId, 'compliance');
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('the Compliance role exists in head office only', async () => {
  assert.equal((await call(ADMIN, 'POST', '/v1/invitations', { email: 'x@co.test', nodeId: AGN, role: 'compliance' })).status, 422);
  assert.equal((await call(HOADMIN, 'POST', '/v1/invitations', { email: 'y@ho.test', nodeId: ho.rootNodeId, role: 'compliance' })).status, 201);
  assert.equal((await call(HO, 'GET', '/v1/me')).json.isHeadOffice, true);
  assert.equal((await call(AG, 'GET', '/v1/me')).json.isHeadOffice, false);
});

test('a partner builds the file; a producer cannot see the agency file and siblings cannot see each other', async () => {
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, { entityType: 'corporation', legalName: 'Agency One Inc', businessNumber: '123456789', fields: { province: 'ON' } })).status, 204);
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/profile`, { entityType: 'llc', legalName: 'x' })).status, 422, 'an LLC is not a Canadian kind of business');
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/items`, { kind: 'licence', label: 'Ontario life licence', lines: ['life'], expiresOn: '2099-01-01' })).status, 201);
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/items`, { kind: 'eo', label: 'Carrier X', limitAmount: 1000000, expiresOn: '2099-01-01' })).status, 201);
  assert.equal((await call(PR, 'GET', `/v1/compliance/partners/${AGN}`)).status, 404, 'a producer does not see the agency above');
  assert.equal((await call(OTHER, 'GET', `/v1/compliance/partners/${AGN}`)).status, 404, 'a sibling does not see it');
  assert.equal((await call(AG, 'GET', `/v1/compliance/partners/${PRN}`)).status, 200, 'the agency sees its producer');
  const list = (await call(AG, 'GET', '/v1/compliance/partners')).json.partners.map((p: { name: string }) => p.name).sort();
  assert.deepEqual(list, ['Agency One', 'Producer']);
});

test('E&O minimum: the company can raise the country default and the checklist says why a step is open', async () => {
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/compliance.eoMinLimit', { scope: 'tenant', value: 2_000_000 })).status, 200);
  const f = (await call(AG, 'GET', `/v1/compliance/partners/${AGN}`)).json;
  assert.equal(f.eoMin, 2_000_000);
  assert.equal(f.checklist.steps.find((s: { id: string }) => s.id === 'eo').hint, 'limit_low');
  await call(ADMIN, 'PUT', '/v1/settings/compliance.eoMinLimit', { scope: 'tenant', value: 500_000 });
});

test('submit needs a finished file; documents are sniffed, bounded and kept', async () => {
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/submit`)).status, 422);
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/attest`)).status, 204);
  assert.equal((await call(AG, 'PUT', `/v1/compliance/partners/${AGN}/agreement`, { status: 'signed' })).status, 204);
  assert.equal((await call(PR, 'PUT', `/v1/compliance/partners/${PRN}/agreement`, { status: 'signed' })).status, 403, 'a plain partner does not record their own agreement');
  const bad = await call(AG, 'POST', `/v1/compliance/partners/${AGN}/documents`, { kind: 'other', filename: 'x.pdf', dataBase64: Buffer.from('<script>').toString('base64') });
  assert.equal(bad.status, 422);
  const ok = await call(AG, 'POST', `/v1/compliance/partners/${AGN}/documents`, { kind: 'eo_certificate', filename: '../../cert.exe', dataBase64: pdf });
  assert.equal(ok.status, 201);
  const dl = (await call(AG, 'GET', `/v1/compliance/documents/${ok.json.id}`)).json;
  assert.equal(dl.mime, 'application/pdf'); assert.equal(dl.filename, 'cert.pdf'); assert.equal(Buffer.from(dl.dataBase64, 'base64').toString(), '%PDF-1.4 test');
  assert.equal((await call(OTHER, 'GET', `/v1/compliance/documents/${ok.json.id}`)).status, 404);
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/submit`)).status, 204);
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/submit`)).status, 409);
});

test('head office reviews across companies but is closed to everyone else', async () => {
  assert.equal((await call(AG, 'GET', '/v1/ho/partners')).status, 403);
  assert.equal((await call(ADMIN, 'POST', `/v1/ho/partners/${AGN}/review`, { decision: 'approved' })).status, 403);
  const list = (await call(HO, 'GET', '/v1/ho/partners')).json.partners;
  assert.ok(list.some((p: { nodeId: string; company: string }) => p.nodeId === AGN && p.company === 'Maple Insurance'));
  assert.ok(await call(HO, 'GET', '/v1/notifications').then((r) => r.json.notifications.some((n: { kind: string }) => n.kind === 'compliance_review')), 'head office hears about the submission');
  assert.equal((await call(HO, 'POST', `/v1/ho/partners/${AGN}/review`, { decision: 'rejected' })).status, 422, 'a rejection needs a reason');
  { const r = await call(HO, "POST", `/v1/ho/partners/${AGN}/review`, { decision: "approved", note: "ok" }); assert.equal(r.status, 204, JSON.stringify(r.json)); }
  assert.equal((await call(AG, 'GET', `/v1/compliance/partners/${AGN}`)).json.profile.status, 'approved');
  assert.ok((await call(AG, 'GET', '/v1/notifications')).json.notifications.some((n: { kind: string }) => n.kind === 'compliance_review'), 'the partner hears the decision');
  const d = (await call(HO, 'GET', `/v1/ho/partners/${AGN}`)).json;
  const docId = d.documents[0].id;
  assert.equal(Buffer.from((await call(HO, 'GET', `/v1/ho/documents/${docId}`)).json.dataBase64, 'base64').toString(), '%PDF-1.4 test');
  // head office never sees CRM records
  assert.equal((await call(HO, 'GET', '/v1/boxes')).json.boxes.length, 0);
  // and a company admin cannot make their own company head office
  await assert.rejects(owner(async () => { const c = new pg.Client({ connectionString: db.appUrl }); await c.connect(); try { await c.query(`UPDATE tenants SET is_head_office = true`); } finally { await c.end(); } }));
});

test('carrier appointments: only after approval, and head office moves them along', async () => {
  assert.equal((await call(OTHER, 'POST', `/v1/compliance/partners/${OTN}/appointments`, { carrier: 'Carrier X' })).status, 422);
  const r = await call(AG, 'POST', `/v1/compliance/partners/${AGN}/appointments`, { carrier: 'Carrier X' });
  assert.equal(r.status, 201);
  assert.equal((await call(HO, 'PUT', `/v1/ho/appointments/${r.json.id}`, { status: 'appointed' })).status, 204);
  assert.equal((await call(AG, 'GET', `/v1/compliance/partners/${AGN}`)).json.appointments[0].status, 'appointed');
  assert.equal((await call(AG, 'PUT', `/v1/ho/appointments/${r.json.id}`, { status: 'declined' })).status, 403);
});

test('expiry reminders go out at 30, 15 and 0 days, once each', async () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await call(AG, 'POST', `/v1/compliance/partners/${AGN}/items`, { kind: 'licence', label: 'Soon', lines: ['life'], expiresOn: day(20) })).status, 201);
  assert.equal(await sweepCompliance(deps), 1);
  assert.equal(await sweepCompliance(deps), 0, 'a second sweep sends nothing');
  const n = (await call(AG, 'GET', '/v1/notifications')).json.notifications.filter((x: { kind: string }) => x.kind === 'compliance_expiry');
  assert.equal(n.length, 1); assert.equal(n[0].data.threshold, 30);
  assert.ok((await call(HO, 'GET', '/v1/notifications')).json.notifications.some((x: { kind: string }) => x.kind === 'compliance_expiry'));
  assert.equal((await call(HO, 'GET', '/v1/ho/expiring?days=30')).json.items.length, 1);
  { // insights: counts only, head office only
    assert.equal((await call(AG, 'GET', '/v1/ho/insights')).status, 403);
    const r = await call(HO, 'GET', '/v1/ho/insights'); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.funnel.partners >= 3 && r.json.funnel.approved <= r.json.funnel.submitted && r.json.funnel.submitted <= r.json.funnel.partners);
    assert.equal(r.json.expiry.weeks.length, 13);
    assert.equal(typeof r.json.backlog.waiting, 'number');
    assert.equal(r.json.coverage.meets + r.json.coverage.below + r.json.coverage.none, r.json.funnel.partners);
    assert.ok(!JSON.stringify(r.json).includes('Agency'), 'no names, only counts');
  }
  { // jump-to: names only, head office only
    assert.equal((await call(AG, 'GET', '/v1/ho/search?q=ma')).status, 403);
    assert.equal((await call(HO, 'GET', '/v1/ho/search?q=x')).status, 400);
    const r = await call(HO, 'GET', '/v1/ho/search?q=maple'); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.companies.some((c: { name: string }) => c.name === 'Maple Insurance'));
    assert.deepEqual(Object.keys(r.json.companies[0]).sort(), ['id', 'name']);
    assert.equal((await call(HO, 'GET', '/v1/ho/search?q=%25%25')).json.companies.length, 0, 'wildcards are literal');
  }
});

test('head office administrators create companies for their country; nobody else can', async () => {
  assert.equal((await call(AG, 'POST', '/v1/ho/companies', { name: 'Evil Co', adminEmail: 'x@evil.test' })).status, 403);
  assert.equal((await call(HO, 'POST', '/v1/ho/companies', { name: 'Maple West', adminEmail: 'w@maple.test' })).status, 403, 'a Compliance person reviews files but does not create companies');
  const r = await call(HOADMIN, 'POST', '/v1/ho/companies', { name: 'Maple West', adminEmail: 'W@Maple.test' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await call(HOADMIN, 'POST', '/v1/ho/companies', { name: 'Again', adminEmail: 'w@maple.test' })).status, 409);
  const list = (await call(HOADMIN, 'GET', '/v1/ho/companies')).json.companies;
  const c = list.find((x: { name: string }) => x.name === 'Maple West');
  assert.equal(c.adminEmail, 'w@maple.test'); assert.equal(c.adminStatus, 'invited');
  assert.ok(list.some((x: { name: string }) => x.name === 'Maple Insurance'));
  assert.ok(!list.some((x: { name: string }) => x.name === 'Head Office CA'), 'head office is not listed as a company');
  // the new administrator can sign in and sees only their own company
  assert.equal((await call('w@maple.test', 'GET', '/v1/me')).json.tenant.name, 'Maple West');
  await call('w@maple.test', 'POST', '/v1/consent/first-login');
  assert.equal((await call('w@maple.test', 'GET', '/v1/compliance/partners')).json.partners.length, 0);
});
