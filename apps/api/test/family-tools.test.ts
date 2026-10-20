// Families, Gate D: one email per family (who gets it, what facts each person sees, checks at sending), the import
// dry run (nothing written until every row passes, no merging), the family timeline, the Gmail strip and the left panel.
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
  await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const contact = async (email: string, fullName: string, mail: string | null = `${fullName.toLowerCase().replace(/\W+/g, '.')}@client.test`) => {
  const r = await call(email, 'POST', '/v1/contacts', { fullName, ...(mail ? { email: mail } : {}) });
  assert.equal(r.status, 201, r.raw);
  return r.json.id as string;
};
const policy = (carrier: string, num: string, producer: string, branch: string, expiry: string) =>
  owner(async (c) => (await c.query(
    `INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents,
       modal_premium_cents, premium_frequency, status, effective_date, expiry_date)
     VALUES ($1,$2,$3,$4,$5,$6,'CA-BC',1000,1000,'annual','active','2025-01-01',$7) RETURNING id`, [tenantId, branch, producer, carrier, num, `Plan ${num}`, expiry])).rows[0].id as string);
const yearsAgo = (n: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };

const ADMIN = 'admin@tools.test', LOC = 'loc@tools.test', P1U = 'p1@tools.test', P2U = 'p2@tools.test';
let X = '', P1 = '', P2 = '';
let raj = '', simran = '', aman = '', kid = '', noMail = '', fam = '', kidFam = '', noMailFam = '', p2client = '', p2fam = '', rajPolicy = '', simranPolicy = '', cousin = '';

before(async () => {
  for (const k of ['FAMILIES_ENABLED', 'FAMILIES_INSURANCE_ENABLED', 'FAMILIES_COMPLIANCE_ENABLED', 'FAMILIES_PRODUCTIVITY_ENABLED']) process.env[k] = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenantId = (await bootstrapTenant(db.ownerUrl, { name: 'Tools Test Co', countryCode: 'CA', adminEmail: ADMIN })).tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  await seedUser(LOC, X, 'manager');
  await seedUser(P1U, P1, 'admin');
  await seedUser(P2U, P2, 'admin');
  raj = await contact(P1U, 'Raj Singh');
  simran = await contact(P1U, 'Simran Singh');
  aman = await contact(P1U, 'Aman Singh');
  kid = await contact(P1U, 'Teen Kaur');
  noMail = await contact(P1U, 'Nomail Gill', null);
  cousin = await contact(P1U, 'Harjit Singh');
  p2client = await contact(P2U, 'Priya Sharma');
  await call(P1U, 'PATCH', `/v1/people/${aman}/profile`, { dateOfBirth: yearsAgo(12) });
  await call(P1U, 'PATCH', `/v1/people/${kid}/profile`, { dateOfBirth: yearsAgo(16) });
  fam = (await call(P1U, 'POST', '/v1/families', { displayName: 'Singh family', salutation: 'Raj and Simran', members: [{ contactId: raj, role: 'head' }, { contactId: simran, role: 'spouse_partner' }, { contactId: aman, role: 'child' }] })).json.id;
  kidFam = (await call(P1U, 'POST', '/v1/families', { displayName: 'Kaur family', members: [{ contactId: kid, role: 'head' }] })).json.id;
  noMailFam = (await call(P1U, 'POST', '/v1/families', { displayName: 'Gill family', members: [{ contactId: noMail, role: 'head' }] })).json.id;
  p2fam = (await call(P2U, 'POST', '/v1/families', { displayName: 'Sharma family', members: [{ contactId: p2client, role: 'head' }] })).json.id;
  rajPolicy = await policy('manulife', 'R-1', P1, X, '2027-02-01');
  simranPolicy = await policy('sun-life', 'S-1', P1, X, '2026-12-01');
  assert.equal((await call(P1U, 'POST', `/v1/policies/${rajPolicy}/parties`, { contactId: raj, role: 'owner' })).status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/policies/${simranPolicy}/parties`, { contactId: simran, role: 'owner' })).status, 201);
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

const BODY = 'Dear {{salutation}},\n\nYour policies with us:\n{{myPolicies}}\n\n{{myName}}\n{{unsubscribe}}';

test('switched off: Gate D routes answer 404 and the left panel has no Families item', async () => {
  process.env.FAMILIES_PRODUCTIVITY_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'POST', '/v1/family-merges/plan', { familyIds: [fam] })).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/families/${fam}/timeline`)).status, 404);
    assert.equal((await call(P1U, 'GET', '/v1/families/strip?emails=raj.singh@client.test')).status, 404);
    assert.ok(!(await call(P1U, 'GET', '/v1/nav?v=1.6.0')).json.items.some((i: any) => i.id === 'families'));
  } finally { process.env.FAMILIES_PRODUCTIVITY_ENABLED = '1'; }
});

