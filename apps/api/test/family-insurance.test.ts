// Families, Gate B: people on policies and deals, carrier rules, family totals (each policy once), coverage evidence,
// the fix-up queue, and the privacy wall around policies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
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
  const id = await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
    return u as string;
  });
  await call(email, 'POST', '/v1/consent/first-login');
  return id;
}
const contact = async (email: string, fullName: string) => {
  const r = await call(email, 'POST', '/v1/contacts', { fullName, email: `${fullName.toLowerCase().replace(/\W+/g, '.')}@client.test` });
  assert.equal(r.status, 201, r.raw);
  return r.json.id as string;
};
const policy = (carrier: string, num: string, producer: string, branch: string, jurisdiction: string, premiumCents: number, status = 'active', expiry: string | null = null) =>
  owner(async (c) => (await c.query(
    `INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents,
       modal_premium_cents, premium_frequency, status, effective_date, expiry_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'annual',$10,'2025-01-01',$11) RETURNING id`,
    [tenantId, branch, producer, carrier, num, `Plan ${num}`, jurisdiction, premiumCents, premiumCents, status, expiry])).rows[0].id as string);

const ADMIN = 'admin@ins.test', LOC = 'loc@ins.test', P1U = 'p1@ins.test', P2U = 'p2@ins.test';
let X = '', P1 = '', P2 = '', p1UserId = '';
let raj = '', simran = '', aman = '', uncle = '', p2client = '', fam = '';
let polLife = '', polHealth = '', polLapsed = '', polUncle = '', polForeign = '', polP2 = '', polEmpty = '';
let naSigned = '', naDraft = '', box = '';

before(async () => {
  process.env.FAMILIES_ENABLED = '1';
  process.env.FAMILIES_INSURANCE_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Insurance Test Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(LOC, X, 'manager');
  p1UserId = await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  raj = await contact(P1U, 'Raj Singh');
  simran = await contact(P1U, 'Simran Singh');
  aman = await contact(P1U, 'Aman Singh');
  uncle = await contact(P1U, 'Harjit Singh');
  p2client = await contact(P2U, 'Priya Sharma');
  fam = (await call(P1U, 'POST', '/v1/families', { displayName: 'Singh family', members: [{ contactId: raj, role: 'head' }, { contactId: simran, role: 'spouse_partner' }, { contactId: aman, role: 'child' }] })).json.id;
  polLife = await policy('ia-financial-group', 'L-100', P1, X, 'CA-ON', 120000, 'active', '2027-03-01');
  polHealth = await policy('manulife', 'H-200', P1, X, 'CA-BC', 240000, 'active', '2026-12-15');
  polLapsed = await policy('sun-life', 'S-300', P1, X, 'CA-ON', 50000, 'lapsed');
  polUncle = await policy('canada-life', 'U-400', P1, X, 'CA-ON', 80000);
  polForeign = await policy('ia-financial-group', 'F-500', P1, X, 'GB', 10000);
  polP2 = await policy('ia-financial-group', 'P2-600', P2, X, 'CA-ON', 99000);
  polEmpty = await policy('manulife', 'E-700', P1, X, 'CA-ON', 30000);
  // A deal for Raj with a signed and a draft needs analysis.
  ({ box, naSigned, naDraft } = await owner(async (c) => {
    const pl = (await c.query(`INSERT INTO pipelines (tenant_id, owner_node_id, name) VALUES ($1,$2,'Life') RETURNING id`, [tenantId, P1])).rows[0].id;
    const st = (await c.query(`INSERT INTO stages (tenant_id, pipeline_id, name, position) VALUES ($1,$2,'New',1) RETURNING id`, [tenantId, pl])).rows[0].id;
    const b = (await c.query(`INSERT INTO boxes (tenant_id, pipeline_id, stage_id, owner_node_id, context_node_id, name) VALUES ($1,$2,$3,$4,$5,'Singh life review') RETURNING id`, [tenantId, pl, st, P1, X])).rows[0].id;
    await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [b, raj, tenantId]);
    const na = async (status: string) => (await c.query(
      `INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash)
       VALUES ($1,$2,'needs_analysis',$3,'Needs analysis body','builtin',$4,'Raj Singh',$5,$6,$7,$8) RETURNING id`,
      [tenantId, b, `Needs analysis (${status})`, status, p1UserId, status === 'signed' ? new Date() : null, status === 'signed' ? 'otp' : null, status === 'signed' ? 'h' : null])).rows[0].id;
    return { box: b, naSigned: await na('signed'), naDraft: await na('draft') };
  }));
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

const add = (email: string, pol: string, body: Record<string, unknown>) => call(email, 'POST', `/v1/policies/${pol}/parties`, body);

test('switched off: Gate B routes answer 404; family totals also need FAMILIES_ENABLED', async () => {
  process.env.FAMILIES_INSURANCE_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', `/v1/policies/${polLife}/parties`)).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/families/${fam}/policies`)).status, 404);
  } finally { process.env.FAMILIES_INSURANCE_ENABLED = '1'; }
  process.env.FAMILIES_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', `/v1/families/${fam}/policies`)).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/policies/${polLife}/parties`)).status, 200);
  } finally { process.env.FAMILIES_ENABLED = '1'; }
});

