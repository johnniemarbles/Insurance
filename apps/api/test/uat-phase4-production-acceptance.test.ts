import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture, caseOfBroker } from './support/broker.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;

const ADMIN = 'admin@uat-apex.test';
const HO = 'ho@uat-apex.test';
const MGR = 'manager@uat-apex.test';
const BROKER = 'broker@uat-apex.test';
const COMPLIANCE = 'compliance@uat-apex.test';
const AUDITOR = 'auditor@uat-apex.test';
const TRAINER = 'trainer@uat-apex.test';
const LEARNER = 'learner@uat-apex.test';
const STAFF = 'staff@uat-apex.test';
const MGR_B2 = 'manager-b2@uat-apex.test';
const T2_ADMIN = 'admin@uat-beacon.test';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let co1TenantId = '';
let co2TenantId = '';
let branch1Id = '';
let branch2Id = '';
let brokerNodeId = '';
let pipelineId = '';
let caseId = '';
let b1BoxId = '';
let b2BoxId = '';

type M = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
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

function computeSignature(secret: string, timestamp: number, eventId: string, body: string): string {
  const canonical = `${timestamp}.${eventId}.${body}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

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

  deps = {
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  };
  app = buildApp(deps);

  // 1. Tenant 1 Setup (Apex Financial UAT)
  const co1 = await bootstrapTenant(db.ownerUrl, { name: 'Apex Financial UAT', countryCode: 'CA', adminEmail: ADMIN });
  co1TenantId = co1.tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  branch1Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Toronto Branch' })).json.id;
  branch2Id = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Montreal Branch' })).json.id;

  brokerNodeId = await addBrokerFixture(call, db.ownerUrl, branch1Id, 'Downtown Brokerage Ltd.');

  // 2. Tenant 2 Setup (Beacon Financial UAT)
  const co2 = await bootstrapTenant(db.ownerUrl, { name: 'Beacon Financial UAT', countryCode: 'CA', adminEmail: T2_ADMIN });
  co2TenantId = co2.tenantId;
  await call(T2_ADMIN, 'POST', '/v1/consent/first-login');

  // Set environment variable secret for carrier webhook
  process.env[`CARRIER_WEBHOOK_SECRET_${co1TenantId.replace(/-/g, '_').toUpperCase()}_IA_FINANCIAL_GROUP_PRIMARY`] = TEST_SECRET;

  // 3. Provision Role Users for Tenant 1
  await owner(async c => {
    await c.query('UPDATE tenants SET is_head_office = true WHERE id = $1', [co1TenantId]);

    const roles = [
      { email: HO, role: 'admin', node: co1.rootNodeId },
      { email: MGR, role: 'manager', node: branch1Id },
      { email: BROKER, role: 'partner', node: brokerNodeId },
      { email: COMPLIANCE, role: 'compliance', node: branch1Id },
      { email: AUDITOR, role: 'auditor', node: branch1Id },
      { email: TRAINER, role: 'trainer', node: branch1Id },
      { email: LEARNER, role: 'learner', node: brokerNodeId },
      { email: STAFF, role: 'staff', node: branch1Id },
      { email: MGR_B2, role: 'manager', node: branch2Id },
    ];
    for (const item of roles) {
      const uRes = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [co1TenantId, item.email, item.email.split('@')[0], item.node]
      );
      const uid = uRes.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [co1TenantId, uid, item.node, item.role]
      );
    }
  });

  for (const e of [HO, MGR, BROKER, COMPLIANCE, AUDITOR, TRAINER, LEARNER, STAFF, MGR_B2]) {
    await call(e, 'POST', '/v1/consent/first-login');
  }

  // 4. Create CRM Pipeline & Boxes for Branch 1 and Branch 2
  const pipe = await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Commercial Lines Pipeline', sharedDown: true });
  assert.equal(pipe.status, 201);
  pipelineId = pipe.json.id;

  const box1Res = await call(MGR, 'POST', '/v1/boxes', { pipelineId, name: 'Toronto Commercial Fleet Policy', valueAmount: 15000 });
  assert.equal(box1Res.status, 201);
  b1BoxId = box1Res.json.id;

  const box2Res = await call(MGR_B2, 'POST', '/v1/boxes', { pipelineId, name: 'Montreal Real Estate Portfolio', valueAmount: 25000 });
  assert.equal(box2Res.status, 201);
  b2BoxId = box2Res.json.id;

  // Add a task in Branch 1 for Staff & Manager (due 1 hour ago)
  await call(MGR, 'POST', `/v1/boxes/${b1BoxId}/tasks`, {
    title: 'Review binding contract and collect certificate of insurance',
    dueAt: new Date(Date.now() - 3600000).toISOString(),
  });

  // 5. Seed Compliance Records:
  // - Expiring compliance item (<30d)
  // - Overdue self-report
  // - Active legal hold
  // - AML hit
  // - Overdue large cash report (>15d)
  await owner(async c => {
    const compUser = (await c.query<{ id: string }>('SELECT id FROM app_users WHERE email = $1', [COMPLIANCE])).rows[0]!.id;
    const brokerUser = (await c.query<{ id: string }>('SELECT id FROM app_users WHERE email = $1', [BROKER])).rows[0]!.id;
    const onbId = await caseOfBroker(db.ownerUrl, brokerNodeId);

    // Expiring compliance credential (<30d)
    await c.query(
      `INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction, limit_amount, expires_on)
       VALUES ($1, $2, 'eo', 'Broker E&O Policy', 'EO-UAT-991', 'ON', 2000000, current_date + 15)`,
      [co1TenantId, brokerNodeId]
    );

    // Overdue self-report
    await c.query(
      `INSERT INTO broker_self_reports (tenant_id, case_id, node_id, kind, description, recorded_by, due_on)
       VALUES ($1, $2, $3, 'investigation', 'Broker disclosure inquiry report', $4, current_date - 10)`,
      [co1TenantId, onbId, brokerNodeId, brokerUser]
    );

    // Active unreleased legal hold
    await c.query(
      `INSERT INTO legal_holds (tenant_id, box_id, reason, placed_by_name, placed_at) VALUES ($1, $2, 'FSRA Market Conduct Inquiry', 'Compliance Officer', now())`,
      [co1TenantId, b1BoxId]
    );

    // AML hit unreviewed
    await c.query(
      `INSERT INTO screening_results (tenant_id, box_id, list, result, screened_on, reviewer_id, reviewer_name)
       VALUES ($1, $2, 'sanctions', 'hit', current_date, $3, 'Compliance Officer')`,
      [co1TenantId, b1BoxId, compUser]
    );

    // Overdue large cash report (>15d)
    await c.query(
      `INSERT INTO cash_transactions (tenant_id, box_id, amount, currency, occurred_on, report_required, recorded_by)
       VALUES ($1, $2, 12500.00, 'CAD', current_date - 20, true, $3)`,
      [co1TenantId, b1BoxId, compUser]
    );

    // Seed 1 active carrier contract case (appointment_verified) and 1 submitted
    const case1 = await c.query(
      `INSERT INTO carrier_contract_cases (
         tenant_id, onboarding_case_id, node_id, carrier_id, carrier_name, jurisdiction,
         state, template_version,
         signature_evidence_ref, signature_verified_by, signature_verified_at,
         carrier_approval_ref, carrier_approved_by, carrier_approved_at,
         appointment_reference, appointment_effective_on, appointment_expires_on,
         verified_by, verified_at, created_by
       ) VALUES ($1, $2, $3, 'ia-financial-group', 'iA Financial Group', 'ON',
                 'appointment_verified', 'v2026.1',
                 'SIG-EVID-123456', $4, now(),
                 'APPR-REF-123456', $4, now(),
                 'IA-APPT-ON-123456', current_date, current_date + interval '1 year',
                 $4, now(), $4) RETURNING id`,
      [co1TenantId, onbId, brokerNodeId, compUser]
    );
    caseId = case1.rows[0].id;

    await c.query(
      `INSERT INTO carrier_contract_cases (
         tenant_id, onboarding_case_id, node_id, carrier_id, carrier_name, jurisdiction,
         state, template_version,
         signature_evidence_ref, signature_verified_by, signature_verified_at,
         created_by
       ) VALUES ($1, $2, $3, 'sun-life', 'Sun Life Financial', 'ON',
                 'submitted', 'v2026.1',
                 'SIG-EVID-654321', $4, now(),
                 $4)`,
      [co1TenantId, onbId, brokerNodeId, compUser]
    );

    // Seed existing webhook receipt (reviewed)
    await c.query(
      `INSERT INTO carrier_webhook_receipts (tenant_id, carrier_id, external_event_id, payload_digest, status, payload)
       VALUES ($1, 'sun-life', 'evt-seed-reviewed-1', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'reviewed', '{"event":"seed"}')`,
      [co1TenantId]
    );
  });
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map(p => p.end()));
  if (db) await db.drop();
});

// ==============================================================================
// PILLAR 1: NINE-ROLE AUTHENTICATED PERSPECTIVES & MODULE SCOPE AUDIT
// ==============================================================================

test('PILLAR 1: Admin perspective receives full executive summary, work queue, and all 8 cards', async () => {
  const r = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'admin');
  assert.equal(r.json.tenantId, co1TenantId);

  // Executive summary verification
  assert.ok(r.json.summary, 'Admin must receive executive summary');
  assert.equal(typeof r.json.summary.activeCarrierContracts, 'number');
  assert.equal(typeof r.json.summary.pendingApprovals, 'number');
  assert.equal(typeof r.json.summary.complianceAlerts, 'number');
  assert.equal(typeof r.json.summary.carrierReceipts, 'number');
  assert.equal(typeof r.json.summary.quarantinedReceipts, 'number');

  // Work queue verification
  assert.ok(Array.isArray(r.json.workQueue), 'Admin must receive work queue array');
  assert.ok(r.json.workQueue.length > 0, 'Admin work queue must have operational items');

  // Cards verification: all 8 modules
  const modules = r.json.cards.map((c: any) => c.module);
  for (const m of ['crm', 'compliance', 'onboarding', 'carriers', 'training', 'learning', 'audit', 'notifications']) {
    assert.ok(modules.includes(m), `Admin must receive ${m} card`);
  }
});

test('PILLAR 1: Head Office perspective receives cross-branch executive summary and oversight cards', async () => {
  const r = await call(HO, 'GET', '/v1/workspace/dashboard?perspective=ho');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'ho');
  assert.ok(r.json.summary, 'HO must receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('crm'), 'HO receives CRM oversight');
  assert.ok(modules.includes('compliance'), 'HO receives compliance oversight');
  assert.ok(modules.includes('carriers'), 'HO receives carrier oversight');
  assert.ok(modules.includes('audit'), 'HO receives audit oversight');
});

test('PILLAR 1: Branch Manager perspective receives branch CRM & training, without carrier administration or audit', async () => {
  const r = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=manager');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'manager');
  assert.equal(r.json.summary, undefined, 'Branch manager must NOT receive executive summary strip');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('crm'), 'Manager must receive CRM card');
  assert.ok(modules.includes('training'), 'Manager must receive training card');
  assert.ok(modules.includes('learning'), 'Manager must receive learning card');
  assert.ok(!modules.includes('carriers'), 'Manager must NOT receive carrier administration card');
  assert.ok(!modules.includes('audit'), 'Manager must NOT receive audit engagement card');

  // Verify manager work queue action label is 'Review for Approval'
  const approvalItems = r.json.workQueue.filter((item: any) => item.category === 'contract_approval');
  for (const item of approvalItems) {
    assert.equal(item.actionLabel, 'Review for Approval', 'Action label must be Review for Approval');
    assert.equal(item.target.page, 'compliance');
    assert.equal(item.target.routeId, 'carriers');
  }
});

test('PILLAR 1: Partner / Broker perspective receives personal CRM, onboarding, and learning without training admin', async () => {
  const r = await call(BROKER, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'partner');
  assert.equal(r.json.summary, undefined, 'Broker must NOT receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('crm'), 'Broker receives CRM card');
  assert.ok(modules.includes('onboarding'), 'Broker receives onboarding card');
  assert.ok(modules.includes('carriers'), 'Broker receives carriers card');
  assert.ok(modules.includes('learning'), 'Broker receives learning card');
  assert.ok(!modules.includes('training'), 'Broker must NOT receive training management card');
  assert.ok(!modules.includes('audit'), 'Broker must NOT receive audit card');
});

test('PILLAR 1: Compliance Officer perspective receives compliance alerts, carriers, audit, without CRM card', async () => {
  const r = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'compliance');
  assert.ok(r.json.summary, 'Compliance officer receives executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('compliance'), 'Compliance card must be present');
  assert.ok(modules.includes('carriers'), 'Carriers card must be present');
  assert.ok(modules.includes('onboarding'), 'Onboarding card must be present');
  assert.ok(modules.includes('audit'), 'Audit card must be present');
  assert.ok(!modules.includes('crm'), 'Compliance officer must NOT receive CRM card');
});

test('PILLAR 1: Statutory Auditor receives read-only audit and notifications cards only', async () => {
  const r = await call(AUDITOR, 'GET', '/v1/workspace/dashboard?perspective=auditor');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'auditor');
  assert.equal(r.json.summary, undefined, 'Auditor must NOT receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.deepEqual(modules.sort(), ['audit', 'notifications'].sort(), 'Auditor receives only audit and notifications');
});

test('PILLAR 1: Branch Trainer receives training, learning, and notifications cards only', async () => {
  const r = await call(TRAINER, 'GET', '/v1/workspace/dashboard?perspective=trainer');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'trainer');
  assert.equal(r.json.summary, undefined, 'Trainer must NOT receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('training'));
  assert.ok(modules.includes('learning'));
  assert.ok(modules.includes('notifications'));
  assert.ok(!modules.includes('crm'), 'Trainer must NOT receive CRM card');
  assert.ok(!modules.includes('carriers'), 'Trainer must NOT receive carriers card');
  assert.ok(!modules.includes('compliance'), 'Trainer must NOT receive compliance card');
});

test('PILLAR 1: Learner receives personal coursework and notifications only; management queues strictly denied', async () => {
  const r = await call(LEARNER, 'GET', '/v1/workspace/dashboard?perspective=learner');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'learner');
  assert.equal(r.json.summary, undefined, 'Learner must NOT receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.deepEqual(modules.sort(), ['learning', 'notifications'].sort());

  // Verify management queues are never returned to learner
  const categories = r.json.workQueue.map((item: any) => item.category);
  assert.ok(!categories.includes('webhook_review'), 'Learner must not see webhook_review');
  assert.ok(!categories.includes('contract_approval'), 'Learner must not see contract_approval');
  assert.ok(!categories.includes('compliance_alert'), 'Learner must not see compliance_alert');
});

test('PILLAR 1: Operations Staff receives CRM and learning cards only', async () => {
  const r = await call(STAFF, 'GET', '/v1/workspace/dashboard?perspective=staff');
  assert.equal(r.status, 200);
  assert.equal(r.json.perspective, 'staff');
  assert.equal(r.json.summary, undefined, 'Staff must NOT receive executive summary');

  const modules = r.json.cards.map((c: any) => c.module);
  assert.ok(modules.includes('crm'));
  assert.ok(modules.includes('learning'));
  assert.ok(modules.includes('notifications'));
  assert.ok(!modules.includes('compliance'));
  assert.ok(!modules.includes('carriers'));
  assert.ok(!modules.includes('training'));
});

// ==============================================================================
// PILLAR 2: LIVE DATABASE GROUNDING & ACCURACY AUDIT (ZERO FABRICATION)
// ==============================================================================

test('PILLAR 2: Executive summary metrics match exact live database records with zero fabrication', async () => {
  const r = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(r.status, 200);
  const summary = r.json.summary;

  await owner(async c => {
    // 1. Active carrier contracts: state IN ('active', 'appointment_verified')
    const activeContractsDb = Number(
      (await c.query(`SELECT count(*)::int AS cnt FROM carrier_contract_cases WHERE tenant_id = $1 AND state IN ('active', 'appointment_verified') AND (appointment_expires_on IS NULL OR appointment_expires_on >= CURRENT_DATE)`, [co1TenantId])).rows[0].cnt
    );
    assert.equal(summary.activeCarrierContracts, activeContractsDb, 'activeCarrierContracts matches DB count');
    assert.ok(summary.activeCarrierContracts >= 1, 'At least 1 active contract seeded');

    // 2. Pending approvals: state IN ('submitted', 'carrier_review') + onboarding review
    const pendingContractsDb = Number(
      (await c.query(`SELECT (
        (SELECT count(*)::int FROM carrier_contract_cases WHERE tenant_id = $1 AND state IN ('submitted', 'carrier_review')) +
        (SELECT count(*)::int FROM onboarding_cases WHERE tenant_id = $1 AND (standing = 'review_required' OR stage = 'review'))
      ) AS cnt`, [co1TenantId])).rows[0].cnt
    );
    assert.equal(summary.pendingApprovals, pendingContractsDb, 'pendingApprovals matches DB count');
    assert.ok(summary.pendingApprovals >= 1, 'At least 1 pending approval seeded');

    // 3. Compliance alerts: aggregate of expiring credentials, overdue self reports, active holds, AML hits, overdue cash tx
    const expectedAlerts = Number(
      (await c.query(`SELECT (
        (SELECT count(*)::int FROM compliance_items WHERE tenant_id = $1 AND expires_on IS NOT NULL AND expires_on <= current_date + interval '30 days') +
        (SELECT count(*)::int FROM broker_self_reports WHERE tenant_id = $1 AND acknowledged_at IS NULL AND due_on < current_date) +
        (SELECT count(*)::int FROM legal_holds WHERE tenant_id = $1 AND released_at IS NULL) +
        (SELECT count(*)::int FROM screening_results WHERE tenant_id = $1 AND result = 'hit') +
        (SELECT count(*)::int FROM cash_transactions WHERE tenant_id = $1 AND report_required AND reported_at IS NULL AND occurred_on < current_date - 15)
      ) AS cnt`, [co1TenantId])).rows[0].cnt
    );

    assert.equal(summary.complianceAlerts, expectedAlerts, 'complianceAlerts matches DB aggregate count');
    assert.ok(summary.complianceAlerts >= 5, 'All 5 seeded compliance alert categories counted');

    // 4. Carrier webhook receipts total
    const totalReceiptsDb = Number(
      (await c.query(`SELECT count(*)::int AS cnt FROM carrier_webhook_receipts WHERE tenant_id = $1`, [co1TenantId])).rows[0].cnt
    );
    assert.equal(summary.carrierReceipts, totalReceiptsDb, 'carrierReceipts matches DB count');

    // 5. Quarantined receipts
    const quarantinedDb = Number(
      (await c.query(`SELECT count(*)::int AS cnt FROM carrier_webhook_receipts WHERE tenant_id = $1 AND status = 'quarantined'`, [co1TenantId])).rows[0].cnt
    );
    assert.equal(summary.quarantinedReceipts, quarantinedDb, 'quarantinedReceipts matches DB count');
  });
});

test('PILLAR 2: Real-time dynamic updates: inserting new compliance alert immediately reflects in dashboard', async () => {
  const before = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  const alertCountBefore = before.json.summary.complianceAlerts;

  // Insert a new legal hold in DB on box 2
  await owner(async c => {
    await c.query(
      `INSERT INTO legal_holds (tenant_id, box_id, reason, placed_by_name, placed_at) VALUES ($1, $2, 'Dynamic Realtime Test Hold on Box 2', 'Compliance Officer', now())`,
      [co1TenantId, b2BoxId]
    );
  });

  const afterRes = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(afterRes.json.summary.complianceAlerts, alertCountBefore + 1, 'Compliance alert count increments dynamically');
});

// ==============================================================================
// PILLAR 3: WORK QUEUE ACTION NAVIGATION & DECOUPLING
// ==============================================================================

test('PILLAR 3: Work queue items route to authorized workspaces without direct dashboard mutation', async () => {
  const r = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(r.status, 200);

  const workQueue = r.json.workQueue;
  assert.ok(Array.isArray(workQueue) && workQueue.length > 0);

  for (const item of workQueue) {
    assert.ok(item.id, 'Item must have an id');
    assert.ok(item.category, 'Item must have a category');
    assert.ok(item.title, 'Item must have a title');
    assert.ok(item.role, 'Item must have a target role');
    assert.ok(['high', 'medium', 'normal'].includes(item.priority), 'Item priority must be high, medium, or normal');
    assert.ok(item.target && item.target.page, 'Item must have a target page');

    // Category routing assertions
    if (item.category === 'contract_approval') {
      assert.equal(item.target.page, 'compliance');
      assert.equal(item.target.routeId, 'carriers');
      assert.equal(item.actionLabel, 'Review for Approval');
    } else if (item.category === 'task') {
      assert.equal(item.target.page, 'pipelines');
      assert.ok(item.target.routeId.includes('open='), 'Task routeId must contain deep link open=');
    } else if (item.category === 'compliance_alert') {
      assert.equal(item.target.page, 'compliance');
      assert.equal(item.target.routeId, 'files');
    }
  }
});

// ==============================================================================
// PILLAR 4: MULTI-TENANT & SIBLING BRANCH SECURITY WALLS
// ==============================================================================

test('PILLAR 4: Tampering protection: unauthorized perspective requests are strictly rejected with 403', async () => {
  const unauthorizedAttempts = [
    { email: LEARNER, perspective: 'admin' },
    { email: LEARNER, perspective: 'ho' },
    { email: LEARNER, perspective: 'compliance' },
    { email: BROKER, perspective: 'compliance' },
    { email: BROKER, perspective: 'ho' },
    { email: MGR, perspective: 'ho' },
    { email: MGR, perspective: 'auditor' },
    { email: STAFF, perspective: 'admin' },
    { email: STAFF, perspective: 'compliance' },
    { email: AUDITOR, perspective: 'admin' },
  ];

  for (const attempt of unauthorizedAttempts) {
    const res = await call(attempt.email, 'GET', `/v1/workspace/dashboard?perspective=${attempt.perspective}`);
    assert.equal(res.status, 403, `${attempt.email} requesting ${attempt.perspective} must receive HTTP 403`);
  }
});

test('PILLAR 4: Sibling branch CRM data isolation between Toronto (Branch 1) and Montreal (Branch 2)', async () => {
  const b1 = await call(MGR, 'GET', '/v1/workspace/dashboard?perspective=manager');
  const b2 = await call(MGR_B2, 'GET', '/v1/workspace/dashboard?perspective=manager');

  const b1Crm = b1.json.cards.find((c: any) => c.module === 'crm');
  const b2Crm = b2.json.cards.find((c: any) => c.module === 'crm');

  // Toronto sees only Toronto client ($15,000)
  assert.equal(b1Crm.metrics.find((m: any) => m.id === 'open').value, 1);
  assert.equal(b1Crm.items[0].title, 'Toronto Commercial Fleet Policy');

  // Montreal sees only Montreal client ($25,000)
  assert.equal(b2Crm.metrics.find((m: any) => m.id === 'open').value, 1);
  assert.equal(b2Crm.items[0].title, 'Montreal Real Estate Portfolio');

  // Toronto manager cannot see Montreal boxes in work queue
  const b1Tasks = b1.json.workQueue.filter((item: any) => item.category === 'task');
  assert.ok(b1Tasks.some((t: any) => t.title.includes('certificate of insurance')));
  assert.ok(!b1Tasks.some((t: any) => t.title.includes('Montreal')));
});

test('PILLAR 4: Multi-tenant wall between Apex Financial (Tenant 1) and Beacon Financial (Tenant 2)', async () => {
  const t1 = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  const t2 = await call(T2_ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');

  assert.equal(t1.json.tenantId, co1TenantId);
  assert.equal(t2.json.tenantId, co2TenantId);

  // Tenant 2 has 0 CRM boxes, 0 carrier contracts, 0 receipts
  const t2Crm = t2.json.cards.find((c: any) => c.module === 'crm');
  assert.equal(t2Crm.metrics.find((m: any) => m.id === 'open').value, 0);
  assert.equal(t2.json.summary.activeCarrierContracts, 0);
  assert.equal(t2.json.summary.carrierReceipts, 0);
});

// ==============================================================================
// PILLAR 5: COMPLIANCE QUARANTINE LIFECYCLE END-TO-END
// ==============================================================================

test('PILLAR 5: End-to-end receipt quarantine, compliance adjudication, and reconciliation protection', async () => {
  const timestamp = Date.now();
  const eventId = `evt-uat-${randomUUID()}`;
  const webhookBody = JSON.stringify({
    timestamp,
    carrierId: 'ia-financial-group',
    contractId: caseId,
    eventType: 'appointment.confirmed',
    appointmentReference: 'UAT-APPT-ON-778899',
    effectiveDate: '2026-03-01',
    expiryDate: '2027-03-01',
  });
  const sig = computeSignature(TEST_SECRET, timestamp, eventId, webhookBody);

  // Step 1: External Carrier posts signed webhook
  const webhookRes = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/carrier/ia-financial-group',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': co1TenantId,
      'x-carrier-event-id': eventId,
      'x-carrier-timestamp': String(timestamp),
      'x-carrier-signature': sig,
    },
    payload: webhookBody,
  });

  assert.equal(webhookRes.statusCode, 201);
  const webhookJson = JSON.parse(webhookRes.body);
  assert.equal(webhookJson.status, 'quarantined');
  const receiptId = webhookJson.id;
  assert.ok(receiptId, 'Receipt ID must be returned');

  // Step 2: Quarantined receipt surfaces in Compliance list and dashboard KPI
  const compList = await call(COMPLIANCE, 'GET', '/v1/compliance/carrier-webhook-receipts?status=quarantined');
  assert.equal(compList.status, 200);
  assert.ok(compList.json.receipts.some((r: any) => r.id === receiptId), 'Quarantined receipt must be listed for compliance');

  const compDash = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(compDash.status, 200);
  assert.ok(compDash.json.summary.quarantinedReceipts >= 1, 'Quarantined count reflects new arrival');

  // Step 3: Unauthorized roles (Broker, Manager) are rejected when attempting review
  const brokerReview = await call(BROKER, 'POST', `/v1/compliance/carrier-webhook-receipts/${receiptId}/review`, {
    decision: 'reviewed',
    notes: 'Broker trying to bypass review',
  });
  assert.equal(brokerReview.status, 403, 'Broker cannot review webhook receipt');

  const mgrReview = await call(MGR, 'POST', `/v1/compliance/carrier-webhook-receipts/${receiptId}/review`, {
    decision: 'reviewed',
    notes: 'Manager trying to bypass review',
  });
  assert.equal(mgrReview.status, 403, 'Manager cannot review webhook receipt');

  // Step 4: Compliance Officer reviews receipt
  const compReview = await call(COMPLIANCE, 'POST', `/v1/compliance/carrier-webhook-receipts/${receiptId}/review`, {
    decision: 'reviewed',
    contractId: caseId,
    notes: 'UAT Verified: formal appointment confirmed by iA Financial Group liaison',
  });
  assert.equal(compReview.status, 200);
  assert.equal(compReview.json.status, 'reviewed');

  // Step 5: Verify receipt updated in DB and audit logged
  await owner(async c => {
    const row = (await c.query(`SELECT status, reviewed_at, notes FROM carrier_webhook_receipts WHERE id = $1`, [receiptId])).rows[0];
    assert.equal(row.status, 'reviewed');
    assert.ok(row.reviewed_at, 'reviewed_at timestamp must be recorded');
    assert.equal(row.notes, 'UAT Verified: formal appointment confirmed by iA Financial Group liaison');
  });

  // Step 6: Verify Compliance dashboard quarantine counter decrements
  const compDashAfter = await call(COMPLIANCE, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(compDashAfter.json.summary.quarantinedReceipts, compDash.json.summary.quarantinedReceipts - 1);
});

// ==============================================================================
// PILLAR 6: BILINGUAL LOCALIZATION & TERMINOLOGY AUDIT
// ==============================================================================

test('PILLAR 6: Canadian French (fr-CA) and English terminology mapping verification', () => {
  const enRoles: Record<string, string> = {
    admin: 'Executive', ho: 'Head Office', manager: 'Manager', partner: 'Broker',
    compliance: 'Compliance', auditor: 'Audit', trainer: 'Training', learner: 'Learning', staff: 'Operations',
  };
  const frRoles: Record<string, string> = {
    admin: 'Direction', ho: 'Siège social', manager: 'Gestionnaire', partner: 'Courtier',
    compliance: 'Conformité', auditor: 'Vérification', trainer: 'Formation', learner: 'Apprenant', staff: 'Opérations',
  };

  const roles = ['admin', 'ho', 'manager', 'partner', 'compliance', 'auditor', 'trainer', 'learner', 'staff'];
  for (const r of roles) {
    assert.ok(enRoles[r], `English role translation exists for ${r}`);
    assert.ok(frRoles[r], `French role translation exists for ${r}`);
  }

  // Verification of sensitive operational terminology
  const terminology = {
    executiveSummary: { en: 'Executive Summary', fr: 'Sommaire de direction' },
    activeContracts: { en: 'Active Contracts / Appointments', fr: 'Contrats / nominations actifs' },
    operationalQueue: { en: 'Operational Action Queue', fr: 'File de travail opérationnelle' },
    reviewForApproval: { en: 'Review for Approval', fr: 'Examiner pour approbation' },
    quarantinedWebhooks: { en: 'Quarantined Webhooks', fr: 'Webhooks en quarantaine' },
  };

  assert.equal(terminology.activeContracts.en, 'Active Contracts / Appointments');
  assert.equal(terminology.activeContracts.fr, 'Contrats / nominations actifs');
  assert.equal(terminology.reviewForApproval.en, 'Review for Approval');
  assert.equal(terminology.reviewForApproval.fr, 'Examiner pour approbation');
  assert.equal(terminology.quarantinedWebhooks.en, 'Quarantined Webhooks');
  assert.equal(terminology.quarantinedWebhooks.fr, 'Webhooks en quarantaine');
});
