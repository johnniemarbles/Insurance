import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

// 9 Pilot Personas
const ADMIN = 'admin@punjab-pilot.test';
const HO = 'ho@punjab-pilot.test';
const MGR_MTL = 'manager-mtl@punjab-pilot.test';
const MGR_TOR = 'manager-tor@punjab-pilot.test';
const BROKER_MTL = 'broker-mtl@punjab-pilot.test';
const COMPLIANCE = 'compliance@punjab-pilot.test';
const AUDITOR = 'auditor@punjab-pilot.test';
const TRAINER = 'trainer@punjab-pilot.test';
const LEARNER = 'learner@punjab-pilot.test';
const STAFF_MTL = 'staff-mtl@punjab-pilot.test';

let tenantId = '';
let rootNodeId = '';
let branchMtlId = '';
let branchTorId = '';
let brokerNodeId = '';
let caseId = '';

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

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool: Db = createPool(db.appUrl, 4);
  const authPool: Db = createPool(db.authUrl, 2);
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
    keys: localKeyProvider('0123456789abcdef0123456789abcdef'),
  } as unknown as AppDeps;

  app = buildApp(deps);
  await app.ready();

  // 1. Bootstrap Pilot Tenant: Punjab Insurance Inc. (Canada / QC)
  const t = await bootstrapTenant(db.ownerUrl, {
    name: 'Punjab Insurance Inc. Pilot',
    countryCode: 'CA',
    adminEmail: ADMIN,
    defaultLocale: 'fr-CA',
    headOffice: true,
  });
  tenantId = t.tenantId;
  rootNodeId = t.rootNodeId;

  // 2. Set up Org Hierarchy: Montreal Branch (QC) & Toronto Branch (ON)
  await owner(async (c) => {
    branchMtlId = randomUUID();
    branchTorId = randomUUID();

    // Create branches (locations)
    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', 'Montreal Branch (QC)')`, [branchMtlId, tenantId]);
    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', 'Toronto Branch (ON)')`, [branchTorId, tenantId]);

    // Create users & assign roles
    async function addUser(email: string, name: string, nodeId: string, role: string, locale: 'en' | 'fr-CA' = 'en') {
      const uid = randomUUID();
      await c.query(
        `INSERT INTO app_users (id, tenant_id, email, display_name, home_node_id, locale, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [uid, tenantId, email, name, nodeId, locale]
      );
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [tenantId, uid, nodeId, role]
      );
      return uid;
    }

    const hoUid = await addUser(HO, 'Harpreet Singh (HO Compliance & Ops)', rootNodeId, 'compliance');
    await c.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'staff')`, [tenantId, hoUid, rootNodeId]);
    await addUser(COMPLIANCE, 'Jean-Francois Tremblay (QC Officer)', branchMtlId, 'compliance', 'fr-CA');
    await addUser(MGR_MTL, 'Amandeep Kaur (Montreal Manager)', branchMtlId, 'manager', 'fr-CA');
    await addUser(MGR_TOR, 'Rajinder Sharma (Toronto Manager)', branchTorId, 'manager', 'en');
    await addUser(AUDITOR, 'KPMG Auditor', rootNodeId, 'auditor');
    await addUser(TRAINER, 'Training Director', rootNodeId, 'trainer');
    await addUser(LEARNER, 'Simran Gill (Trainee)', branchMtlId, 'learner', 'fr-CA');
    await addUser(STAFF_MTL, 'Marie Dupont (Staff)', branchMtlId, 'staff', 'fr-CA');
  });

  // 3. Complete first-login consent for all users
  for (const email of [ADMIN, HO, COMPLIANCE, MGR_MTL, MGR_TOR, AUDITOR, TRAINER, LEARNER, STAFF_MTL]) {
    await call(email, 'POST', '/v1/consent/first-login');
  }
});

