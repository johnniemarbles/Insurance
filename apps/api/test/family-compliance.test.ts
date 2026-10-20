// Families, Gate C: the consent ledger and reuse, legal authority with independent verification, ID references and
// rules, capacity rules, life events and reviews, deal gates, and the privacy wall around all of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { WORDING_VERSION } from '@pii/domain';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, officerFor } from './support/broker.ts';

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
const today = () => new Date().toISOString().slice(0, 10);
const yearsAgoPlusDays = (years: number, days = 0) => {
  const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const ADMIN = 'admin@cmp.test', LOC = 'loc@cmp.test', P1U = 'p1@cmp.test', P2U = 'p2@cmp.test', COMP2 = 'comp2@cmp.test';
let COMP = '';
let X = '', P1 = '', P2 = '';
let raj = '', simran = '', aman = '', jas = '', p2client = '', fam = '', box1 = '', box2 = '', pipe = '', sNew = '', sBound = '';

before(async () => {
  process.env.FAMILIES_ENABLED = '1';
  process.env.FAMILIES_INSURANCE_ENABLED = '1';
  process.env.FAMILIES_COMPLIANCE_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Compliance Test Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  COMP = await officerFor(call, db.ownerUrl, X);
  await seedUser(COMP2, X, 'compliance');
  await seedUser(LOC, X, 'manager');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  raj = await contact(P1U, 'Raj Singh');
  simran = await contact(P1U, 'Simran Singh');
  aman = await contact(P1U, 'Aman Singh');
  jas = await contact(P1U, 'Jas Singh');
  p2client = await contact(P2U, 'Priya Sharma');
  for (const [c, dob] of [[raj, '1980-04-02'], [simran, '1982-07-15'], [aman, yearsAgoPlusDays(19, 30)], [jas, yearsAgoPlusDays(12)]] as const) {
    assert.ok((await call(P1U, 'PATCH', `/v1/people/${c}/profile`, { dateOfBirth: dob })).status < 300);
    assert.equal((await call(P1U, 'PATCH', `/v1/people/${c}/residence`, { jurisdiction: 'CA-BC' })).status, 200);
  }
  fam = (await call(P1U, 'POST', '/v1/families', { displayName: 'Singh family', members: [
    { contactId: raj, role: 'head' }, { contactId: simran, role: 'spouse_partner' }, { contactId: aman, role: 'child' }, { contactId: jas, role: 'child' }] })).json.id;
  pipe = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).json.id;
  const st = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === pipe).stages;
  sNew = st[0].id; sBound = st[1].id;
  assert.equal((await call(COMP, 'PATCH', `/v1/pipelines/${pipe}/stages/${sBound}`, { requiredDocs: ['privacy_consent', 'id_record'] })).status, 204);
  box1 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life' })).json.id;
  box2 = (await call(P1U, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh travel' })).json.id;
  await owner(async (c) => {
    for (const b of [box1, box2]) for (const p of [raj, simran]) await c.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [b, p, tenantId]);
  });
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

const consent = (who: string, c: string, body: Record<string, unknown>) =>
  call(who, 'POST', `/v1/people/${c}/consents`, { channel: 'in_person', grantedOn: today(), givenBy: 'self', scope: 'all_dealings', purpose: 'collection_use', ...body });

test('switched off: Gate C routes answer 404, and Gate C also needs FAMILIES_ENABLED', async () => {
  process.env.FAMILIES_COMPLIANCE_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', `/v1/people/${raj}/compliance`)).status, 404);
    assert.equal((await call(ADMIN, 'GET', '/v1/capacity-rules')).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).status, 404);
  } finally { process.env.FAMILIES_COMPLIANCE_ENABLED = '1'; }
  process.env.FAMILIES_ENABLED = '0';
  try { assert.equal((await call(P1U, 'GET', `/v1/people/${raj}/compliance`)).status, 404); } finally { process.env.FAMILIES_ENABLED = '1'; }
});

