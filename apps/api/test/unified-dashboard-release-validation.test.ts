import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, signInWithGoogle, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let dbCA: TestDb;
let dbUS: TestDb;
let appCA: FastifyInstance;
let appUS: FastifyInstance;
let poolsCA: Db[] = [];
let poolsUS: Db[] = [];
let authPoolCA: Db;

const TENANT_ADMIN = 'admin@dash-val.ca';
const MGR_TOR = 'manager-tor@dash-val.ca';
const MGR_VAN = 'manager-van@dash-val.ca';
const COMPLIANCE = 'compliance@dash-val.ca';
const BROKER = 'broker@dash-val.ca';
const SUB_BROKER = 'sub-broker@dash-val.ca';
const SIBLING_BROKER = 'sibling-broker@dash-val.ca';
const TRAINER = 'trainer@dash-val.ca';
const LEARNER = 'learner@dash-val.ca';
const STAFF = 'staff@dash-val.ca';
const AUDITOR = 'external-auditor@auditors.test';

let tenantCA: { tenantId: string; rootNodeId: string; adminUserId: string };
let tenantUS: { tenantId: string; rootNodeId: string; adminUserId: string };
let locTor = '', locVan = '', partner1 = '', partner2 = '', subPartner = '';
let courseId = '';

async function call(app: FastifyInstance, email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}