test('left panel: Families appears beside Contacts only for an extension that has its icon', async () => {
  const ids = async (q: string) => (await call(P1U, 'GET', `/v1/nav${q}`)).json.items.map((i: any) => i.id);
  const v16 = await ids('?v=1.6.0');
  assert.equal(v16[v16.indexOf('contacts') + 1], 'families');
  assert.ok(!(await ids('')).includes('families'));
  assert.ok(!(await ids('?v=1.5.0')).includes('families'));
});

test('who a family email goes to: the Head, or each adult; minors, opt-outs, no email and the dead are skipped', async () => {
  const plan = async (ids: string[], who = P1U) => (await call(who, 'POST', '/v1/family-merges/plan', { familyIds: ids })).json;
  let p = await plan([fam, kidFam, noMailFam]);
  const by = (id: string) => p.families.find((f: any) => f.familyId === id);
  assert.deepEqual(by(fam).recipients.map((r: any) => r.contactId), [raj]);
  assert.deepEqual(by(kidFam).skipped.map((s: any) => s.reason), ['minor']);
  assert.deepEqual(by(noMailFam).skipped.map((s: any) => s.reason), ['no_email']);
  const v = (await call(P1U, 'GET', `/v1/families/${fam}`)).json.version;
  assert.equal((await call(P1U, 'PATCH', `/v1/families/${fam}`, { version: v, mailingPreference: 'each_adult' })).status, 200);
  p = await plan([fam]);
  assert.deepEqual(by(fam).recipients.map((r: any) => r.contactId).sort(), [raj, simran].sort());
  // A sibling partner cannot see the family at all; a manager can see it but not send to it.
  assert.equal((await plan([fam], P2U)).families.length, 0);
  assert.equal((await plan([fam], LOC)).families[0].canSend, false);
  assert.equal((await plan([fam], LOC)).totals.notYours, 1);
});

test('templates: unsubscribe required, deal fields refused, policies never in the subject', async () => {
  const mk = (subject: string, body: string) => call(P1U, 'POST', '/v1/family-merges', { name: 'Review', subject, body, familyIds: [fam] });
  assert.match((await mk('Hello', 'No opt out')).json.error.message, /unsubscribe/);
  assert.match((await mk('Hello', 'About {{box}} {{unsubscribe}}')).json.error.message, /cannot use \{\{box\}\}/);
  assert.equal((await mk('{{myPolicies}}', '{{unsubscribe}}')).status, 422);
});

test('each person sees only their own policies; the facts that went in are kept', async () => {
  const pv = async (contactId: string) => (await call(P1U, 'POST', '/v1/family-merges/preview', { subject: 'Annual review for {{familyName}}', body: BODY, familyId: fam, contactId })).json;
  const r = await pv(raj);
  assert.equal(r.subject, 'Annual review for Singh family');
  assert.match(r.html, /Manulife · Plan R-1/);
  assert.doesNotMatch(r.html, /Plan S-1/);
  const s = await pv(simran);
  assert.match(s.html, /Plan S-1/);
  assert.doesNotMatch(s.html, /Plan R-1/);
  assert.deepEqual(s.facts.find((f: any) => f.key === 'myPolicies').policyIds, [simranPolicy]);
  assert.equal((await call(P2U, 'POST', '/v1/family-merges/preview', { subject: 'x', body: BODY, familyId: fam })).status, 404);
});