test('capacity rules: statute ages seeded unconfirmed; only compliance or an admin changes them', async () => {
  const r = (await call(P1U, 'GET', '/v1/capacity-rules')).json;
  const aom = r.rules.filter((x: any) => x.activity === 'age_of_majority');
  assert.equal(aom.length, 13);
  assert.equal(aom.find((x: any) => x.jurisdiction === 'CA-BC').minAge, 19);
  assert.equal(aom.find((x: any) => x.jurisdiction === 'CA-ON').minAge, 18);
  assert.ok(aom.every((x: any) => x.counselConfirmedAt === null));
  assert.equal(r.canChange, false);
  assert.equal((await call(P1U, 'POST', '/v1/capacity-rules', { jurisdiction: 'CA-BC', activity: 'privacy_consent', minAge: 13, effectiveFrom: '2026-01-01', sourceNote: 'test' })).status, 403);
  // A partner's own insert of anything but the statute default is refused by the database as well.
  await assert.rejects(owner(async (c) => {
    const uid = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE app_runtime');
    await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.node_ids', $3, true), set_config('app.can_write', 'true', true)`, [tenantId, uid, `{${P1}}`]);
    await c.query(`INSERT INTO capacity_rules (tenant_id, jurisdiction, activity, min_age, effective_from, source_note, created_by_name) VALUES ($1,'CA-BC','privacy_consent',5,'2026-01-01','x y z','me')`, [tenantId]);
  }), /row-level security/);
  const ok = await call(COMP, 'POST', '/v1/capacity-rules', { jurisdiction: 'CA-BC', activity: 'privacy_consent', minAge: 13, effectiveFrom: '2026-01-01', sourceNote: 'Counsel memo, Oct 2026' });
  assert.equal(ok.status, 201, ok.raw);
  assert.equal((await call(COMP, 'POST', `/v1/capacity-rules/${ok.json.id}/confirm`, { counsel: 'A. Lawyer LLP' })).status, 200);
  assert.equal((await call(COMP, 'POST', `/v1/capacity-rules/${ok.json.id}/confirm`, { counsel: 'Someone else' })).status, 422);
});

test('consent is per person and purpose; someone under the age of majority needs a review note or a guardian', async () => {
  const r = await consent(P1U, raj, {});
  assert.equal(r.status, 201, r.raw);
  const minor = await consent(P1U, jas, {});
  assert.equal(minor.status, 422);
  assert.match(minor.json.error.message, /under 19, the age of majority in CA-BC \(not yet confirmed by counsel\)/);
  assert.equal((await consent(P1U, raj, { capacityReviewedNote: 'Reviewed with the family' })).status, 422); // adults need no note
  assert.equal((await consent(P1U, jas, { capacityReviewedNote: 'Reviewed: 12-year-old cannot consent alone' , purpose: 'marketing' })).status, 201);
  assert.equal((await consent(P1U, raj, { scope: 'deal' })).status, 422); // a deal scope names the deal
  assert.equal((await consent(P1U, raj, { grantedOn: '2999-01-01' })).status, 422);
  const v = (await call(P1U, 'GET', `/v1/people/${raj}/compliance`)).json;
  assert.equal(v.noticeVersion, WORDING_VERSION);
  assert.equal(v.consents.length, 1);
  assert.equal(v.consents[0].noticeVersion, WORDING_VERSION);
  assert.equal(v.capacity.minor, false);
  assert.equal((await call(P1U, 'GET', `/v1/people/${jas}/compliance`)).json.capacity.minor, true);
});

