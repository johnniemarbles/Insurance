import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildRequestContext } from '@pii/domain';
import { ensureRoles, assertDeployment, bootstrapTenant, seedStarterPipelines, createPool, migrate, withRequestTx, findLoginCandidates, type Db } from '../src/index.ts';
import { createTestDb, type TestDb } from '../src/testing.ts';

let db: TestDb;
let appPool: Db;
let authPool: Db;
let t: { tenantId: string; rootNodeId: string; adminUserId: string };

before(async () => {
  db = await createTestDb('ca-qc');
  appPool = createPool(db.appUrl, 4);
  authPool = createPool(db.authUrl, 2);
  t = await bootstrapTenant(db.ownerUrl, { name: 'Test Co', countryCode: 'CA', adminEmail: 'Admin@Test.CA' });
});
after(async () => {
  await appPool.end();
  await authPool.end();
  await db.drop();
});

const adminCtx = () => buildRequestContext({ tenantId: t.tenantId, userId: t.adminUserId, homeNodeId: t.rootNodeId, tenantRootNodeId: t.rootNodeId, roles: [{ nodeId: t.rootNodeId, role: 'admin' }] });

test('migrations are idempotent and checksummed', async () => {
  const again = await migrate(db.ownerUrl);
  assert.equal(again.applied.length, 0);
  assert.ok(again.skipped.length >= 3);
});

test('deployment region guard', async () => {
  assert.equal((await assertDeployment(appPool, 'ca-qc')).region, 'ca-qc');
  await assert.rejects(assertDeployment(appPool, 'us'), /Residency violation/);
});

test('a US tenant cannot be created in the Quebec database', async () => {
  await assert.rejects(bootstrapTenant(db.ownerUrl, { name: 'US Co', countryCode: 'US', adminEmail: 'a@us.com' }), /Residency violation/);
});

test('bootstrap created the admin as invited, email lowercased, found by login lookup', async () => {
  const found = await findLoginCandidates(authPool, 'admin@test.ca');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.status, 'invited');
  assert.equal(found[0]!.tenantRootNodeId, t.rootNodeId);
  assert.deepEqual(found[0]!.roles, [{ nodeId: t.rootNodeId, role: 'admin' }]);
});

test('without a tenant context the app role sees nothing', async () => {
  const { rows } = await appPool.query('SELECT count(*)::int AS n FROM org_nodes');
  assert.equal(rows[0].n, 0);
});

test('the auth role can read identity tables only', async () => {
  await assert.rejects(authPool.query('SELECT 1 FROM boxes LIMIT 1'), /permission denied/);
  await assert.rejects(authPool.query('SELECT 1 FROM gmail_accounts LIMIT 1'), /permission denied/);
});

test('app role cannot create tenants or edit audit log', async () => {
  await assert.rejects(withRequestTx(appPool, adminCtx(), (tx) => tx.query(`INSERT INTO tenants (name, country_code, region) VALUES ('x','CA','ca-qc')`)), /permission denied/);
  await assert.rejects(withRequestTx(appPool, adminCtx(), (tx) => tx.query(`UPDATE audit_log SET action = 'x'`)), /permission denied/);
  await assert.rejects(withRequestTx(appPool, adminCtx(), (tx) => tx.query(`SELECT * FROM audit_log_default`)), /permission denied/);
});

test('settings are transaction-local: they do not leak to the next request', async () => {
  await withRequestTx(appPool, adminCtx(), async (tx) => {
    const r = await tx.query('SELECT count(*)::int AS n FROM org_nodes');
    assert.equal(r.rows[0].n, 1);
  });
  const { rows } = await appPool.query('SELECT count(*)::int AS n FROM org_nodes');
  assert.equal(rows[0].n, 0);
});

