// Families, Gate A: grouping separate client records, the one-Head and one-family rules, version conflicts, history,
// and the privacy-isolation release test (a partner cannot discover another partner's family members by any route).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { ageOn, normaliseRelationship } from '../src/routes-families.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let tenant: { tenantId: string };

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
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  await owner(async (c) => {
    const u = (await c.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
    await c.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  });
  await call(email, 'POST', '/v1/consent/first-login');
}
const contact = async (email: string, fullName: string) => {
  const r = await call(email, 'POST', '/v1/contacts', { fullName, email: `${fullName.toLowerCase().replace(/\W+/g, '.')}@client.test` });
  assert.equal(r.status, 201, r.raw);
  return r.json.id as string;
};

const ADMIN = 'admin@fam.test', LOC = 'loc@fam.test', P1U = 'p1@fam.test', P2U = 'p2@fam.test', S1U = 's1@fam.test', OTHER = 'admin@other.test';
let P1 = '', S1 = '';
let raj = '', simran = '', aman = '', uncle = '', cousin = '', p2client = '', s1client = '';

before(async () => {
  process.env.FAMILIES_ENABLED = '1';
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 6);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  tenant = await bootstrapTenant(db.ownerUrl, { name: 'Family Test Co', countryCode: 'CA', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const X = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Surrey' })).json.id;
  P1 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner One');
  const P2 = await addBrokerFixture(call, db.ownerUrl, X, 'Partner Two');
  S1 = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Sub One', parentId: P1 })).json.id;
  await seedUser(tenant.tenantId, LOC, X, 'manager');
  await seedUser(tenant.tenantId, P1U, P1, 'admin');
  await seedUser(tenant.tenantId, P2U, P2, 'admin');
  await seedUser(tenant.tenantId, S1U, S1, 'partner');
  raj = await contact(P1U, 'Raj Singh');
  simran = await contact(P1U, 'Simran Singh');
  aman = await contact(P1U, 'Aman Singh');
  uncle = await contact(P1U, 'Harjit Singh');
  cousin = await contact(P1U, 'Navjot Kaur');
  p2client = await contact(P2U, 'Priya Sharma');
  s1client = await contact(S1U, 'Gurpreet Gill');
  // A second tenant on the same server, for the tenant wall.
  await bootstrapTenant(db.ownerUrl, { name: 'Other Agency', countryCode: 'CA', adminEmail: OTHER });
  await call(OTHER, 'POST', '/v1/consent/first-login');
});
after(async () => {
  await app.close();
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

let fam = '';

test('helpers: age in whole years, relationships stored one way', () => {
  assert.equal(ageOn('2014-10-21', new Date('2026-10-20T12:00:00Z')), 11);
  assert.equal(ageOn('2014-10-20', new Date('2026-10-20T12:00:00Z')), 12);
  assert.equal(ageOn(null), null);
  assert.deepEqual(normaliseRelationship('b', 'a', 'spouse_partner'), { a: 'a', b: 'b', kind: 'spouse_partner' });
  assert.deepEqual(normaliseRelationship('kid', 'mum', 'child_of'), { a: 'mum', b: 'kid', kind: 'parent_of' });
});

test('switched off: every family route answers 404 and contacts work as before', async () => {
  process.env.FAMILIES_ENABLED = '0';
  try {
    assert.equal((await call(P1U, 'GET', '/v1/families')).status, 404);
    assert.equal((await call(P1U, 'POST', '/v1/families', { displayName: 'X', members: [{ contactId: raj, role: 'head' }] })).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/people/${raj}/family`)).status, 404);
    assert.equal((await call(P1U, 'GET', `/v1/contacts/${raj}`)).status, 200);
  } finally {
    process.env.FAMILIES_ENABLED = '1';
  }
  // Nothing was created while it was off, and no family exists for existing clients until someone builds one.
  assert.equal(await owner(async (c) => (await c.query('SELECT count(*)::int AS n FROM families')).rows[0].n), 0);
});

test('a client with no family shows as a family of one; nothing is created', async () => {
  const r = await call(P1U, 'GET', `/v1/people/${raj}/family`);
  assert.equal(r.status, 200);
  assert.equal(r.json.family, null);
  assert.deepEqual(r.json.members, []);
});

test('create a family: exactly one Head, no duplicates, everyone from the same partner', async () => {
  const bad = async (members: unknown, code: number) => assert.equal((await call(P1U, 'POST', '/v1/families', { displayName: 'Singh family', members })).status, code);
  await bad([{ contactId: raj, role: 'spouse_partner' }], 422);
  await bad([{ contactId: raj, role: 'head' }, { contactId: simran, role: 'head' }], 422);
  await bad([{ contactId: raj, role: 'head' }, { contactId: raj, role: 'child' }], 422);
  // Another partner's client is invisible: it reads as not found, never as "belongs to someone else".
  await bad([{ contactId: raj, role: 'head' }, { contactId: p2client, role: 'other' }], 404);
  const r = await call(P1U, 'POST', '/v1/families', {
    displayName: 'Singh family', salutation: 'Raj and Simran Singh',
    members: [{ contactId: raj, role: 'head' }, { contactId: simran, role: 'spouse_partner' }, { contactId: aman, role: 'child' }],
  });
  assert.equal(r.status, 201, r.raw);
  fam = r.json.id;
  assert.equal(r.json.memberCount, 3);
  assert.equal(r.json.head.contactId, raj);
  assert.equal(r.json.version, 1);
  assert.equal(r.json.needsHead, false);
  // A person is in one family at a time.
  const again = await call(P1U, 'POST', '/v1/families', { displayName: 'Second', members: [{ contactId: aman, role: 'head' }] });
  assert.equal(again.status, 409);
});

test('privacy-isolation release test: a sibling partner cannot discover the family or its members by any route', async () => {
  const deny = async (method: M, url: string, body?: unknown) => {
    const r = await call(P2U, method, url, body);
    assert.equal(r.status, 404, `${method} ${url} answered ${r.status}`);
  };
  await deny('GET', `/v1/families/${fam}`);
  await deny('GET', `/v1/families/${fam}/members`);
  await deny('GET', `/v1/people/${raj}/family`);
  await deny('GET', `/v1/people/${aman}/relationships`);
  await deny('PATCH', `/v1/families/${fam}`, { version: 1, displayName: 'Taken' });
  await deny('POST', `/v1/families/${fam}/members`, { version: 1, contactId: p2client, role: 'other' });
  await deny('POST', `/v1/families/${fam}/change-head`, { version: 1, contactId: simran });
  await deny('POST', `/v1/people/${p2client}/relationships`, { otherContactId: raj, kind: 'sibling' });
  // Search by family name and by a member's name finds nothing; totals count nothing.
  for (const q of ['Singh', 'Simran']) assert.equal((await call(P2U, 'GET', `/v1/families?q=${q}`)).json.families.length, 0);
  assert.equal((await call(P2U, 'GET', '/v1/families')).json.families.length, 0);
  // Asking which family a hidden client is in returns nothing at all (not even "hidden").
  const m = await call(P2U, 'GET', `/v1/family-memberships?contactIds=${raj},${simran},${aman}`);
  assert.equal(m.status, 200);
  assert.deepEqual(m.json.memberships, []);
  // A different tenant sees nothing either.
  assert.equal((await call(OTHER, 'GET', `/v1/families/${fam}`)).status, 404);
  assert.equal((await call(OTHER, 'GET', '/v1/families')).json.families.length, 0);
});

test('managers above see a partner family but cannot change it; siblings still cannot see it', async () => {
  const r = await call(S1U, 'POST', '/v1/families', { displayName: 'Gill family', members: [{ contactId: s1client, role: 'head' }] });
  assert.equal(r.status, 201, r.raw);
  const up = await call(P1U, 'GET', `/v1/families/${r.json.id}`);
  assert.equal(up.status, 200);
  assert.equal((await call(P1U, 'PATCH', `/v1/families/${r.json.id}`, { version: 1, displayName: 'Changed' })).status, 403);
  assert.equal((await call(P2U, 'GET', `/v1/families/${r.json.id}`)).status, 404);
  // A sub-partner cannot pull its manager's client into its family.
  assert.equal((await call(S1U, 'POST', `/v1/families/${r.json.id}/members`, { version: 1, contactId: uncle, role: 'other' })).status, 404);
});

test('a location manager sees families whose Head is marked for that location, like the clients, but cannot change them', async () => {
  const r = await call(LOC, 'GET', `/v1/families/${fam}`);
  assert.equal(r.status, 200, r.raw);
  assert.equal((await call(LOC, 'GET', `/v1/families/${fam}/members`)).json.members.length, 3);
  assert.equal((await call(LOC, 'PATCH', `/v1/families/${fam}`, { version: r.json.version, displayName: 'Changed' })).status, 403);
});

test('stale versions get 409; a good change bumps the version', async () => {
  const ok = await call(P1U, 'PATCH', `/v1/families/${fam}`, { version: 1, mailingAddress: '12 King St, Surrey BC' });
  assert.equal(ok.status, 200, ok.raw);
  assert.equal(ok.json.version, 2);
  const stale = await call(P1U, 'PATCH', `/v1/families/${fam}`, { version: 1, displayName: 'Old view' });
  assert.equal(stale.status, 409);
  assert.equal((await call(P1U, 'GET', `/v1/families/${fam}`)).json.displayName, 'Singh family');
});

test('change Head: two people at once, exactly one wins and there is exactly one Head', async () => {
  const v = (await call(P1U, 'GET', `/v1/families/${fam}`)).json.version;
  const [a, b] = await Promise.all([
    call(P1U, 'POST', `/v1/families/${fam}/change-head`, { version: v, contactId: simran, formerHeadRole: 'spouse_partner' }),
    call(P1U, 'POST', `/v1/families/${fam}/change-head`, { version: v, contactId: aman }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const heads = await owner(async (c) => (await c.query(`SELECT contact_id FROM family_memberships WHERE family_id = $1 AND role = 'head' AND ended_at IS NULL`, [fam])).rows);
  assert.equal(heads.length, 1);
  // Put Raj back as Head for the rest of the tests, recording his old role.
  const now = (await call(P1U, 'GET', `/v1/families/${fam}`)).json;
  if (now.head.contactId !== raj) {
    const back = await call(P1U, 'POST', `/v1/families/${fam}/change-head`, { version: now.version, contactId: raj, formerHeadRole: heads[0].contact_id === simran ? 'spouse_partner' : 'child' });
    assert.equal(back.status, 200, back.raw);
    assert.equal(back.json.family.head.contactId, raj);
  }
});

test('add, re-role and end members; the Head leaving flags the family instead of blocking it', async () => {
  let f = (await call(P1U, 'GET', `/v1/families/${fam}`)).json;
  const add = await call(P1U, 'POST', `/v1/families/${fam}/members`, { version: f.version, contactId: uncle, role: 'other' });
  assert.equal(add.status, 201, add.raw);
  assert.equal(add.json.family.memberCount, 4);
  f = add.json.family;
  assert.equal((await call(P1U, 'POST', `/v1/families/${fam}/members`, { version: f.version, contactId: cousin, role: 'head' })).status, 409);
  const unc = add.json.members.find((m: any) => m.contactId === uncle);
  const re = await call(P1U, 'PATCH', `/v1/families/${fam}/members/${unc.id}`, { version: f.version, role: 'dependent' });
  assert.equal(re.status, 200, re.raw);
  f = re.json.family;
  const headRow = re.json.members.find((m: any) => m.role === 'head');
  assert.equal((await call(P1U, 'PATCH', `/v1/families/${fam}/members/${headRow.id}`, { version: f.version, role: 'other' })).status, 422);
  // Uncle moves out: the membership ends and stays in his history.
  const end = await call(P1U, 'POST', `/v1/families/${fam}/members/${unc.id}/end`, { version: f.version, reason: 'left' });
  assert.equal(end.status, 200, end.raw);
  assert.equal(end.json.family.memberCount, 3);
  const his = await call(P1U, 'GET', `/v1/people/${uncle}/family`);
  assert.equal(his.json.family, null);
  assert.equal(his.json.history[0].endReason, 'left');
  // An ended membership cannot be changed, even directly in the database.
  await assert.rejects(owner((c) => c.query(`UPDATE family_memberships SET role = 'head' WHERE id = $1`, [unc.id])), /ended family membership/);
});

test('move a member to another family of the same partner, keeping history', async () => {
  const other = await call(P1U, 'POST', '/v1/families', { displayName: 'Kaur family', members: [{ contactId: cousin, role: 'head' }] });
  assert.equal(other.status, 201, other.raw);
  const f = (await call(P1U, 'GET', `/v1/families/${fam}`)).json;
  const mv = await call(P1U, 'POST', `/v1/families/${fam}/move-member`, { version: f.version, contactId: aman, toFamilyId: other.json.id, toVersion: other.json.version, role: 'dependent' });
  assert.equal(mv.status, 200, mv.raw);
  assert.equal(mv.json.from.memberCount, 2);
  assert.equal(mv.json.to.memberCount, 2);
  const a = await call(P1U, 'GET', `/v1/people/${aman}/family`);
  assert.equal(a.json.family.id, other.json.id);
  assert.equal(a.json.history[0].endReason, 'moved');
  // Move him back so the Singh family is whole again.
  const back = await call(P1U, 'POST', `/v1/families/${other.json.id}/move-member`, { version: mv.json.to.version, contactId: aman, toFamilyId: fam, toVersion: mv.json.from.version, role: 'child' });
  assert.equal(back.status, 200, back.raw);
});

test('the database itself refuses a member from another partner, even if the API were skipped', async () => {
  await assert.rejects(
    owner((c) => c.query('INSERT INTO family_memberships (tenant_id, family_id, contact_id, role) VALUES ($1, $2, $3, $4)', [tenant.tenantId, fam, p2client, 'other'])),
    /same partner as the family/,
  );
});

test('relationships: stored once, read from either side, never across partners', async () => {
  const r = await call(P1U, 'POST', `/v1/people/${aman}/relationships`, { otherContactId: raj, kind: 'child_of' });
  assert.equal(r.status, 201, r.raw);
  const fromKid = (await call(P1U, 'GET', `/v1/people/${aman}/relationships`)).json.relationships;
  const fromDad = (await call(P1U, 'GET', `/v1/people/${raj}/relationships`)).json.relationships;
  assert.equal(fromKid[0].kind, 'child_of');
  assert.equal(fromDad[0].kind, 'parent_of');
  // The contradiction "Aman is Raj's parent" cannot stand beside it.
  assert.equal((await call(P1U, 'POST', `/v1/people/${aman}/relationships`, { otherContactId: raj, kind: 'parent_of' })).status, 409);
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/relationships`, { otherContactId: raj, kind: 'sibling' })).status, 422);
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/relationships`, { otherContactId: p2client, kind: 'sibling' })).status, 404);
  const sp = await call(P1U, 'POST', `/v1/people/${simran}/relationships`, { otherContactId: raj, kind: 'spouse_partner' });
  assert.equal(sp.status, 201);
  assert.equal((await call(P1U, 'POST', `/v1/people/${raj}/relationships`, { otherContactId: simran, kind: 'spouse_partner' })).status, 409);
  const end = await call(P1U, 'POST', `/v1/people/${raj}/relationships/${sp.json.id}/end`);
  assert.equal(end.status, 204);
  assert.equal((await call(P1U, 'GET', `/v1/people/${raj}/relationships?history=true`)).json.relationships.length, 2);
});

test('profile: real dates only; age is shown, never stored', async () => {
  assert.equal((await call(P1U, 'PATCH', `/v1/people/${aman}/profile`, { dateOfBirth: '2999-01-01' })).status, 422);
  assert.equal((await call(P1U, 'PATCH', `/v1/people/${aman}/profile`, { dateOfBirth: '2014-02-30' })).status, 422);
  assert.equal((await call(P1U, 'PATCH', `/v1/people/${aman}/profile`, { dateOfBirth: '2014-03-15', preferredLanguage: 'pa' })).status, 204);
  assert.equal((await call(P2U, 'PATCH', `/v1/people/${aman}/profile`, { dateOfBirth: '2000-01-01' })).status, 404);
  const p = await call(P1U, 'GET', `/v1/people/${aman}/family`);
  assert.equal(p.json.person.dateOfBirth, '2014-03-15');
  assert.equal(typeof p.json.person.age, 'number');
  const row = p.json.members.find((m: any) => m.contactId === aman);
  assert.equal(row.dateOfBirth, '2014-03-15');
  // The audit log names the fields, never the values.
  const log = await owner(async (c) => (await c.query(`SELECT detail FROM audit_log WHERE action = 'person_profile_updated' ORDER BY created_at DESC LIMIT 1`)).rows[0].detail);
  assert.ok(!JSON.stringify(log).includes('2014-03-15'));
});

test('group by family: memberships for listed clients, only those visible', async () => {
  const r = await call(P1U, 'GET', `/v1/family-memberships?contactIds=${raj},${simran},${uncle},${p2client}`);
  assert.equal(r.status, 200);
  const ids = r.json.memberships.map((m: any) => m.contactId).sort();
  assert.deepEqual(ids, [raj, simran].sort());
  assert.equal((await call(P1U, 'GET', '/v1/family-memberships?contactIds=nope')).status, 422);
});

test('deleting a client keeps the family; losing the Head flags it', async () => {
  const tmp = await contact(P1U, 'Temp Person');
  const f = await call(P1U, 'POST', '/v1/families', { displayName: 'Temp family', members: [{ contactId: tmp, role: 'head' }, { contactId: uncle, role: 'other' }] });
  assert.equal(f.status, 201, f.raw);
  assert.equal((await call(P1U, 'DELETE', `/v1/contacts/${tmp}`)).status, 204);
  const after = await call(P1U, 'GET', `/v1/families/${f.json.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.json.memberCount, 1);
  assert.equal(after.json.head, null);
  assert.equal(after.json.needsHead, true);
});

test('archive ends memberships and deletes nobody', async () => {
  const f = (await call(P1U, 'GET', '/v1/families?q=Kaur')).json.families[0];
  const r = await call(P1U, 'POST', `/v1/families/${f.id}/archive`, { version: f.version });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.status, 'archived');
  assert.equal(r.json.memberCount, 0);
  assert.equal((await call(P1U, 'GET', `/v1/contacts/${cousin}`)).status, 200);
  assert.equal((await call(P1U, 'GET', `/v1/people/${cousin}/family`)).json.history[0].endReason, 'family_archived');
  assert.equal((await call(P1U, 'POST', `/v1/families/${f.id}/members`, { version: r.json.version, contactId: cousin, role: 'head' })).status, 422);
  assert.equal((await call(P1U, 'GET', '/v1/families?q=Kaur')).json.families.length, 0);
  assert.equal((await call(P1U, 'GET', '/v1/families?q=Kaur&includeArchived=true')).json.families.length, 1);
});

test('bad input is refused before it reaches the database', async () => {
  assert.equal((await call(P1U, 'POST', '/v1/families', { displayName: '  ', members: [{ contactId: raj, role: 'head' }] })).status, 422);
  assert.equal((await call(P1U, 'POST', '/v1/families', { displayName: 'X', members: [] })).status, 400);
  assert.equal((await call(P1U, 'PATCH', `/v1/families/${fam}`, { displayName: 'No version' })).status, 400);
  assert.equal((await call(P1U, 'GET', '/v1/families/not-a-uuid')).status, 400);
  const res = await app.inject({ method: 'GET', url: '/v1/families' });
  assert.equal(res.statusCode, 401);
});