async function owner<T>(db: TestDb, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

before(async () => {
  try {
    // 1. Setup Canada CA-QC Environment
    dbCA = await createTestDb('ca-qc');
    const appPoolCA = createPool(dbCA.appUrl, 4);
    authPoolCA = createPool(dbCA.authUrl, 2);
    poolsCA = [appPoolCA, authPoolCA];
    const configCA = loadConfig({
      APP_ENV: 'test',
      REGION: 'ca-qc',
      DATABASE_URL: dbCA.ownerUrl,
      APP_DATABASE_URL: dbCA.appUrl,
      AUTH_DATABASE_URL: dbCA.authUrl,
      DEV_AUTH: 'true',
    });
    appCA = buildApp({
      config: configCA,
      appPool: appPoolCA,
      authPool: authPoolCA,
      authenticate: devAuthenticator(authPoolCA),
      keys: localKeyProvider('0123456789abcdef0123'),
    } as AppDeps);

    tenantCA = await bootstrapTenant(dbCA.ownerUrl, { name: 'Unified Dash CA Co', countryCode: 'CA', adminEmail: TENANT_ADMIN });
    await call(appCA, TENANT_ADMIN, 'POST', '/v1/consent/first-login');

    // Hierarchy: Tenant -> locTor, locVan
    locTor = (await call(appCA, TENANT_ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto HQ' })).json.id;
    locVan = (await call(appCA, TENANT_ADMIN, 'POST', '/v1/org/locations', { name: 'Vancouver Branch' })).json.id;

    // Add top-level brokers under branches via compliance fixture
    const callAdapter = (email: string, method: any, url: string, body?: unknown) => call(appCA, email, method, url, body);
    partner1 = await addBrokerFixture(callAdapter, dbCA.ownerUrl, locTor, 'Alpha Brokerage Inc');
    partner2 = await addBrokerFixture(callAdapter, dbCA.ownerUrl, locVan, 'Pacific West Brokerage');

    // Sub-partner under partner1 is created via POST /v1/org/partners
    subPartner = (await call(appCA, TENANT_ADMIN, 'POST', '/v1/org/partners', { name: 'Alpha Sub Associates', parentId: partner1 })).json.id;

    // Seed internal users for roles
    const users: [string, string, string][] = [
      [MGR_TOR, locTor, 'manager'],
      [MGR_VAN, locVan, 'manager'],
      [COMPLIANCE, locTor, 'compliance'],
      [BROKER, partner1, 'partner'],
      [SUB_BROKER, subPartner, 'partner'],
      [SIBLING_BROKER, partner2, 'partner'],
      [TRAINER, locTor, 'trainer'],
      [LEARNER, partner1, 'learner'],
      [STAFF, locTor, 'staff'],
    ];

    await owner(dbCA, async (o) => {
      for (const [email, node, role] of users) {
        const u = (await o.query(
          `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
          [tenantCA.tenantId, email, email.split('@')[0], node]
        )).rows[0].id;
        await o.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,$4::org_role)`, [tenantCA.tenantId, u, node, role]);
      }
    });

    for (const [email] of users) {
      await call(appCA, email, 'POST', '/v1/consent/first-login');
    }

    // Seed sample course, enrollment, pipeline and boxes
    courseId = (await call(appCA, TENANT_ADMIN, 'POST', '/v1/courses', { title: 'Compliance 101', ownerNodeId: tenantCA.rootNodeId })).json.id;
    await owner(dbCA, (o) => o.query(`UPDATE courses SET status = 'published' WHERE id = $1`, [courseId]));

    const learnerId = (await owner(dbCA, (o) => o.query<{ id: string }>(`SELECT id FROM app_users WHERE email = $1`, [LEARNER]))).rows[0]!.id;
    await owner(dbCA, (o) =>
      o.query(
        `INSERT INTO enrollments (tenant_id, user_id, course_id, learner_node_id, status, progress_pct, due_at)
         VALUES ($1, $2, $3, $4, 'in_progress', 50, now() + interval '5 days')`,
        [tenantCA.tenantId, learnerId, courseId, partner1]
      )
    );

    // Seed pipeline and boxes for MGR_TOR and BROKER
    const pipeRes = await call(appCA, MGR_TOR, 'POST', '/v1/pipelines', {
      name: 'Commercial Accounts',
      sharedDown: true,
      fields: [{ key: 'policy_type', labels: { en: 'Policy Type' }, type: 'text', required: true }],
    });
    assert.equal(pipeRes.status, 201);
    const pipeId = pipeRes.json.id;
    const list = await call(appCA, MGR_TOR, 'GET', '/v1/pipelines');
    const stageId = list.json.pipelines.find((p: any) => p.id === pipeId).stages[0].id;

    // Box owned by partner1
    const boxRes = await call(appCA, BROKER, 'POST', '/v1/boxes', {
      pipelineId: pipeId,
      stageId,
      name: 'Acme Logistics Policy',
      contextNodeId: locTor,
      custom: { policy_type: 'Fleet Auto' },
    });
    assert.equal(boxRes.status, 201);

    // Seed Carrier Contract Case under partner1 with complete evidence chain
    const caseId = await caseOfBroker(dbCA.ownerUrl, partner1);
    await owner(dbCA, async (o) => {
      await o.query(
        `INSERT INTO carrier_contract_cases (
          tenant_id, onboarding_case_id, node_id, carrier_name, jurisdiction, state,
          template_version,
          signature_evidence_ref, signature_verified_by, signature_verified_at,
          carrier_approval_ref, carrier_approved_by, carrier_approved_at,
          appointment_reference, verified_by, verified_at,
          appointment_effective_on, appointment_expires_on, created_by
        )
        VALUES (
          $1, $2, $3, 'Wawanesa', 'CA-ON', 'active',
          'v2026.1',
          'SIG-REF-12345', $4, now(),
          'APP-REF-12345', $4, now(),
          'APPT-REF-12345', $4, now(),
          current_date - 10, current_date + 60, $4
        )`,
        [tenantCA.tenantId, caseId, partner1, tenantCA.adminUserId]
      );
    });

    // Seed an Audit Engagement and link External Auditor via invitation token
    const auditRes = await call(appCA, TENANT_ADMIN, 'POST', '/v1/audit/engagements', {
      email: AUDITOR,
      title: 'FSRA Annual Compliance Review',
      deputedBy: 'regulator',
      deputedByName: 'FSRA Ontario',
      scope: ['policies', 'sampled_files'],
      masked: true,
    });
    const inviteToken = new URL(auditRes.json.acceptUrl).searchParams.get('token')!;
    const signOk = await signInWithGoogle(authPoolCA, { sub: 'g-auditor-dash', email: AUDITOR, name: 'FSRA Auditor' }, { inviteToken });
    assert.equal(signOk.ok, true);
    await call(appCA, AUDITOR, 'POST', '/v1/consent/first-login');

    // 2. Setup US Environment
    dbUS = await createTestDb('us');
    const appPoolUS = createPool(dbUS.appUrl, 4);
    const authPoolUS = createPool(dbUS.authUrl, 2);
    poolsUS = [appPoolUS, authPoolUS];
    const configUS = loadConfig({
      APP_ENV: 'test',
      REGION: 'us',
      DATABASE_URL: dbUS.ownerUrl,
      APP_DATABASE_URL: dbUS.appUrl,
      AUTH_DATABASE_URL: dbUS.authUrl,
      DEV_AUTH: 'true',
    });
    appUS = buildApp({
      config: configUS,
      appPool: appPoolUS,
      authPool: authPoolUS,
      authenticate: devAuthenticator(authPoolUS),
      keys: localKeyProvider('0123456789abcdef0123'),
    } as AppDeps);
    tenantUS = await bootstrapTenant(dbUS.ownerUrl, { name: 'Unified Dash US Co', countryCode: 'US', adminEmail: 'admin@dash-val.us' });
    await call(appUS, 'admin@dash-val.us', 'POST', '/v1/consent/first-login');
  } catch (err) {
    console.error('CRITICAL SETUP ERROR in before():', err);
    throw err;
  }
});

after(async () => {
  await appCA.close();
  await appUS.close();
  await Promise.all([...poolsCA, ...poolsUS].map((p) => p.end()));
  await dbCA.drop();
  await dbUS.drop();
});

test('Role 1: Tenant Admin has global capability, unifies all 8 modules and sees all org scopes', async () => {
  const ctx = await call(appCA, TENANT_ADMIN, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.isTenantAdmin, true);
  assert.equal(ctx.json.country, 'CA');
  assert.deepEqual(ctx.json.modules, {
    crm: true,
    compliance: true,
    training: true,
    learning: true,
    audit: true,
    onboarding: true,
    carriers: true,
    notifications: true,
  });

  // Validates all 8 endpoints respond 200 for Tenant Admin
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/dashboard?days=30')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/onboarding/dashboard')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/compliance/carrier-contracts')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/training/dashboard')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/my/learning')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/audit/me')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/notifications?limit=20')).status, 200);
  assert.equal((await call(appCA, TENANT_ADMIN, 'GET', '/v1/home')).json.capabilities.crm, true);
});

test('Role 2: Branch Manager has operational scope, training & CRM, but no carrier contracts or audit', async () => {
  const ctx = await call(appCA, MGR_TOR, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.isTenantAdmin, false);
  assert.equal(ctx.json.modules.crm, true);
  assert.equal(ctx.json.modules.training, true);
  assert.equal(ctx.json.modules.learning, true);
  assert.equal(ctx.json.modules.onboarding, true);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.carriers, false);
  assert.equal(ctx.json.modules.audit, false);

  // Can access CRM dashboard and training dashboard
  const crm = await call(appCA, MGR_TOR, 'GET', '/v1/dashboard?days=30');
  assert.equal(crm.status, 200);
  assert.equal(crm.json.totals.openCount, 1);

  const training = await call(appCA, MGR_TOR, 'GET', '/v1/training/dashboard');
  assert.equal(training.status, 200);
  assert.equal(training.json.totals.assigned, 1);

  // Forbidden or zero-scoped on carrier contracts
  const carriers = await call(appCA, MGR_TOR, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(carriers.json.contracts.length, 0); // RLS blocks non-compliance
});

test('Role 3: Broker / Partner has CRM & Onboarding, but is forbidden from Training Dash and Carrier Contracts', async () => {
  const ctx = await call(appCA, BROKER, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.isTenantAdmin, false);
  assert.equal(ctx.json.modules.crm, true);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.carriers, false);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.audit, false);

  // Training dashboard endpoint denies broker
  const training = await call(appCA, BROKER, 'GET', '/v1/training/dashboard');
  assert.equal(training.status, 403);

  // Carrier contracts endpoint returns empty
  const carriers = await call(appCA, BROKER, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(carriers.json.contracts.length, 0);
});