let guardianship = '';
test('legal authority: recorded pending, verified only by someone else in compliance; only then can it be used', async () => {
  const bad = await call(P1U, 'POST', `/v1/people/${raj}/authorities`, { holderContactId: simran, kind: 'guardian_of_minor', purposes: ['collection_use'], startsOn: '2020-01-01', evidenceDescription: 'Birth certificate seen' });
  assert.equal(bad.status, 422); // Raj is an adult
  assert.equal((await call(P1U, 'POST', `/v1/people/${jas}/authorities`, { holderContactId: p2client, kind: 'guardian_of_minor', purposes: ['collection_use'], startsOn: '2020-01-01', evidenceDescription: 'Birth certificate seen' })).status, 404);
  assert.equal((await call(P1U, 'POST', `/v1/people/${jas}/authorities`, { holderName: 'X', holderContactId: raj, kind: 'guardian_of_minor', purposes: ['collection_use'], startsOn: '2020-01-01', evidenceDescription: 'Birth certificate seen' })).status, 400);
  assert.equal((await call(P1U, 'POST', `/v1/people/${jas}/authorities`, { holderContactId: raj, kind: 'guardian_of_minor', purposes: ['collection_use'], startsOn: '2020-01-01', evidenceDescription: 'Court order 2024123456 seen' })).status, 422);
  const a = await call(P1U, 'POST', `/v1/people/${jas}/authorities`, { holderContactId: raj, kind: 'guardian_of_minor', purposes: ['collection_use', 'carrier_sharing'], startsOn: '2020-01-01', evidenceDescription: 'Birth certificate naming Raj as parent, seen in person' });
  assert.equal(a.status, 201, a.raw);
  guardianship = a.json.id;
  // Not verified yet: nobody can consent for Jas under it.
  assert.equal((await consent(P1U, jas, { givenBy: 'authority', authorityId: guardianship })).status, 422);
  // The partner cannot verify; a manager cannot; compliance can, with a note.
  assert.equal((await call(P1U, 'POST', `/v1/authorities/${guardianship}/decide`, { decision: 'verified', note: 'Looks right' })).status, 403);
  assert.equal((await call(LOC, 'POST', `/v1/authorities/${guardianship}/decide`, { decision: 'verified', note: 'Looks right' })).status, 403);
  assert.ok((await call(COMP, 'GET', '/v1/authorities/pending')).json.authorities.some((x: any) => x.id === guardianship));
  assert.equal((await call(P1U, 'GET', '/v1/authorities/pending')).json.authorities.length, 0);
  assert.equal((await call(COMP, 'POST', `/v1/authorities/${guardianship}/decide`, { decision: 'verified', note: 'Birth certificate checked' })).status, 200);
  assert.equal((await call(COMP2, 'POST', `/v1/authorities/${guardianship}/decide`, { decision: 'rejected', note: 'Second opinion' })).status, 422);
  // Under the verified authority, for a purpose it covers, on a date it covers.
  assert.equal((await consent(P1U, jas, { givenBy: 'authority', authorityId: guardianship, purpose: 'electronic_comms' })).status, 422);
  const ok = await consent(P1U, jas, { givenBy: 'authority', authorityId: guardianship });
  assert.equal(ok.status, 201, ok.raw);
  assert.equal((await consent(P1U, jas, { givenBy: 'authority', authorityId: guardianship, capacityReviewedNote: 'not for guardians' })).status, 422);
});

test('the person who records an authority cannot verify it, even in compliance', async () => {
  // COMP2 is compliance at the branch and records one for a client it can see but not change.
  assert.equal((await call(COMP2, 'POST', `/v1/people/${simran}/authorities`, { holderContactId: raj, kind: 'poa_property', purposes: ['policy_changes'], startsOn: '2024-01-01', evidenceDescription: 'Power of attorney seen' })).status, 403);
  const a = await call(P1U, 'POST', `/v1/people/${simran}/authorities`, { holderContactId: raj, kind: 'poa_property', purposes: ['policy_changes'], startsOn: '2024-01-01', evidenceDescription: 'Power of attorney document seen' });
  assert.equal(a.status, 201);
  // Directly in the database, a recorder deciding their own entry is refused too.
  await assert.rejects(owner(async (c) => {
    const uid = (await c.query(`SELECT id FROM app_users WHERE email = $1`, [P1U])).rows[0].id;
    await c.query('BEGIN');
    await c.query(`UPDATE legal_authorities SET status = 'verified', decided_by = $2, decided_by_name = 'me', decided_at = now() WHERE id = $1`, [a.json.id, uid]);
  }), /cannot verify|recorded/);
  assert.equal((await call(ADMIN, 'POST', `/v1/authorities/${a.json.id}/decide`, { decision: 'rejected', note: 'Document was expired' })).status, 200);
  const v = (await call(P1U, 'GET', `/v1/people/${simran}/compliance`)).json;
  assert.equal(v.authorities.about[0].status, 'rejected');
  assert.equal(v.authorities.about[0].inEffect, false);
});

