import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];

async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const ADMIN = 'admin@apex.test';
const MGR = 'mgr@apex.test';
const BROKER = 'broker@apex.test';
const COMPLIANCE = 'compliance@apex.test';
const AUDITOR = 'auditor@apex.test';
const TRAINER = 'trainer@apex.test';
const LEARNER = 'learner@apex.test';
const STAFF = 'staff@apex.test';
const MGR_B2 = 'mgr-b2@apex.test';
const T2_ADMIN = 'admin@beacon.test';

let co1TenantId = '';
let co2TenantId = '';
let branch1Id = '';
let branch2Id = '';
let t2BranchId = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({
    APP_ENV: 'test',
    REGION: 'ca-qc',
    DATABASE_URL: db.ownerUrl,
    APP_DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true',
  });
  app = buildApp({
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  } as AppDeps);

  // Tenant 1
  const co1 = await bootstrapTenant(db.ownerUrl, { name: 'Apex Financial', countryCode: 'CA', adminEmail: ADMIN });
  co1TenantId = co1.tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  branch1Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Toronto' })).json.id;
  branch2Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Montreal' })).json.id;

  // Tenant 2
  const co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Financial', countryCode: 'CA', adminEmail: T2_ADMIN });
  co2TenantId = co2.tenantId;
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');
  t2BranchId = (await call(T2_ADMIN, 'POST', '/v1/org/locations', { name: 'Beacon Vancouver' })).json.id;

  // Provision role fixtures in Tenant 1
  await owner(async (c) => {
    const rolesToCreate = [
      { email: MGR, role: 'manager', node: branch1Id },
      { email: BROKER, role: 'partner', node: branch1Id },
      { email: COMPLIANCE, role: 'compliance', node: branch1Id },
      { email: AUDITOR, role: 'auditor', node: branch1Id },
      { email: TRAINER, role: 'trainer', node: branch1Id },
      { email: LEARNER, role: 'learner', node: branch1Id },
      { email: STAFF, role: 'staff', node: branch1Id },
      { email: MGR_B2, role: 'manager', node: branch2Id },
    ];
    for (const item of rolesToCreate) {
      const uRes = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1TenantId, item.email, item.email.split('@')[0], item.node],
      );
      const uid = uRes.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [co1TenantId, uid, item.node, item.role],
      );
    }
  });

  for (const e of [MGR, BROKER, COMPLIANCE, AUDITOR, TRAINER, LEARNER, STAFF, MGR_B2]) {
    await call(e, 'POST', '/v1/consent/first-login');
  }
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map((p) => p.end()));
  if (db) await db.drop();
});

test('workspace security: 1. Admin gets complete tenant capabilities', async () => {
  const r = await call(ADMIN, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.tenantId, co1TenantId);
  assert.equal(r.json.isTenantAdmin, true);
  assert.ok(r.json.roles.includes('admin'));
  assert.equal(r.json.modules.crm, true);
  assert.equal(r.json.modules.compliance, true);
  assert.equal(r.json.modules.carriers, true);
  assert.equal(r.json.modules.training, true);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, true);
  assert.equal(r.json.modules.onboarding, true);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 2. Manager gets branch CRM and training, but not carrier/audit administration', async () => {
  const r = await call(MGR, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('manager'));
  assert.equal(r.json.modules.crm, true);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, true);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, false);
  assert.equal(r.json.modules.onboarding, true);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 3. Broker/Partner gets CRM and learning, but not carrier review or training administration', async () => {
  const r = await call(BROKER, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('partner'));
  assert.equal(r.json.modules.crm, true);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, false);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, false);
  assert.equal(r.json.modules.onboarding, true);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 4. Compliance Officer gets compliance, carriers, audit, and onboarding, without CRM mutation', async () => {
  const r = await call(COMPLIANCE, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('compliance'));
  assert.equal(r.json.modules.crm, false);
  assert.equal(r.json.modules.compliance, true);
  assert.equal(r.json.modules.carriers, true);
  assert.equal(r.json.modules.training, false);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, true);
  assert.equal(r.json.modules.onboarding, true);
  assert.equal(r.json.modules.notifications, true);

  // Verify compliance navigation is present
  const nav = await call(COMPLIANCE, 'GET', '/v1/nav');
  assert.equal(nav.status, 200);
  assert.ok(nav.json.items.some((i: { id: string }) => i.id === 'compliance'), 'compliance item must be visible');
});