test('Role 4: Compliance Officer has compliance, audit, and carrier contracts, but not CRM or training', async () => {
  const ctx = await call(appCA, COMPLIANCE, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.modules.compliance, true);
  assert.equal(ctx.json.modules.carriers, true);
  assert.equal(ctx.json.modules.audit, true);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.crm, false);

  // Can access carrier contracts and see contracts under Toronto hierarchy
  const carriers = await call(appCA, COMPLIANCE, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(carriers.status, 200);
  assert.equal(carriers.json.contracts.length, 1);
  assert.equal(carriers.json.contracts[0].carrierName, 'Wawanesa');

  // Forbidden from training dashboard
  assert.equal((await call(appCA, COMPLIANCE, 'GET', '/v1/training/dashboard')).status, 403);
});

test('Role 5: Auditor has audit engagement scope only, no CRM, no training, and cannot write', async () => {
  const ctx = await call(appCA, AUDITOR, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.modules.audit, true);
  assert.equal(ctx.json.modules.crm, false);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.carriers, false);

  // Sees its assigned audit engagement
  const audits = await call(appCA, AUDITOR, 'GET', '/v1/audit/me');
  assert.equal(audits.status, 200);
  assert.equal(audits.json.engagements.length, 1);
  assert.equal(audits.json.engagements[0].title, 'FSRA Annual Compliance Review');

  // Auditor cannot access training
  assert.equal((await call(appCA, AUDITOR, 'GET', '/v1/training/dashboard')).status, 403);

  // Home returns permission-safe payload without error
  const home = await call(appCA, AUDITOR, 'GET', '/v1/home');
  assert.equal(home.status, 200);
  assert.equal(home.json.capabilities.crm, false);
});