test('reuse across deals: all-dealings consents are offered, one-deal consents are not, and the deal gate counts them', async () => {
  const s = await consent(P1U, simran, { scope: 'deal', boxId: box1 });
  assert.equal(s.status, 201, s.raw);
  const g1 = (await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json;
  const rajRow = g1.people.find((p: any) => p.contactId === raj);
  const cu = rajRow.purposes.find((p: any) => p.purpose === 'collection_use');
  assert.equal(cu.inForce, null);
  assert.equal(cu.candidates.length, 1);
  assert.equal(cu.candidates[0].ok, true);
  assert.equal(g1.people.find((p: any) => p.contactId === simran).purposes.find((p: any) => p.purpose === 'collection_use').inForce.givenBy, 'self');
  // Simran's one-deal consent cannot be used on box2.
  const g2 = (await call(P1U, 'GET', `/v1/boxes/${box2}/person-compliance`)).json;
  const sc = g2.people.find((p: any) => p.contactId === simran).purposes.find((p: any) => p.purpose === 'collection_use').candidates[0];
  assert.equal(sc.ok, false);
  assert.deepEqual(sc.reasons, ['given for another deal only']);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box2}/consent-uses`, { consentId: s.json.id })).status, 422);
  // The privacy gate is not met until every client on the deal is covered.
  const gate = async (b: string) => (await call(P1U, 'GET', `/v1/boxes/${b}/gates`)).json.gates.find((x: any) => x.stageName === 'Bound');
  assert.ok((await gate(box1)).missing.includes('privacy_consent'));
  assert.equal((await call(LOC, 'POST', `/v1/boxes/${box1}/consent-uses`, { consentId: cu.candidates[0].id })).status, 403);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box1}/consent-uses`, { consentId: cu.candidates[0].id })).status, 201);
  assert.ok(!(await gate(box1)).missing.includes('privacy_consent'));
  assert.ok((await gate(box2)).missing.includes('privacy_consent'));
  // An older notice version is never reused.
  // An older notice version is never reused (written the way an earlier release would have stored it).
  const old = await owner(async (c) => {
    const uid = (await c.query('SELECT id FROM app_users WHERE email = $1', [P1U])).rows[0].id;
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id', $1, true)", [uid]);
    const id = (await c.query(
      `INSERT INTO person_consents (tenant_id, owner_node_id, contact_id, purpose, scope, notice_version, channel, granted_on, given_by, recorded_by, recorded_by_name)
       SELECT tenant_id, owner_node_id, id, 'carrier_sharing', 'all_dealings', 'draft-0', 'phone', current_date, 'self', $2, 'P1'
         FROM contacts WHERE id = $1 RETURNING id`, [raj, uid])).rows[0].id as string;
    await c.query('COMMIT');
    return id;
  });
  const g = (await call(P1U, 'GET', `/v1/boxes/${box2}/person-compliance`)).json;
  const c = g.people.find((p: any) => p.contactId === raj).purposes.find((p: any) => p.purpose === 'carrier_sharing').candidates[0];
  assert.equal(c.ok, false);
  assert.match(c.reasons[0], /given under notice draft-0/);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box2}/consent-uses`, { consentId: old })).status, 422);
});

test('withdrawal stops what depended on it: deals get tasks, email stops, a review opens; never twice', async () => {
  const ec = await consent(P1U, raj, { purpose: 'electronic_comms' });
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box2}/consent-uses`, { consentId: ec.json.id })).status, 201);
  const w = await call(P1U, 'POST', `/v1/people/${raj}/consents/${ec.json.id}/withdraw`, { withdrawnOn: today(), channel: 'email', note: 'Asked by email' });
  assert.equal(w.status, 200, w.raw);
  assert.equal(w.json.dealsFlagged, 1);
  assert.equal(w.json.emailStopped, true);
  assert.ok(w.json.reviewId);
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/consents/${ec.json.id}/withdraw`, { withdrawnOn: today(), channel: 'email' })).status, 422);
  const t = await owner(async (c) => (await c.query(`SELECT title FROM tasks WHERE box_id = $1`, [box2])).rows.map((r) => r.title));
  assert.ok(t.some((x: string) => /Consent withdrawn by Raj Singh \(electronic comms\)/.test(x)));
  assert.ok(await owner(async (c) => (await c.query('SELECT email_opt_out_at FROM contacts WHERE id = $1', [raj])).rows[0].email_opt_out_at));
  const reviews = (await call(P1U, 'GET', '/v1/compliance-reviews')).json.reviews;
  assert.ok(reviews.some((r: any) => r.kind === 'consent_withdrawn' && r.contactId === raj && r.items[0].id === box2));
});

test('ending an authority stops consents given under it; a review lists the deals that relied on them', async () => {
  // Jas joins box1 as an insured, so the guardian's consent can be used there.
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box1}/parties`, { contactId: jas, role: 'insured' })).status, 201);
  const g = (await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json;
  const jc = g.people.find((p: any) => p.contactId === jas).purposes.find((p: any) => p.purpose === 'collection_use').candidates[0];
  assert.equal(jc.ok, true);
  assert.equal(jc.authorityHolder, 'Raj Singh');
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box1}/consent-uses`, { consentId: jc.id })).status, 201);
  assert.equal((await call(P2U, 'POST', `/v1/authorities/${guardianship}/end`, { reason: 'revoked' })).status, 404);
  const e = await call(P1U, 'POST', `/v1/authorities/${guardianship}/end`, { reason: 'revoked' });
  assert.equal(e.status, 200, e.raw);
  assert.equal(e.json.dealsAffected, 1);
  const after1 = (await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json;
  assert.equal(after1.people.find((p: any) => p.contactId === jas).purposes.find((p: any) => p.purpose === 'collection_use').inForce, null);
  assert.equal((await call(P1U, 'POST', `/v1/authorities/${guardianship}/end`, { reason: 'revoked' })).status, 422);
});

test('ID references: no numbers, rules set by compliance, current by role, and they count for the deal gate', async () => {
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/id-references`, { method: 'in_person', result: 'verified', checkedOn: today(), note: 'DL 12345678' })).status, 422);
  assert.equal((await call(P1U, 'PUT', '/v1/id-check-rules/applicant', { required: true, validMonths: 24 })).status, 403);
  assert.equal((await call(COMP, 'PUT', '/v1/id-check-rules/applicant', { required: true, validMonths: 24 })).status, 200);
  const before = (await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json.people.find((p: any) => p.contactId === raj).id;
  assert.equal(before.status, 'missing');
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/id-references`, { method: 'in_person', result: 'verified', checkedOn: yearsAgoPlusDays(3), documentsSeen: ['passport'] })).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json.people.find((p: any) => p.contactId === raj).id.status, 'expired');
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/id-references`, { method: 'in_person', result: 'verified', checkedOn: today(), documentsSeen: ['drivers_licence'] })).status, 201);
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json.people.find((p: any) => p.contactId === raj).id.status, 'current');
  const gate = async () => (await call(P1U, 'GET', `/v1/boxes/${box1}/gates`)).json.gates.find((x: any) => x.stageName === 'Bound');
  assert.ok((await gate()).missing.includes('id_record')); // Simran has no check yet
  assert.equal((await call(P1U, 'POST', `/v1/people/${simran}/id-references`, { method: 'dual_process', result: 'verified', checkedOn: today(), documentsSeen: ['credit_file', 'utility_bill'] })).status, 201);
  assert.ok(!(await gate()).missing.includes('id_record'));
  // Append-only: the runtime role can add ID references but never change or remove one.
  for (const sql of ["UPDATE identity_references SET result = 'failed'", 'DELETE FROM identity_references', "UPDATE life_events SET kind = 'other'", "UPDATE person_consents SET purpose = 'marketing'"]) {
    await assert.rejects(owner(async (c) => { await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_runtime'); await c.query(sql); }), /permission denied/, sql);
  }
  // Deal-level paperwork recorded before Gate C is untouched and still listed as it was.
  assert.equal((await call(P1U, 'GET', `/v1/boxes/${box1}/person-compliance`)).json.dealLevelConsents, 0);
});

test('a life event opens one review listing what to look at, and changes nothing else', async () => {
  const before = await owner(async (c) => ({
    members: (await c.query('SELECT count(*)::int AS n FROM family_memberships WHERE family_id = $1 AND ended_at IS NULL', [fam])).rows[0].n,
    parties: (await c.query('SELECT count(*)::int AS n FROM deal_parties WHERE ended_at IS NULL')).rows[0].n,
    auth: (await c.query("SELECT count(*)::int AS n FROM legal_authorities WHERE ended_at IS NULL")).rows[0].n,
    deceased: (await c.query('SELECT deceased_on FROM contacts WHERE id = $1', [raj])).rows[0].deceased_on,
  }));
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/life-events`, { kind: 'death', occurredOn: '2999-01-01' })).status, 422);
  const e = await call(P1U, 'POST', `/v1/people/${raj}/life-events`, { kind: 'death', occurredOn: today(), note: 'Family called' });
  assert.equal(e.status, 201, e.raw);
  const types = new Set(e.json.items.map((i: any) => i.type));
  assert.ok(types.has('family') && types.has('deal'), JSON.stringify(e.json.items));
  const after1 = await owner(async (c) => ({
    members: (await c.query('SELECT count(*)::int AS n FROM family_memberships WHERE family_id = $1 AND ended_at IS NULL', [fam])).rows[0].n,
    parties: (await c.query('SELECT count(*)::int AS n FROM deal_parties WHERE ended_at IS NULL')).rows[0].n,
    auth: (await c.query("SELECT count(*)::int AS n FROM legal_authorities WHERE ended_at IS NULL")).rows[0].n,
    deceased: (await c.query('SELECT deceased_on FROM contacts WHERE id = $1', [raj])).rows[0].deceased_on,
  }));
  assert.deepEqual(after1, before);
  const r = (await call(P1U, 'GET', '/v1/compliance-reviews')).json.reviews.find((x: any) => x.kind === 'life_event' && x.contactId === raj);
  assert.equal(r.lifeEventKind, 'death');
  assert.equal(r.dueOn, new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  assert.equal((await call(LOC, 'POST', `/v1/compliance-reviews/${r.id}/resolve`, { note: 'Handled' })).status, 403);
  assert.equal((await call(P1U, 'POST', `/v1/compliance-reviews/${r.id}/resolve`, { note: 'Claim started, family informed' })).status, 200);
  assert.equal((await call(P1U, 'POST', `/v1/compliance-reviews/${r.id}/resolve`, { note: 'Again' })).status, 422);
});

test('coming of age: a review opens once for someone reaching the age of majority soon', async () => {
  assert.equal((await call(P1U, 'POST', '/v1/compliance-reviews/run')).status, 403);
  const first = await call(ADMIN, 'POST', '/v1/compliance-reviews/run');
  assert.equal(first.status, 200);
  assert.ok(first.json.opened >= 1);
  const rv = (await call(P1U, 'GET', '/v1/compliance-reviews')).json.reviews.filter((x: any) => x.kind === 'coming_of_age');
  assert.equal(rv.length, 1);
  assert.equal(rv[0].contactId, aman);
  assert.equal(rv[0].milestoneOn, yearsAgoPlusDays(0, 30));
  assert.match(JSON.stringify(rv[0].items), /not yet confirmed by counsel/);
  assert.equal((await call(ADMIN, 'POST', '/v1/compliance-reviews/run')).json.opened, 0);
});

test('the family summary shows each member under the viewer\'s access', async () => {
  const s = (await call(P1U, 'GET', `/v1/families/${fam}/compliance`)).json.members;
  const by = (id: string) => s.find((m: any) => m.contactId === id);
  assert.equal(by(jas).minor, true);
  assert.equal(by(jas).majorityAge, 19);
  assert.equal(by(aman).reachesMajorityOn, yearsAgoPlusDays(0, 30));
  assert.ok(by(simran).consentsInForce.includes('collection_use'));
  assert.equal(by(simran).latestId.result, 'verified');
  assert.equal((await call(P2U, 'GET', `/v1/families/${fam}/compliance`)).status, 404);
  assert.equal((await call(LOC, 'GET', `/v1/families/${fam}/compliance`)).status, 200);
});

test('privacy wall: a sibling partner sees and changes nothing; a manager sees but cannot change', async () => {
  assert.equal((await call(P2U, 'GET', `/v1/people/${raj}/compliance`)).status, 404);
  assert.equal((await consent(P2U, raj, {})).status, 404);
  assert.equal((await call(P2U, 'POST', `/v1/people/${raj}/id-references`, { method: 'in_person', result: 'verified', checkedOn: today() })).status, 404);
  assert.equal((await call(P2U, 'POST', `/v1/people/${raj}/life-events`, { kind: 'move', occurredOn: today() })).status, 404);
  assert.equal((await call(P2U, 'GET', `/v1/boxes/${box1}/person-compliance`)).status, 404);
  assert.equal((await call(P2U, 'GET', '/v1/compliance-reviews')).json.reviews.length, 0);
  assert.equal((await call(P2U, 'GET', '/v1/compliance-reviews?status=resolved')).json.reviews.length, 0);
  // Using a consent the caller cannot see looks like it does not exist.
  const theirs = await consent(P2U, p2client, {});
  assert.equal(theirs.status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/boxes/${box1}/consent-uses`, { consentId: theirs.json.id })).status, 404);
  const v = await call(LOC, 'GET', `/v1/people/${raj}/compliance`);
  assert.equal(v.status, 200);
  assert.equal(v.json.canEdit, false);
  assert.equal((await consent(LOC, raj, {})).status, 403);
  assert.equal((await call(LOC, 'POST', `/v1/people/${raj}/life-events`, { kind: 'move', occurredOn: today() })).status, 403);
});
