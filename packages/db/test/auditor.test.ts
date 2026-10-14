import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildRequestContext, type RequestContext } from '@pii/domain';
import { bootstrapTenant, createPool, withRequestTx, type Db } from '../src/index.ts';
import { createTestDb, type TestDb } from '../src/testing.ts';

// Read-only auditor: can read everything in its scope, can write nothing.

let db: TestDb;
let appPool: Db;
let tenantId: string;
let rootId: string;
let branchId: string;
let auditorId: string;
let managerId: string;

before(async () => {
  db = await createTestDb('ca-qc');
  appPool = createPool(db.appUrl, 4);
  const t = await bootstrapTenant(db.ownerUrl, { name: 'Audit Co', countryCode: 'CA', adminEmail: 'admin@audit.ca' });
  tenantId = t.tenantId;
  rootId = t.rootNodeId;
  const o = new pg.Client({ connectionString: db.ownerUrl });
  await o.connect();
  branchId = (await o.query(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'location','Branch A') RETURNING id`, [tenantId])).rows[0].id;
  const mkUser = async (email: string, role: string) => {
    const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, branchId])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, branchId, role]);
    return u as string;
  };
  auditorId = await mkUser('auditor@audit.ca', 'auditor');
  managerId = await mkUser('manager@audit.ca', 'manager');
  await o.end();
});
after(async () => {
  await appPool.end();
  await db.drop();
});

const ctxFor = (userId: string, roles: string[]): RequestContext =>
  buildRequestContext({ tenantId, userId, homeNodeId: branchId, tenantRootNodeId: rootId, roles: roles.map((role) => ({ nodeId: branchId, role })) });

test('domain: an auditor-only user cannot write but can read the CRM', () => {
  const c = ctxFor(auditorId, ['auditor']);
  assert.equal(c.canWrite, false);
  assert.equal(c.canUseCrm, true);
  assert.equal(c.isTenantAdmin, false);
});

test('domain: an auditor who also holds a working role can write', () => {
  const c = ctxFor(managerId, ['auditor', 'manager']);
  assert.equal(c.canWrite, true);
});

test('auditor can read its branch', async () => {
  const names = await withRequestTx(appPool, ctxFor(auditorId, ['auditor']), async (tx) =>
    (await tx.query<{ name: string }>('SELECT name FROM org_nodes WHERE id = $1', [branchId])).rows.map((r) => r.name));
  assert.deepEqual(names, ['Branch A']);
});

test('auditor cannot create an org node', async () => {
  await assert.rejects(
    withRequestTx(appPool, ctxFor(auditorId, ['auditor']), (tx) =>
      tx.query(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'location','Sneaky')`, [tenantId])),
    /row-level security/,
  );
});

test('auditor cannot rename its branch', async () => {
  const rows = await withRequestTx(appPool, ctxFor(auditorId, ['auditor']), async (tx) => {
    const r = await tx.query(`UPDATE org_nodes SET name = 'Renamed' WHERE id = $1`, [branchId]);
    return r.rowCount;
  });
  assert.equal(rows, 0);
  const name = await withRequestTx(appPool, ctxFor(auditorId, ['auditor']), async (tx) =>
    (await tx.query<{ name: string }>('SELECT name FROM org_nodes WHERE id = $1', [branchId])).rows[0]?.name);
  assert.equal(name, 'Branch A');
});

test('a manager on the same branch can still write', async () => {
  const inserted = await withRequestTx(appPool, ctxFor(managerId, ['manager']), async (tx) =>
    (await tx.query(`INSERT INTO org_nodes (tenant_id,type,name) VALUES ($1,'location','Branch B')`, [tenantId])).rowCount);
  assert.equal(inserted, 1);
});