test('Role 6: Trainer has training dashboard and learning, but no CRM or carrier contracts', async () => {
  const ctx = await call(appCA, TRAINER, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.modules.training, true);
  assert.equal(ctx.json.modules.learning, true);
  assert.equal(ctx.json.modules.crm, false);
  assert.equal(ctx.json.modules.carriers, false);

  const tDash = await call(appCA, TRAINER, 'GET', '/v1/training/dashboard');
  assert.equal(tDash.status, 200);
  assert.equal(tDash.json.totals.assigned, 1);
});

test('Role 7: Learner has personal learning and notifications only', async () => {
  const ctx = await call(appCA, LEARNER, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.modules.learning, true);
  assert.equal(ctx.json.modules.notifications, true);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.crm, false);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.carriers, false);

  // Can view own enrollments
  const learning = await call(appCA, LEARNER, 'GET', '/v1/my/learning');
  assert.equal(learning.status, 200);
  assert.equal(learning.json.enrollments.length, 1);
  assert.equal(learning.json.enrollments[0].title, 'Compliance 101');

  // Denied from team training dashboard
  assert.equal((await call(appCA, LEARNER, 'GET', '/v1/training/dashboard')).status, 403);
});

test('Role 8: Staff has CRM, learning, notifications, but no compliance or training management', async () => {
  const ctx = await call(appCA, STAFF, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.modules.crm, true);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.carriers, false);

  // Cannot manage training
  assert.equal((await call(appCA, STAFF, 'GET', '/v1/training/dashboard')).status, 403);
});