test('workspace security: 5. Auditor gets audit and learning only, with CRM and administrative actions disabled', async () => {
  const r = await call(AUDITOR, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('auditor'));
  assert.equal(r.json.modules.crm, false);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, false);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, true);
  assert.equal(r.json.modules.onboarding, false);
  assert.equal(r.json.modules.notifications, true);

  // Non-CRM home contract returns safely without error
  const home = await call(AUDITOR, 'GET', '/v1/home');
  assert.equal(home.status, 200);
  assert.equal(home.json.capabilities.crm, false);
  assert.deepEqual(home.json.tasks, []);
});

test('workspace security: 6. Trainer gets training and personal learning, without CRM or carrier management', async () => {
  const r = await call(TRAINER, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('trainer'));
  assert.equal(r.json.modules.crm, false);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, true);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, false);
  assert.equal(r.json.modules.onboarding, false);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 7. Learner gets personal learning only, with administrative capabilities denied', async () => {
  const r = await call(LEARNER, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('learner'));
  assert.equal(r.json.modules.crm, false);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, false);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, false);
  assert.equal(r.json.modules.onboarding, false);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 8. Staff gets branch CRM and personal learning, but not management or carriers', async () => {
  const r = await call(STAFF, 'GET', '/v1/workspace/context');
  assert.equal(r.status, 200);
  assert.equal(r.json.isTenantAdmin, false);
  assert.ok(r.json.roles.includes('staff'));
  assert.equal(r.json.modules.crm, true);
  assert.equal(r.json.modules.compliance, false);
  assert.equal(r.json.modules.carriers, false);
  assert.equal(r.json.modules.training, false);
  assert.equal(r.json.modules.learning, true);
  assert.equal(r.json.modules.audit, false);
  assert.equal(r.json.modules.onboarding, true);
  assert.equal(r.json.modules.notifications, true);
});

test('workspace security: 9. Sibling branch isolation between Branch 1 and Branch 2', async () => {
  const b1 = await call(MGR, 'GET', '/v1/workspace/context');
  const b2 = await call(MGR_B2, 'GET', '/v1/workspace/context');

  assert.ok(b1.json.activeNodeIds.includes(branch1Id), 'b1 includes branch 1');
  assert.ok(!b1.json.activeNodeIds.includes(branch2Id), 'b1 must NOT include branch 2');
  assert.ok(b1.json.scopes.some((s: { id: string }) => s.id === branch1Id));
  assert.ok(!b1.json.scopes.some((s: { id: string }) => s.id === branch2Id));

  assert.ok(b2.json.activeNodeIds.includes(branch2Id), 'b2 includes branch 2');
  assert.ok(!b2.json.activeNodeIds.includes(branch1Id), 'b2 must NOT include branch 1');
  assert.ok(b2.json.scopes.some((s: { id: string }) => s.id === branch2Id));
  assert.ok(!b2.json.scopes.some((s: { id: string }) => s.id === branch1Id));
});

test('workspace security: 10. Multi-tenant isolation between Apex Financial and Beacon Financial', async () => {
  const t1 = await call(ADMIN, 'GET', '/v1/workspace/context');
  const t2 = await call(T2_ADMIN, 'GET', '/v1/workspace/context');

  assert.equal(t1.json.tenantId, co1TenantId);
  assert.equal(t2.json.tenantId, co2TenantId);
  assert.notEqual(t1.json.tenantId, t2.json.tenantId);

  // Tenant 1 cannot see Tenant 2 nodes
  assert.ok(!t1.json.activeNodeIds.includes(t2BranchId));
  assert.ok(!t1.json.scopes.some((s: { id: string }) => s.id === t2BranchId));

  // Tenant 2 cannot see Tenant 1 nodes
  assert.ok(!t2.json.activeNodeIds.includes(branch1Id));
  assert.ok(!t2.json.activeNodeIds.includes(branch2Id));
  assert.ok(!t2.json.scopes.some((s: { id: string }) => s.id === branch1Id));
  assert.ok(!t2.json.scopes.some((s: { id: string }) => s.id === branch2Id));
});