test('sending: facts are checked again for each message; someone who opted out since is skipped', async () => {
  const c = await call(P1U, 'POST', '/v1/family-merges', { name: 'Annual review', subject: 'Annual review for {{familyName}}', body: BODY, familyIds: [fam, kidFam, p2fam] });
  assert.equal(c.status, 201, c.raw);
  assert.equal(c.json.recipients, 2);
  assert.equal(c.json.skipped.notFound, 1); // the sibling's family is invisible
  assert.equal(c.json.skipped.minor, 1);
  const id = c.json.id;
  assert.equal((await call(P1U, 'GET', '/v1/merges')).json.merges.find((m: any) => m.id === id).audience, 'families');
  assert.equal((await call(P1U, 'PATCH', `/v1/merges/${id}`, { status: 'running' })).status, 204);
  // Simran opts out after the merge was planned.
  await owner((c2) => c2.query('UPDATE contacts SET email_opt_out_at = now() WHERE id = $1', [simran]));
  const n = (await call(P1U, 'POST', `/v1/merges/${id}/next`)).json;
  assert.equal(n.to, 'raj.singh@client.test');
  assert.match(n.html, /Plan R-1/);
  assert.doesNotMatch(n.html, /Plan S-1/);
  assert.equal((await call(P1U, 'POST', `/v1/merges/${id}/recipients/${n.recipientId}/result`, { ok: true, threadId: 't1' })).status, 204);
  const done = (await call(P1U, 'POST', `/v1/merges/${id}/next`)).json;
  assert.equal(done.done, true);
  const detail = (await call(P1U, 'GET', `/v1/merges/${id}`)).json;
  const rr = detail.recipients.find((x: any) => x.email === 'raj.singh@client.test');
  assert.equal(rr.familyName, 'Singh family');
  assert.deepEqual(rr.facts.map((f: any) => f.key).sort(), ['familyName', 'myPolicies', 'salutation']);
  assert.equal(detail.recipients.find((x: any) => x.email === 'simran.singh@client.test').status, 'skipped');
  // Template edits keep the family rules.
  assert.equal((await call(P1U, 'PATCH', `/v1/merges/${id}`, { body: '{{box}} {{unsubscribe}}' })).status, 422);
  await owner((c2) => c2.query('UPDATE contacts SET email_opt_out_at = NULL WHERE id = $1', [simran]));
});

const CSV_BAD = [
  'family,role,full_name,email,phone,date_of_birth',
  'Dhillon family,head,Manpreet Dhillon,manpreet@client.test,604-555-1000,1979-05-01',
  'Dhillon family,head,Kiran Dhillon,kiran@client.test,,1981-13-01',
  'Dhillon family,cousin,Jas Dhillon,,,',
  'Brar family,child,Raj Singh,,,',
  'Brar family,spouse,Simran Singh,simran.singh@client.test,999-999-9999,',
].join('\n');

test('import dry run: every problem listed, nothing written; a commit with problems is refused', async () => {
  const counts = () => owner(async (c) => ({
    contacts: (await c.query('SELECT count(*)::int AS n FROM contacts')).rows[0].n,
    families: (await c.query('SELECT count(*)::int AS n FROM families')).rows[0].n,
    members: (await c.query('SELECT count(*)::int AS n FROM family_memberships')).rows[0].n,
  }));
  const before1 = await counts();
  const d = await call(P1U, 'POST', '/v1/families/import', { csv: CSV_BAD, dryRun: true, fileName: 'families.csv' });
  assert.equal(d.status, 200, d.raw);
  const line = (n: number) => d.json.rows.find((r: any) => r.line === n);
  assert.ok(line(3).errors.some((e: string) => /date_of_birth/.test(e)));
  assert.ok(line(2).errors.some((e: string) => /exactly one Head \(found 2\)/.test(e)));
  assert.ok(line(4).errors.some((e: string) => /Role "cousin"/.test(e)));
  assert.ok(line(5).errors.some((e: string) => /already exists.*same_name_ok/.test(e))); // a same-name client is never assumed
  assert.ok(line(6).errors.some((e: string) => /Already in Singh family/.test(e)));
  assert.ok(line(5).errors.some((e: string) => /exactly one Head \(found 0\)/.test(e)));
  assert.deepEqual(await counts(), before1);
  const c = await call(P1U, 'POST', '/v1/families/import', { csv: CSV_BAD, dryRun: false });
  assert.equal(c.status, 422);
  assert.equal(c.json.committed, false);
  assert.deepEqual(await counts(), before1);
});