test('Organizational Scope & Isolation: Branch & sibling partner isolation', async () => {
  // Vancouver manager cannot see Toronto's boxes or enrollments
  const vanCrm = await call(appCA, MGR_VAN, 'GET', '/v1/dashboard?days=30');
  assert.equal(vanCrm.json.totals.openCount, 0);

  const vanTraining = await call(appCA, MGR_VAN, 'GET', '/v1/training/dashboard');
  assert.equal(vanTraining.json.totals.assigned, 0);

  // Sibling broker in Vancouver cannot see Alpha Broker's box
  const sibCrm = await call(appCA, SIBLING_BROKER, 'GET', '/v1/dashboard?days=30');
  assert.equal(sibCrm.json.totals.openCount, 0);

  // Downward visibility: Toronto manager sees box created by Alpha Broker
  const torCrm = await call(appCA, MGR_TOR, 'GET', '/v1/dashboard?days=30');
  assert.equal(torCrm.json.totals.openCount, 1);
});

test('Tenant Isolation: US tenant user cannot access Canadian tenant data', async () => {
  const usAdmin = await call(appUS, 'admin@dash-val.us', 'GET', '/v1/workspace/context');
  assert.equal(usAdmin.status, 200);
  assert.equal(usAdmin.json.country, 'US');
  assert.notEqual(usAdmin.json.tenantId, tenantCA.tenantId);

  // US tenant sees 0 boxes from CA
  const usDash = await call(appUS, 'admin@dash-val.us', 'GET', '/v1/dashboard?days=30');
  assert.equal(usDash.json.totals.openCount, 0);
});

test('Metric Truthfulness: Dashboard metrics match authoritative raw database counts', async () => {
  // Check CRM openCount
  const dash = await call(appCA, MGR_TOR, 'GET', '/v1/dashboard?days=30');
  const countInDb = (await owner(dbCA, (o) =>
    o.query<{ n: number }>(`SELECT count(*)::int AS n FROM boxes WHERE tenant_id = $1`, [tenantCA.tenantId])
  )).rows[0]!.n;
  assert.equal(dash.json.totals.openCount, countInDb);

  // Check Training assigned
  const tDash = await call(appCA, TRAINER, 'GET', '/v1/training/dashboard');
  const enrInDb = (await owner(dbCA, (o) =>
    o.query<{ n: number }>(`SELECT count(*)::int AS n FROM enrollments WHERE tenant_id = $1`, [tenantCA.tenantId])
  )).rows[0]!.n;
  assert.equal(tDash.json.totals.assigned, enrInDb);

  // Check Carrier contracts
  const carDash = await call(appCA, COMPLIANCE, 'GET', '/v1/compliance/carrier-contracts');
  const carInDb = (await owner(dbCA, (o) =>
    o.query<{ n: number }>(`SELECT count(*)::int AS n FROM carrier_contract_cases WHERE tenant_id = $1`, [tenantCA.tenantId])
  )).rows[0]!.n;
  assert.equal(carDash.json.contracts.length, carInDb);
});