test('policies follow the CRM wall: producer, managers, branch; never a sibling partner', async () => {
  assert.equal((await call(P1U, 'GET', `/v1/policies/${polLife}/parties`)).status, 200);
  assert.equal((await call(P2U, 'GET', `/v1/policies/${polLife}/parties`)).status, 404);
  assert.equal((await call(P2U, 'GET', `/v1/policies/${polLife}/check`)).status, 404);
  assert.deepEqual((await call(P2U, 'GET', '/v1/policies/search?q=L-100')).json.policies, []);
  assert.equal((await call(P1U, 'GET', '/v1/policies/search?q=P2-600')).json.policies.length, 0);
  assert.equal((await call(LOC, 'GET', `/v1/policies/${polLife}/parties`)).status, 200);
  // A branch manager may look but not change who is on the policy.
  assert.equal((await add(LOC, polLife, { contactId: raj, role: 'owner' })).status, 403);
  // Nobody can put a client they cannot see on a policy, or reach a policy they cannot see.
  assert.equal((await add(P1U, polLife, { contactId: p2client, role: 'owner' })).status, 404);
  assert.equal((await add(P1U, polP2, { contactId: raj, role: 'owner' })).status, 404);
});

test('people on a policy: input rules, drafts allowed, submission check per beneficiary group', async () => {
  assert.equal((await add(P1U, polLife, { outsideName: 'Someone', role: 'owner' })).status, 422);
  assert.equal((await add(P1U, polLife, { contactId: simran, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage' })).status, 422);
  assert.equal((await add(P1U, polLife, { contactId: simran, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'estate' })).status, 422);
  assert.equal((await add(P1U, polLife, { contactId: raj, role: 'owner', sharePercent: 10 })).status, 422);
  // A beneficiary's insured life must be insured on the policy (held by the database).
  assert.equal((await add(P1U, polLife, { contactId: simran, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 100, insuredContactId: aman })).status, 422);
  assert.equal((await add(P1U, polLife, { contactId: raj, role: 'owner' })).status, 201);
  assert.equal((await add(P1U, polLife, { contactId: raj, role: 'owner' })).status, 409);
  assert.equal((await add(P1U, polLife, { contactId: raj, role: 'insured' })).status, 201);
  // A draft that does not add up yet is saved; the check says what is wrong.
  const draft = await add(P1U, polLife, { contactId: simran, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 60 });
  assert.equal(draft.status, 201, draft.raw);
  assert.equal(draft.json.check.ready, false);
  assert.deepEqual(draft.json.check.errors.map((e: any) => e.code), ['shares_total']);
  const kid = await add(P1U, polLife, { contactId: aman, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 40, relationshipToInsured: 'Son' });
  assert.equal(kid.json.check.ready, true, JSON.stringify(kid.json.check));
  const estate = await add(P1U, polLife, { role: 'beneficiary', beneficiaryClass: 'contingent', allocationMethod: 'estate' });
  assert.equal(estate.status, 201, estate.raw);
  const view = await call(P1U, 'GET', `/v1/policies/${polLife}/parties`);
  assert.equal(view.json.parties.length, 5);
  assert.equal(view.json.check.ready, true);
  assert.ok(view.json.check.warnings.some((w: any) => w.code === 'rules_unconfirmed'));
  assert.equal(view.json.policy.currency, 'CAD');
  // Ending a role keeps it in history.
  const end = await call(P1U, 'POST', `/v1/policies/${polLife}/parties/${estate.json.id}/end`);
  assert.equal(end.status, 200);
  assert.equal((await call(P1U, 'GET', `/v1/policies/${polLife}/parties?history=true`)).json.parties.length, 5);
  assert.equal((await call(P1U, 'GET', `/v1/policies/${polLife}/parties`)).json.parties.length, 4);
});

test('carrier rule profiles: tenant admin only; a refused role is refused when added', async () => {
  const strict = { requiresOwner: true, requiresInsured: true, allowsJointOwner: false, allowsJointInsured: true, allowsEstateBeneficiary: false, allowsOutsideBeneficiary: true, allowsEqualShares: true, allowsTrustee: true, confirmedWithCarrier: true };
  assert.equal((await call(P1U, 'PUT', '/v1/carrier-party-profiles/manulife', strict)).status, 403);
  assert.equal((await call(ADMIN, 'PUT', '/v1/carrier-party-profiles/manulife', strict)).status, 200);
  assert.equal((await call(ADMIN, 'PUT', '/v1/carrier-party-profiles/nope', strict)).status, 404);
  assert.equal((await add(P1U, polHealth, { contactId: simran, role: 'joint_owner' })).status, 422);
  assert.equal((await add(P1U, polHealth, { role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'estate' })).status, 422);
  for (const [who, role] of [[raj, 'owner'], [raj, 'payor'], [raj, 'insured'], [simran, 'joint_insured']] as const) {
    assert.equal((await add(P1U, polHealth, { contactId: who, role })).status, 201);
  }
  const prof = await call(P1U, 'GET', `/v1/policies/${polHealth}/parties`);
  assert.equal(prof.json.profile.source, 'carrier');
  assert.ok(!prof.json.check.warnings.some((w: any) => w.code === 'rules_unconfirmed'));
  // Two insured lives: a beneficiary must say whose life it is named on.
  await add(P1U, polHealth, { contactId: aman, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 100 });
  assert.ok((await call(P1U, 'GET', `/v1/policies/${polHealth}/check`)).json.errors.some((e: any) => e.code === 'whose_life'));
});

test('family policies: each policy once, per currency; lapsed and beneficiary-only listed apart; partial data said plainly', async () => {
  await add(P1U, polLapsed, { contactId: simran, role: 'owner' });
  await add(P1U, polLapsed, { contactId: simran, role: 'insured' });
  await add(P1U, polUncle, { contactId: uncle, role: 'owner' });
  await add(P1U, polUncle, { contactId: uncle, role: 'insured' });
  await add(P1U, polUncle, { contactId: aman, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 100 });
  await add(P1U, polForeign, { contactId: raj, role: 'payor' });
  const r = await call(P1U, 'GET', `/v1/families/${fam}/policies`);
  assert.equal(r.status, 200, r.raw);
  // Life (1,200.00) + Health (2,400.00): Health has three family members on it and still counts once.
  assert.deepEqual(r.json.totals, [{ currency: 'CAD', annualPremiumCents: 360000, policies: 2 }]);
  assert.equal(r.json.inForceCount, 3);
  assert.equal(r.json.nextRenewal, '2026-12-15');
  assert.ok(r.json.policies.some((p: any) => p.id === polLapsed && p.status === 'lapsed'));
  assert.deepEqual(r.json.beneficiaryOf.map((p: any) => p.id), [polUncle]);
  // The foreign-currency policy has no owner and an unknown currency: left out of the totals, and the total says so.
  assert.equal(r.json.completeness, 'partial');
  assert.ok(r.json.warnings.some((w: any) => w.code === 'unknown_currency' && w.policyId === polForeign));
  const health = r.json.policies.find((p: any) => p.id === polHealth);
  assert.deepEqual(health.people.find((x: any) => x.contactId === raj).roles.sort(), ['insured', 'owner', 'payor']);
});

test('family policies are as private as the family', async () => {
  assert.equal((await call(P2U, 'GET', `/v1/families/${fam}/policies`)).status, 404);
  assert.equal((await call(LOC, 'GET', `/v1/families/${fam}/policies`)).status, 200);
});

test('coverage: unknown by default; "covered" needs evidence; a gap needs a signed needs analysis', async () => {
  const g = await call(P1U, 'GET', `/v1/families/${fam}/coverage`);
  assert.equal(g.status, 200, g.raw);
  assert.deepEqual(g.json.lines.map((l: any) => l.key), ['life', 'critical_illness', 'disability', 'health_dental', 'travel']);
  assert.ok(g.json.people.every((p: any) => p.cells.every((c: any) => c.state === 'unknown')));
  const set = (who: string, body: Record<string, unknown>) => call(P1U, 'POST', `/v1/people/${who}/coverage`, body);
  assert.equal((await set(raj, { lineKey: 'life', state: 'covered' })).status, 422);
  assert.equal((await set(raj, { lineKey: 'life', state: 'covered', policyId: polLife })).status, 201);
  // Simran is only a beneficiary on the life policy: that is not her coverage.
  assert.equal((await set(simran, { lineKey: 'life', state: 'covered', policyId: polLife })).status, 422);
  assert.equal((await set(simran, { lineKey: 'travel', state: 'covered', outsideCoverage: 'Group plan through her employer' })).status, 201);
  assert.equal((await set(raj, { lineKey: 'disability', state: 'potential_gap' })).status, 422);
  assert.equal((await set(raj, { lineKey: 'disability', state: 'potential_gap', needsAnalysisId: naDraft })).status, 422);
  assert.equal((await set(raj, { lineKey: 'disability', state: 'potential_gap', needsAnalysisId: naSigned, reviewDueOn: '2027-01-15', note: 'Discussed at review' })).status, 201);
  assert.equal((await set(raj, { lineKey: 'unknown_line', state: 'declined' })).status, 422);
  assert.equal((await call(P2U, 'POST', `/v1/people/${raj}/coverage`, { lineKey: 'life', state: 'declined' })).status, 404);
  // A newer assessment replaces the old one on the grid; the old one is kept.
  assert.equal((await set(raj, { lineKey: 'life', state: 'declined', note: 'Client declined more cover' })).status, 201);
  const after = (await call(P1U, 'GET', `/v1/families/${fam}/coverage`)).json;
  const rajRow = after.people.find((p: any) => p.contactId === raj);
  assert.equal(rajRow.cells.find((c: any) => c.lineKey === 'life').state, 'declined');
  const gap = rajRow.cells.find((c: any) => c.lineKey === 'disability');
  assert.equal(gap.state, 'potential_gap');
  assert.equal(gap.evidence.kind, 'needs_analysis');
  assert.equal(await owner(async (c) => (await c.query('SELECT count(*)::int AS n FROM coverage_assessments WHERE contact_id = $1', [raj])).rows[0].n), 3);
  // Notes can describe health: the audit log keeps the state and the kind of evidence only.
  const logs = await owner(async (c) => (await c.query(`SELECT detail FROM audit_log WHERE action = 'coverage_assessed'`)).rows);
  assert.ok(logs.every((l: any) => !JSON.stringify(l.detail).includes('employer') && !JSON.stringify(l.detail).includes('Discussed')));
  const ev = await call(P1U, 'GET', `/v1/people/${raj}/coverage-evidence`);
  assert.deepEqual(ev.json.analyses.map((a: any) => a.id), [naSigned]);
  assert.ok(ev.json.policies.some((p: any) => p.id === polLife));
});

test('the database refuses a gap without a signed needs analysis, even if the API were skipped', async () => {
  const line = await owner(async (c) => (await c.query(`SELECT id FROM coverage_lines WHERE key = 'life'`)).rows[0].id);
  await assert.rejects(owner((c) => c.query(`INSERT INTO coverage_assessments (tenant_id, contact_id, line_id, state) VALUES ($1,$2,$3,'potential_gap')`, [tenantId, aman, line])));
});

test('fix-up queue: policies missing their owner or insured; people are never guessed', async () => {
  const q = await call(P1U, 'GET', '/v1/policy-parties/missing');
  assert.equal(q.status, 200);
  const empty = q.json.policies.find((p: any) => p.id === polEmpty);
  assert.deepEqual(empty.missing, ['owner', 'insured']);
  assert.ok(!q.json.policies.some((p: any) => p.id === polLife));
  assert.ok(!q.json.policies.some((p: any) => p.id === polLapsed), 'ended policies are not in the queue');
  assert.ok(!q.json.policies.some((p: any) => p.id === polP2), 'a sibling partner\'s policy is not listed');
  assert.equal(await owner(async (c) => (await c.query('SELECT count(*)::int AS n FROM policy_parties WHERE policy_id = $1', [polEmpty])).rows[0].n), 0);
});

test('people on a deal by role, inside the partner wall', async () => {
  const a = await call(P1U, 'POST', `/v1/boxes/${box}/parties`, { contactId: raj, role: 'applicant' });
  assert.equal(a.status, 201, a.raw);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/parties`, { contactId: simran, role: 'co_applicant' })).status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/parties`, { contactId: raj, role: 'applicant' })).status, 409);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/parties`, { contactId: p2client, role: 'insured' })).status, 404);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${box}/parties`)).status, 404);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}/parties`)).json.parties.length, 2);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box}/parties/${a.json.id}/end`)).status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box}/parties`)).json.parties.length, 1);
  await assert.rejects(owner((c) => c.query(`INSERT INTO deal_parties (tenant_id, box_id, contact_id, role) VALUES ($1,$2,$3,'insured')`, [tenantId, box, p2client])), /same partner as the deal/);
});