test('identity tables are branch-scoped: siblings cannot see each other', async () => {
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const ins = async (sql: string, params: unknown[]) => (await o.query(sql, params)).rows[0];
  const X = (await ins(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'location','X') RETURNING id`, [t.tenantId])).id;
  const P1 = (await ins(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'partner','P1') RETURNING id`, [t.tenantId])).id;
  const P2 = (await ins(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'partner','P2') RETURNING id`, [t.tenantId])).id;
  for (const p of [P1, P2]) await o.query(`INSERT INTO org_links (tenant_id,parent_id,child_id,kind) VALUES ($1,$2,$3,'location_link')`, [t.tenantId, X, p]);
  const mkUser = async (email: string, home: string, role: string) => {
    const u = (await ins(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [t.tenantId, email, home])).id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [t.tenantId, u, home, role]);
    await o.query(`INSERT INTO invitations (tenant_id,email,node_id,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,'member',gen_random_bytes(32),$4,now()+interval '1 day')`, [t.tenantId, `inv-${email}`, home, u]);
    return u;
  };
  const u1 = await mkUser('p1@x.ca', P1, 'admin');
  const u2 = await mkUser('p2@x.ca', P2, 'admin');
  const mgr = await mkUser('mgr@x.ca', X, 'manager');
  await o.end();

  const ctx = (user: string, home: string, role: string) => buildRequestContext({ tenantId: t.tenantId, userId: user, homeNodeId: home, tenantRootNodeId: t.rootNodeId, roles: [{ nodeId: home, role }] });
  const names = async (c: ReturnType<typeof ctx>, sql: string) => withRequestTx(appPool, c, async (tx) => (await tx.query(sql)).rows.map((r) => r.v as string).sort());

  const p1 = ctx(u1, P1, 'admin');
  assert.deepEqual(await names(p1, 'SELECT name AS v FROM org_nodes'), ['P1', 'Test Co', 'X']);
  assert.deepEqual(await names(p1, 'SELECT email::text AS v FROM app_users'), ['p1@x.ca']);
  assert.deepEqual(await names(p1, 'SELECT email::text AS v FROM invitations'), ['inv-p1@x.ca']);
  assert.deepEqual(await names(p1, 'SELECT node_id::text AS v FROM user_node_roles'), [P1]);
  assert.deepEqual(await names(p1, 'SELECT action AS v FROM audit_log'), []);

  const m = ctx(mgr, X, 'manager');
  assert.deepEqual(await names(m, 'SELECT name AS v FROM org_nodes'), ['P1', 'P2', 'Test Co', 'X']);
  assert.deepEqual(await names(m, 'SELECT email::text AS v FROM app_users'), ['mgr@x.ca', 'p1@x.ca', 'p2@x.ca']);

  const p2 = ctx(u2, P2, 'admin');
  assert.deepEqual(await names(p2, 'SELECT name AS v FROM org_nodes'), ['P2', 'Test Co', 'X']);

  const touched = await withRequestTx(appPool, p1, async (tx) => (await tx.query(`UPDATE app_users SET display_name = 'hacked' WHERE id = $1`, [u2])).rowCount);
  assert.equal(touched, 0);
  const del = await withRequestTx(appPool, p1, async (tx) => (await tx.query(`DELETE FROM invitations WHERE email = 'inv-p2@x.ca'`)).rowCount);
  assert.equal(del, 0);

  assert.equal((await names(adminCtx(), 'SELECT email::text AS v FROM app_users')).length, 4);
  assert.ok((await names(adminCtx(), 'SELECT action AS v FROM audit_log')).includes('tenant_created'));
});

test('ensureRoles sets login passwords and rejects weak ones', async () => {
  await assert.rejects(ensureRoles(db.ownerUrl, { appRuntime: 'short', appAuth: 'short' }), /at least 16/);
  await ensureRoles(db.ownerUrl, { appRuntime: 'pw', appAuth: 'pw' }).catch(() => undefined);
  await ensureRoles(db.ownerUrl, { appRuntime: 'a-long-test-password-1', appAuth: 'a-long-test-password-2' });
  const u = new URL(db.appUrl); u.password = 'a-long-test-password-1';
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect(); await c.end();
  await ensureRoles(db.ownerUrl, { appRuntime: 'pwpwpwpwpwpwpwpwpw', appAuth: 'pwpwpwpwpwpwpwpwpw' });
});

test('starter pipeline is seeded once per tenant that has none', async () => {
  assert.equal(await seedStarterPipelines(db.ownerUrl), 1);
  assert.equal(await seedStarterPipelines(db.ownerUrl), 0);
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  const rows = (await o.query(`SELECT (SELECT count(*)::int FROM stages) AS stages, (SELECT count(*)::int FROM field_defs) AS fields, (SELECT is_shared_down FROM pipelines) AS shared`)).rows[0];
  await o.end();
  assert.deepEqual(rows, { stages: 6, fields: 3, shared: true });
});