test('import commit: new clients and families, existing clients linked by email and never overwritten, one log row', async () => {
  const csv = [
    'Household,Role,Name,E-mail,Phone,DOB,Notes',
    'Dhillon family,head,Manpreet Dhillon,manpreet@client.test,604-555-1000,1979-05-01,x',
    'Dhillon family,spouse,Kiran Dhillon,kiran@client.test,,1981-03-01,',
    `Dhillon family,other,Someone Else,harjit.singh@client.test,000-000-0000,,`,
  ].join('\r\n');
  const d = await call(P1U, 'POST', '/v1/families/import', { csv, dryRun: true });
  assert.equal(d.json.summary.errors, 0, JSON.stringify(d.json.rows));
  assert.deepEqual(d.json.unknownColumns, ['Notes']);
  assert.equal(d.json.summary.clientsToCreate, 2);
  assert.equal(d.json.summary.clientsToLink, 1);
  assert.ok(d.json.rows[2].notes.some((n: string) => /Linked by email to "Harjit Singh"/.test(n)));
  assert.ok(d.json.rows[2].notes.some((n: string) => /kept, not replaced/.test(n)));
  // A sibling cannot add to this partner's family, and a manager cannot import for the partner.
  assert.equal((await call(P2U, 'POST', '/v1/families/import', { csv: `family_id,role,full_name\n${fam},child,New Kid`, dryRun: true })).json.rows[0].errors[0], 'That family_id was not found among the families you can see');
  assert.equal((await call(LOC, 'POST', '/v1/families/import', { csv, dryRun: true, ownerNodeId: P1 })).status, 403);
  const c = await call(P1U, 'POST', '/v1/families/import', { csv, dryRun: false, fileName: 'dhillon.csv' });
  assert.equal(c.status, 201, c.raw);
  const f = (await call(P1U, 'GET', '/v1/families?q=Dhillon')).json.families[0];
  assert.equal(f.displayName, 'Dhillon family');
  const harjit = await owner(async (x) => (await x.query('SELECT full_name, phone FROM contacts WHERE id = $1', [cousin])).rows[0]);
  assert.deepEqual(harjit, { full_name: 'Harjit Singh', phone: null });
  const imports = (await call(P1U, 'GET', '/v1/families/imports')).json.imports;
  assert.equal(imports.length, 1);
  assert.equal(imports[0].clientsCreated, 2);
  assert.equal((await call(P2U, 'GET', '/v1/families/imports')).json.imports.length, 0);
  // Adding to an existing family by id, with a Head already there, is refused.
  const again = await call(P1U, 'POST', '/v1/families/import', { csv: `family_id,role,full_name\n${f.id},head,Another Head`, dryRun: true });
  assert.match(again.json.rows[0].errors[0], /already has a Head/);
});

test('timeline: joins, policy roles and family emails, newest first, under the viewer\'s access', async () => {
  const t = (await call(P1U, 'GET', `/v1/families/${fam}/timeline`)).json.events;
  const kinds = t.map((e: any) => e.kind);
  for (const k of ['family_created', 'member_joined', 'policy_role_added', 'family_email_sent']) assert.ok(kinds.includes(k), k);
  for (let i = 1; i < t.length; i++) assert.ok(new Date(t[i - 1].at).getTime() >= new Date(t[i].at).getTime());
  assert.equal((await call(P2U, 'GET', `/v1/families/${fam}/timeline`)).status, 404);
  // A manager sees the family history but not the partner's own send log.
  const m = (await call(LOC, 'GET', `/v1/families/${fam}/timeline`)).json.events.map((e: any) => e.kind);
  assert.ok(m.includes('member_joined') && !m.includes('family_email_sent'));
});

test('Gmail strip: the sender\'s family, and private suggestions that can be dismissed', async () => {
  const lone = await contact(P1U, 'Gurdeep Singh');
  const s = (await call(P1U, 'GET', '/v1/families/strip?emails=raj.singh@client.test,gurdeep.singh@client.test,priya.sharma@client.test,unknown@x.test')).json;
  assert.equal(s.people.length, 2); // Priya belongs to a sibling partner: not even her name comes back
  assert.equal(s.families.length, 1);
  assert.equal(s.families[0].name, 'Singh family');
  assert.equal(s.families[0].canEdit, true);
  const sug = s.suggestions.find((x: any) => x.contactId === lone);
  assert.deepEqual(sug.reasons, ['same_conversation', 'same_last_name']);
  assert.equal((await call(LOC, 'GET', '/v1/families/strip?emails=raj.singh@client.test,gurdeep.singh@client.test')).json.suggestions.length, 0);
  assert.equal((await call(P1U, 'POST', '/v1/families/suggestions/dismiss', { contactId: lone, familyId: fam })).status, 204);
  assert.equal((await call(P1U, 'GET', '/v1/families/strip?emails=raj.singh@client.test,gurdeep.singh@client.test')).json.suggestions.length, 0);
  assert.equal((await call(P2U, 'GET', '/v1/families/strip?emails=raj.singh@client.test')).json.people.length, 0);
});