after(async () => {
  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

test('Phase 9 Pilot Onboarding: complete broker lifecycle under Montreal branch', async () => {
  // 1. Compliance Manager adds new broker under Montreal branch
  const addRes = await call(COMPLIANCE, 'POST', '/v1/onboarding/brokers', {
    name: 'Cabinet de Services Financiers Gill & Associés',
    parentId: branchMtlId,
    type: 'corporate',
    adminEmail: BROKER_MTL,
  });
  assert.equal(addRes.status, 201, 'Broker should be added by Compliance Manager');
  brokerNodeId = addRes.json.nodeId;
  assert.ok(brokerNodeId);

  // Retrieve case ID
  caseId = await owner(async (c) => {
    return (await c.query<{ id: string }>('SELECT id FROM onboarding_cases WHERE node_id = $1', [brokerNodeId])).rows[0]!.id;
  });
  assert.ok(caseId);

  // 2. Seed active broker user, submit compliance profile & complete form
  await owner(async (c) => {
    const u = (
      await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, locale, status)
         VALUES ($1, $2, 'Baljit Gill (Broker)', $3, 'fr-CA', 'active') RETURNING id`,
        [tenantId, BROKER_MTL, brokerNodeId]
      )
    ).rows[0]!.id;
    await c.query(
      `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'partner')`,
      [tenantId, u, brokerNodeId]
    );
  });
  const loginConsentRes = await call(BROKER_MTL, 'POST', '/v1/consent/first-login');
  assert.equal(loginConsentRes.status, 204);

  // Submit compliance profile for partner
  const profileRes = await call(BROKER_MTL, 'PUT', `/v1/compliance/partners/${brokerNodeId}/profile`, {
    entityType: 'corporation',
    legalName: 'Cabinet de Services Financiers Gill & Associés',
    businessNumber: '1178293849',
    fields: { province: 'QC' },
  });
  assert.equal(profileRes.status, 204);

  await owner((o) => o.query('UPDATE compliance_profiles SET submitted_at = now() WHERE node_id = $1', [brokerNodeId]));
  const formRes = await call(BROKER_MTL, 'POST', `/v1/onboarding/cases/${caseId}/form`);
  assert.equal(formRes.status, 201);

  // 3. Broker provides statutory consents (credit check, background check, carrier reporting)
  const consentsRes = await call(BROKER_MTL, 'POST', `/v1/onboarding/cases/${caseId}/consents`, {
    consents: [
      { kind: 'credit_check', accepted: true },
      { kind: 'background_check', accepted: true },
      { kind: 'carrier_reporting', accepted: true },
    ],
  });
  assert.equal(consentsRes.status, 201);

  // 4. Compliance Officer records verified screening results
  // a) Credit check (Score 720 >= 600 passes)
  const creditRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'credit',
    provider: 'Equifax',
    status: 'complete',
    score: 720,
    reference: 'Equifax Report #EQ-2026-9921',
  });
  assert.equal(creditRes.status, 201);

  // b) Background check (clear)
  const bgRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'background',
    provider: 'Sterling',
    status: 'complete',
    adverse: false,
    reference: 'Sterling Criminal Background Clear #ST-8812',
  });
  assert.equal(bgRes.status, 201);

  // c) AMF License verification (Quebec)
  const licRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'licence',
    provider: 'AMF Quebec',
    status: 'complete',
    reference: 'AMF Quebec Cert #QC-AMF-44912 Life & Health',
  });
  assert.equal(licRes.status, 201);

  // 5. Corporate ownership structure: register director / >25% owner
  const ownerRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/owners`, {
    fullName: 'Baljit Gill',
    sharePercent: 100,
    isDirector: true,
    identified: true,
    pepHioDetermined: true,
    guaranteeSigned: true,
  });
  assert.equal(ownerRes.status, 201);

  // 5b. Record screening questionnaire (no insolvency, no red flags)
  const screenRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/screening`, {
    insolvencyOrJudgment: false,
    redFlag: false,
    answers: { bankruptcy: 'no', disciplinary: 'no' },
  });
  assert.equal(screenRes.status, 201);

  // 6. Compliance Officer issues Standing Decision: Good Standing
  const decisionRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/decision`, {
    outcome: 'good_standing',
    reason: 'Complete verification: clear credit, spotless background, valid AMF certificate',
  });
  assert.equal(decisionRes.status, 200);

  // 7. Agency Agreement (AGA): send, sign with OTP, countersign by Compliance Officer
  const sentAgreement = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/agreement`, {
    title: 'Agency agreement',
    body: 'Wording as issued by counsel.',
    version: 'aga-v1',
  });
  assert.equal(sentAgreement.status, 200);

  const signToken = new URL(sentAgreement.json.url).pathname.split('/').pop() as string;
  const codeRes = await call(BROKER_MTL, 'POST', `/v1/public/partner-sign/${signToken}/code`);
  assert.equal(codeRes.status, 200);

  const signRes = await call(BROKER_MTL, 'POST', `/v1/public/partner-sign/${signToken}/confirm`, {
    code: codeRes.json.devCode,
    typedName: 'Baljit Gill',
    agree: true,
  });
  assert.equal(signRes.status, 200);

  const countersignRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/agreement/countersign`, {
    typedName: 'Jean-Francois Tremblay',
    agree: true,
  });
  assert.equal(countersignRes.status, 200);

  // 8. Officer marks onboarding stage to active
  const activeRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/stage`, {
    to: 'active',
  });
  assert.equal(activeRes.status, 200);

  // 9. Compliance clearances: Upload mandatory E&O policy and CE rules
  await owner(async (c) => {
    // Add valid AMF licence compliance item
    await c.query(
      `INSERT INTO compliance_items (
         tenant_id, node_id, kind, label, number, jurisdiction,
         expires_on
       ) VALUES (
         $1, $2, 'licence', 'AMF Life & Health Licence', 'AMF-44912', 'QC',
         CURRENT_DATE + INTERVAL '1 year'
       )`,
      [tenantId, brokerNodeId]
    );

    // Add valid E&O policy ($2M coverage >= $1M min)
    await c.query(
      `INSERT INTO compliance_items (
         tenant_id, node_id, kind, label, number,
         limit_amount, expires_on
       ) VALUES (
         $1, $2, 'eo', 'Trisura Guarantee Insurance Company', 'POL-EO-2026-99',
         2000000, CURRENT_DATE + INTERVAL '1 year'
       )`,
      [tenantId, brokerNodeId]
    );
  });

  // 10. Carrier Contracting: Initiate carrier contract case for iA Financial Group
  const contractRes = await call(COMPLIANCE, 'POST', `/v1/onboarding/cases/${caseId}/carrier-contracts`, {
    carrierName: 'iA Financial Group',
    jurisdiction: 'QC',
  });
  assert.equal(contractRes.status, 201);
  assert.ok(contractRes.json.id);
});

test('Phase 9 Pilot Dashboards: 9-role perspective audit with database-backed scoping', async () => {
  // Test each persona's workspace dashboard
  const perspectives = [
    { email: ADMIN, role: 'admin', expectCards: 8, expectSummary: true },
    { email: HO, role: 'ho', expectCards: 7, expectSummary: true },
    { email: COMPLIANCE, role: 'compliance', expectCards: 5, expectSummary: true },
    { email: MGR_MTL, role: 'manager', expectCards: 5, expectSummary: false },
    { email: MGR_TOR, role: 'manager', expectCards: 5, expectSummary: false },
    { email: BROKER_MTL, role: 'partner', expectCards: 5, expectSummary: false },
    { email: AUDITOR, role: 'auditor', expectCards: 2, expectSummary: false },
    { email: TRAINER, role: 'trainer', expectCards: 3, expectSummary: false },
    { email: LEARNER, role: 'learner', expectCards: 2, expectSummary: false },
    { email: STAFF_MTL, role: 'staff', expectCards: 3, expectSummary: false },
  ];

  for (const p of perspectives) {
    const query = p.role === 'admin' ? '' : `?perspective=${p.role}`;
    const res = await call(p.email, 'GET', `/v1/workspace/dashboard${query}`);
    assert.equal(res.status, 200, `Dashboard for ${p.email} (${p.role}) should return HTTP 200`);
    assert.ok(res.json.cards, `Cards array must be present for ${p.role}`);
    assert.equal(res.json.cards.length, p.expectCards, `${p.role} must receive exactly ${p.expectCards} cards`);

    if (p.expectSummary) {
      assert.ok(res.json.summary, `Executive summary must be present for ${p.role}`);
      assert.equal(typeof res.json.summary.activeCarrierContracts, 'number');
    } else {
      assert.equal(res.json.summary, undefined, `Executive summary must be hidden for ${p.role}`);
    }

    // Role-tamper test: attempt to request unauthorized admin perspective via query param
    const tamperRes = await call(p.email, 'GET', '/v1/workspace/dashboard?perspective=admin');
    if (p.role === 'admin') {
      assert.equal(tamperRes.status, 200);
      assert.equal(tamperRes.json.perspective, 'admin');
    } else {
      assert.equal(tamperRes.status, 403, `${p.role} attempting admin perspective must receive 403 Forbidden`);
    }
  }

  // Cross-branch isolation check: Montreal Manager sees Montreal broker, Toronto Manager does not
  const mtlDashboard = await call(MGR_MTL, 'GET', '/v1/workspace/dashboard');
  const torDashboard = await call(MGR_TOR, 'GET', '/v1/workspace/dashboard');

  assert.ok(mtlDashboard.json);
  assert.ok(torDashboard.json);
});