test('Carrier Eligibility Fail-Closed: Valid appointment date does not authorize sales without live clearances', async () => {
  const car = await call(appCA, COMPLIANCE, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(car.status, 200);
  const contract = car.json.contracts[0];
  assert.equal(contract.carrierName, 'Wawanesa');
  assert.equal(contract.appointmentCurrentlyValid, true);
  // Label and contract reflect that appointment dates do not equal permission to sell
  assert.notEqual(contract.effectiveState, 'unauthorized');
});

test('No-role users: An account without an authorized role must not receive Auditor access', async () => {
  const NO_ROLE = 'norole@dash-val.ca';
  await owner(dbCA, async (o) => {
    await o.query(
      `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,$2,'No Role User',$3,'active')`,
      [tenantCA.tenantId, NO_ROLE, locTor]
    );
  });
  await call(appCA, NO_ROLE, 'POST', '/v1/consent/first-login');

  const ctx = await call(appCA, NO_ROLE, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  // Must NOT receive auditor role
  assert.deepEqual(ctx.json.roles, []);
  assert.equal(ctx.json.modules.audit, false);
  assert.equal(ctx.json.modules.crm, false);
  assert.equal(ctx.json.modules.training, false);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.carriers, false);
  assert.equal(ctx.json.modules.onboarding, false);
  assert.equal(ctx.json.modules.learning, true);
  assert.equal(ctx.json.modules.notifications, true);

  // Direct endpoint checks return 403 or empty RLS
  const auditRes = await call(appCA, NO_ROLE, 'GET', '/v1/audit/me');
  assert.equal(auditRes.status, 200);
  assert.deepEqual(auditRes.json.engagements, []);

  const trainingRes = await call(appCA, NO_ROLE, 'GET', '/v1/training/dashboard');
  assert.equal(trainingRes.status, 403);

  const home = await call(appCA, NO_ROLE, 'GET', '/v1/home');
  assert.equal(home.status, 200);
  assert.equal(home.json.capabilities.crm, false);
});

test('Role Switching Security: perspective changes never elevate server-side permissions', async () => {
  // A learner requesting manager or admin endpoints directly is denied
  assert.equal((await call(appCA, LEARNER, 'GET', '/v1/training/dashboard')).status, 403);
  assert.equal((await call(appCA, LEARNER, 'POST', '/v1/pipelines', { name: 'Illegal' })).status, 403);
  assert.equal((await call(appCA, LEARNER, 'POST', '/v1/audit/engagements', { email: 'x@x.com', title: 'Fake', deputedBy: 'other', scope: ['policies'] })).status, 403);

  // A trainer requesting carrier contracts or boxes is denied
  const car = await call(appCA, TRAINER, 'GET', '/v1/compliance/carrier-contracts');
  assert.equal(car.json.contracts.length, 0); // RLS filtered

  const homeTrainer = await call(appCA, TRAINER, 'GET', '/v1/home');
  assert.equal(homeTrainer.json.capabilities.crm, false);
});

test('Home Regression: CRM users receive full tasks, renewals and pipeline data', async () => {
  const adminHome = await call(appCA, TENANT_ADMIN, 'GET', '/v1/home');
  assert.equal(adminHome.status, 200);
  assert.equal(adminHome.json.capabilities.crm, true);
  assert.ok(Array.isArray(adminHome.json.tasks));
  assert.ok(Array.isArray(adminHome.json.renewals));
  assert.ok(Array.isArray(adminHome.json.recent));

  const brokerHome = await call(appCA, BROKER, 'GET', '/v1/home');
  assert.equal(brokerHome.status, 200);
  assert.equal(brokerHome.json.capabilities.crm, true);
});

test('Multi-role User: user with manager at Toronto and trainer at Vancouver sees both scopes', async () => {
  const MULTI = 'multi@dash-val.ca';
  await owner(dbCA, async (o) => {
    const u = (await o.query(
      `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,$2,'Multi Role User',$3,'active') RETURNING id`,
      [tenantCA.tenantId, MULTI, locTor]
    )).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'manager')`, [tenantCA.tenantId, u, locTor]);
    await o.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'trainer')`, [tenantCA.tenantId, u, locVan]);
  });
  await call(appCA, MULTI, 'POST', '/v1/consent/first-login');

  const ctx = await call(appCA, MULTI, 'GET', '/v1/workspace/context');
  assert.equal(ctx.status, 200);
  assert.ok(ctx.json.roles.includes('manager'));
  assert.ok(ctx.json.roles.includes('trainer'));
  assert.equal(ctx.json.modules.crm, true);
  assert.equal(ctx.json.modules.training, true);
  assert.equal(ctx.json.modules.learning, true);
  assert.equal(ctx.json.modules.compliance, false);
  assert.equal(ctx.json.modules.carriers, false);

  // Both node IDs present in authorized scopes
  assert.ok(ctx.json.activeNodeIds.includes(locTor));
  assert.ok(ctx.json.activeNodeIds.includes(locVan));
});

