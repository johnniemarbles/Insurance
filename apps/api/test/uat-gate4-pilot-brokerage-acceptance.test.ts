import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { createPool, signInWithGoogle, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import {
  loadConfig,
  localKeyProvider,
  bootstrapPilotBrokerage,
  generatePilotCarrierCsv,
  assertExternalCarrierDispatch,
  type PilotBrokerageResult,
} from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;
let pilot: PilotBrokerageResult;

// Pilot Personas
const ADMIN = 'admin@punjab-pilot.test';
const HO = 'ho@punjab-pilot.test';
const COMPLIANCE_QC = 'compliance-qc@punjab-pilot.test';
const COMPLIANCE_ON = 'compliance-on@punjab-pilot.test';
const MGR_MTL = 'manager-mtl@punjab-pilot.test';
const MGR_TOR = 'manager-tor@punjab-pilot.test';
const MGR_VAN = 'manager-van@punjab-pilot.test';
const BROKER_MTL = 'broker-mtl@punjab-pilot.test';
const BROKER_TOR = 'broker-tor@punjab-pilot.test';
const FINANCE = 'finance@punjab-pilot.test';
const AUDITOR = 'auditor@punjab-pilot.test';
const TRAINER = 'trainer@punjab-pilot.test';
const LEARNER = 'learner@punjab-pilot.test';
const STAFF_MTL = 'staff-mtl@punjab-pilot.test';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function call(email: string, method: HttpMethod, url: string, body?: unknown, headers?: Record<string, string>) {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-dev-user-email': email,
      ...(headers ?? {}),
    },
    ...(body ? { payload: body as object } : {}),
  });
  return {
    status: res.statusCode,
    json: res.body ? (JSON.parse(res.body) as any) : null,
    raw: res.body,
  };
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

  // Bootstrap Punjab Insurance Inc. Pilot Organization
  pilot = await bootstrapPilotBrokerage(db.ownerUrl);
});

after(async () => {
  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

test('Master Gate 4 Acceptance: Complete Pilot Brokerage Operating System Verification', async () => {
  // =========================================================================
  // Workstream 1: Pilot Brokerage Organization Hierarchy & Invariant Verification
  // =========================================================================
  assert.ok(pilot.tenantId, 'Tenant ID must be present');
  assert.ok(pilot.rootNodeId, 'Root node ID must be present');
  assert.ok(pilot.adminUserId, 'Admin user ID must be present');

  // Verify 3 Regional Branches
  assert.equal(pilot.branches.montreal?.jurisdiction, 'QC');
  assert.equal(pilot.branches.montreal?.locale, 'fr-CA');
  assert.equal(pilot.branches.toronto?.jurisdiction, 'ON');
  assert.equal(pilot.branches.toronto?.locale, 'en');
  assert.equal(pilot.branches.vancouver?.jurisdiction, 'BC');
  assert.equal(pilot.branches.vancouver?.locale, 'en');

  // Verify Corporate Partner Firms
  assert.equal(pilot.partners.montreal?.name, 'Cabinet de Services Financiers Gill & Associés');
  assert.equal(pilot.partners.toronto?.name, 'Maple Ridge Wealth & Insurance Services');
  assert.equal(pilot.partners.vancouver?.name, 'Pacific Rim Advisory Group');

  // Database invariants check
  await owner(async (c) => {
    const tRow = (await c.query('SELECT name, is_head_office, default_locale FROM tenants WHERE id = $1', [pilot.tenantId])).rows[0];
    assert.equal(tRow?.name, 'Punjab Insurance Inc. (Pilot)');
    assert.equal(tRow?.is_head_office, true);
    assert.equal(tRow?.default_locale, 'fr-CA');

    const nodeCount = (await c.query('SELECT count(*) FROM org_nodes WHERE tenant_id = $1', [pilot.tenantId])).rows[0]?.count;
    // 1 root + 3 branches + 3 partners = 7 nodes
    assert.equal(Number(nodeCount), 7);

    const linkCount = (await c.query("SELECT count(*) FROM org_links WHERE tenant_id = $1 AND kind = 'location_link'", [pilot.tenantId])).rows[0]?.count;
    // 3 branches linked to 3 partners
    assert.equal(Number(linkCount), 3);
  });

  // =========================================================================
  // Workstream 2: Google SSO Onboarding, Multi-Tenant Isolation & Statutory Privacy Consents
  // =========================================================================
  // 1. Generate invitation for a new pilot advisor
  const inviteEmail = 'invited-advisor@punjab-pilot.test';
  const inviteToken = 'inv_tok_' + randomUUID().replace(/-/g, '');
  const tokenHash = createHash('sha256').update(inviteToken).digest();

  await owner(async (c) => {
    await c.query(
      `INSERT INTO invitations (
         id, tenant_id, node_id, role, email, locale, token_hash, expires_at
       ) VALUES (
         gen_random_uuid(), $1, $2, 'partner', $3, 'fr-CA', $4, now() + interval '7 days'
       )`,
      [pilot.tenantId, pilot.partners.montreal!.id, inviteEmail, tokenHash],
    );
  });

  // 2. Test Google SSO sign-in with invitation token
  // Mismatched email rejected
  const mismatchRes = await signInWithGoogle(deps.authPool, {
    sub: 'google-sub-999',
    email: 'wrong-email@other.test',
  }, { inviteToken });
  assert.equal(mismatchRes.ok, false);
  assert.equal(mismatchRes.reason, 'email_mismatch');

  // Valid Google SSO invitation acceptance
  const validGoogleRes = await signInWithGoogle(deps.authPool, {
    sub: 'google-sub-advisor-001',
    email: inviteEmail,
    name: 'Trainee Advisor',
  }, { inviteToken });
  assert.equal(validGoogleRes.ok, true);
  if (validGoogleRes.ok) {
    assert.equal(validGoogleRes.accepted, true);
    assert.equal(validGoogleRes.user.email, inviteEmail);
  }

  // Conflicting Google identity rejected
  const conflictRes = await signInWithGoogle(deps.authPool, {
    sub: 'google-sub-impostor-999',
    email: inviteEmail,
  });
  assert.equal(conflictRes.ok, false);
  assert.equal(conflictRes.reason, 'identity_conflict');

  // 3. Complete first-login statutory privacy consents across all personas
  const allPersonas = [
    ADMIN, HO, COMPLIANCE_QC, COMPLIANCE_ON,
    MGR_MTL, MGR_TOR, MGR_VAN,
    BROKER_MTL, BROKER_TOR, FINANCE,
    AUDITOR, TRAINER, LEARNER, STAFF_MTL,
    inviteEmail,
  ];

  for (const email of allPersonas) {
    const consentRes = await call(email, 'POST', '/v1/consent/first-login');
    assert.equal(consentRes.status, 204, `First-login consent for ${email} must succeed (204)`);
  }

  // 4. Multi-Tenant Candidate Selection & Conflict Verification
  // Create a second tenant where ADMIN is also invited
  let tenant2Id = '';
  await owner(async (c) => {
    tenant2Id = randomUUID();
    const root2 = randomUUID();
    await c.query("INSERT INTO tenants (id, name, country_code, region, default_locale) VALUES ($1, 'Second Brokerage Inc.', 'CA', 'ca-qc', 'en')", [tenant2Id]);
    await c.query("INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'tenant', 'Second Root')", [root2, tenant2Id]);
    await c.query(
      `INSERT INTO app_users (id, tenant_id, email, display_name, locale, status, home_node_id)
       VALUES (gen_random_uuid(), $1, $2, 'Harpreet Singh', 'en', 'active', $3)`,
      [tenant2Id, ADMIN, root2],
    );
  });

  // Calling without x-dev-tenant-id when in 2 tenants triggers 409 tenant_required
  const ambiguousRes = await call(ADMIN, 'GET', '/v1/workspace/dashboard');
  assert.equal(ambiguousRes.status, 409, 'Ambiguous tenant membership must require tenant selection (409)');
  assert.equal(ambiguousRes.json.error.code, 'tenant_required');

  // Calling WITH x-dev-tenant-id cleanly targets the specific tenant
  const scopedAdminRes = await call(ADMIN, 'GET', '/v1/workspace/dashboard', undefined, {
    'x-dev-tenant-id': pilot.tenantId,
  });
  assert.equal(scopedAdminRes.status, 200, 'Explicit tenant selection must succeed');
  assert.equal(scopedAdminRes.json.perspective, 'admin');

  // =========================================================================
  // Workstream 3: Quebec Bill 96 & Law 25 Regulatory Compliance
  // =========================================================================
  // 1. Verify Bill 96 French language compliance in Montreal Branch
  const montrealPartner = pilot.partners.montreal!;
  await owner(async (c) => {
    const qcUser = (await c.query('SELECT locale FROM app_users WHERE tenant_id = $1 AND email = $2', [pilot.tenantId, BROKER_MTL])).rows[0];
    assert.equal(qcUser?.locale, 'fr-CA', 'Quebec broker must have fr-CA locale under Bill 96');
  });

  // 2. Law 25 Statutory Consents & Screening Clearance
  // Create onboarding case for corporate broker
  const caseId = randomUUID();
  await owner(async (c) => {
    await c.query(
      `INSERT INTO onboarding_cases (
         id, tenant_id, node_id, country, stage, broker_type
       ) VALUES ($1, $2, $3, 'CA', 'form_submitted', 'corporate')`,
      [caseId, pilot.tenantId, montrealPartner.id],
    );
  });

  // Record 3 statutory consents under Law 25 & PIPEDA
  const consentsRes = await call(BROKER_MTL, 'POST', `/v1/onboarding/cases/${caseId}/consents`, {
    consents: [
      { kind: 'credit_check', accepted: true },
      { kind: 'background_check', accepted: true },
      { kind: 'carrier_reporting', accepted: true },
    ],
  });
  assert.equal(consentsRes.status, 201, 'Statutory consents recorded');

  // Record verified screening checks
  // a) Credit check (Score 720 >= 600 passes)
  const creditRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'credit',
    provider: 'Equifax Canada',
    status: 'complete',
    score: 720,
    reference: 'Equifax Report #EQ-QC-9921',
  });
  assert.equal(creditRes.status, 201);

  // b) Background check (clear)
  const bgRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'background',
    provider: 'Sterling BackCheck',
    status: 'complete',
    adverse: false,
    reference: 'Sterling Criminal Background Clear #ST-QC-8812',
  });
  assert.equal(bgRes.status, 201);

  // c) AMF License verification (Quebec)
  const licRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/checks`, {
    kind: 'licence',
    provider: 'AMF Quebec',
    status: 'complete',
    reference: 'AMF Quebec Cert #QC-AMF-44912 Life & Health',
  });
  assert.equal(licRes.status, 201);

  // Beneficial ownership disclosure (>25% shareholding, PEP/HIO clearance)
  const ownerRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/owners`, {
    fullName: 'Baljit Gill',
    sharePercent: 100,
    isDirector: true,
    identified: true,
    pepHioDetermined: true,
    guaranteeSigned: true,
  });
  assert.equal(ownerRes.status, 201, 'Beneficial ownership registered');

  // Record screening questionnaire (no insolvency, no red flags)
  const screenRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/screening`, {
    insolvencyOrJudgment: false,
    redFlag: false,
    answers: { bankruptcy: 'no', disciplinary: 'no' },
  });
  assert.equal(screenRes.status, 201);

  // Standing decision: Good Standing
  const decisionRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/decision`, {
    outcome: 'good_standing',
    reason: 'Complies with all Law 25, AMF licensing, and FINTRAC PEP requirements.',
  });
  assert.equal(decisionRes.status, 200, 'Compliance officer issues good standing');

  // Agency Agreement digital execution
  const agreementRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/agreement`, {
    title: 'Convention d’agence (AGA v1.0)',
    body: 'Contrat d’agence conforme au droit québécois.',
    version: 'aga-v1-qc',
  });
  assert.equal(agreementRes.status, 200);

  const signToken = new URL(agreementRes.json.url).pathname.split('/').pop() as string;
  const otpRes = await call(BROKER_MTL, 'POST', `/v1/public/partner-sign/${signToken}/code`);
  assert.equal(otpRes.status, 200);

  const signConfirmRes = await call(BROKER_MTL, 'POST', `/v1/public/partner-sign/${signToken}/confirm`, {
    code: otpRes.json.devCode,
    typedName: 'Baljit Gill',
    agree: true,
  });
  assert.equal(signConfirmRes.status, 200);

  const countersignRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/agreement/countersign`, {
    typedName: 'Jean-Francois Tremblay',
    agree: true,
  });
  assert.equal(countersignRes.status, 200);

  // Transition case to active
  const stageRes = await call(COMPLIANCE_QC, 'POST', `/v1/onboarding/cases/${caseId}/stage`, { to: 'active' });
  assert.equal(stageRes.status, 200);

  // =========================================================================
  // Workstream 4: End-to-End CRM Opportunity to Branch-Scoped Policy Issuance
  // =========================================================================
  // 1. Montreal Broker creates lead in starter pipeline
  const pipelineId = pilot.pipelineId;
  const leadRes = await call(BROKER_MTL, 'POST', '/v1/boxes', {
    pipelineId,
    name: 'Dossier Assurance Vie - Jean Tremblay',
  });
  assert.equal(leadRes.status, 201);
  const boxId = leadRes.json.id;

  // Move opportunity to won ('Policy Issued')
  const pipesRes = await call(BROKER_MTL, 'GET', '/v1/pipelines');
  const pipe = pipesRes.json.pipelines.find((p: any) => p.id === pipelineId);
  const wonStage = pipe.stages.find((s: any) => s.isWon);
  assert.ok(wonStage);

  const wonMoveRes = await call(BROKER_MTL, 'PATCH', `/v1/boxes/${boxId}`, {
    stageId: wonStage.id,
  });
  assert.equal(wonMoveRes.status, 204);

  // 2. Issue Policy under Montreal Branch
  const mtlPolicyRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/policies', {
    policyNumber: 'POL-IA-PILOT-QC-001',
    carrierId: 'ia-financial-group',
    producerNodeId: pilot.partners.montreal!.id,
    branchNodeId: pilot.branches.montreal!.id,
    planName: 'iA Term Life & Critical Illness (Pilot)',
    jurisdiction: 'QC',
    annualPremiumCents: 240000, // $2,400.00
    modalPremiumCents: 20000,   // $200.00/mo
    premiumFrequency: 'monthly',
    effectiveDate: '2026-10-01',
    status: 'active',
  });
  assert.equal(mtlPolicyRes.status, 201, 'Montreal policy created');
  const mtlPolicyId = mtlPolicyRes.json.policy.id;
  assert.ok(mtlPolicyId);

  // 3. Issue Policy under Toronto Branch
  const torPolicyRes = await call(COMPLIANCE_ON, 'POST', '/v1/commercial/policies', {
    policyNumber: 'POL-SL-PILOT-ON-002',
    carrierId: 'sun-life',
    producerNodeId: pilot.partners.toronto!.id,
    branchNodeId: pilot.branches.toronto!.id,
    planName: 'Sun Life Universal Wealth Plan (Pilot)',
    jurisdiction: 'ON',
    annualPremiumCents: 180000, // $1,800.00
    modalPremiumCents: 15000,   // $150.00/mo
    premiumFrequency: 'monthly',
    effectiveDate: '2026-10-01',
    status: 'active',
  });
  assert.equal(torPolicyRes.status, 201, 'Toronto policy created');

  // 4. Verify Branch Visibility Isolation
  // Montreal Manager sees Montreal policy, NOT Toronto policy
  const mtlPoliciesRes = await call(MGR_MTL, 'GET', `/v1/commercial/policies?branch_node_id=${pilot.branches.montreal!.id}`);
  assert.equal(mtlPoliciesRes.status, 200);
  const mtlPolNums = mtlPoliciesRes.json.policies.map((p: any) => p.policy_number);
  assert.ok(mtlPolNums.includes('POL-IA-PILOT-QC-001'), 'Montreal manager sees Montreal policy');
  assert.ok(!mtlPolNums.includes('POL-SL-PILOT-ON-002'), 'Montreal manager CANNOT see Toronto policy (RLS isolated)');

  // Toronto Manager sees Toronto policy, NOT Montreal policy
  const torPoliciesRes = await call(MGR_TOR, 'GET', `/v1/commercial/policies?branch_node_id=${pilot.branches.toronto!.id}`);
  assert.equal(torPoliciesRes.status, 200);
  const torPolNums = torPoliciesRes.json.policies.map((p: any) => p.policy_number);
  assert.ok(torPolNums.includes('POL-SL-PILOT-ON-002'), 'Toronto manager sees Toronto policy');
  assert.ok(!torPolNums.includes('POL-IA-PILOT-QC-001'), 'Toronto manager CANNOT see Montreal policy (RLS isolated)');

  // =========================================================================
  // Workstream 5: Contractual Commission Agreements & Overlap Protection
  // =========================================================================
  const mtlAgreement = pilot.commissionAgreements.montreal!;
  assert.equal(mtlAgreement.carrierId, 'ia-financial-group');
  assert.equal(mtlAgreement.holdbackBps, 0, 'Contractual 0% holdback for iA Montreal agreement');

  // Attempting to insert overlapping active agreement for Montreal partner & iA
  const overlapRes = await call(ADMIN, 'POST', '/v1/commercial/agreements', {
    producerNodeId: pilot.partners.montreal!.id,
    carrierId: 'ia-financial-group',
    version: 'v2.0-conflicting',
    brokerSplitBps: 6000,
    branchOverrideBps: 1500,
    mgaSpreadBps: 2500,
    holdbackBps: 0,
    effectiveFrom: '2026-06-01',
    effectiveTo: null,
    status: 'active',
  }, { 'x-dev-tenant-id': pilot.tenantId });

  assert.equal(overlapRes.status, 409, 'Overlapping active agreement must be rejected with 409 Conflict');
  assert.match(overlapRes.json.error.message, /overlaps with requested validity period/i);

  // =========================================================================
  // Workstream 6: Real Carrier Statement Import, Preview, Deduplication & Exception Resolution
  // =========================================================================
  // 1. Generate CSV statement containing:
  //    - Line 1: POL-IA-PILOT-QC-001 (matched to existing policy)
  //    - Line 2: POL-ORPHAN-QC-999 (unmatched exception)
  const csvContent = generatePilotCarrierCsv('ia-financial-group', [
    {
      policyNumber: 'POL-IA-PILOT-QC-001',
      clientName: 'Jean Tremblay',
      transactionType: 'first_year',
      grossAmountDollars: '1200.00',
      netAmountDollars: '1200.00',
      producerCode: 'QC-GILL-01',
    },
    {
      policyNumber: 'POL-ORPHAN-QC-999',
      clientName: 'Unmatched Client',
      transactionType: 'first_year',
      grossAmountDollars: '500.00',
      netAmountDollars: '500.00',
      producerCode: 'QC-GILL-01',
    },
  ]);

  // 2. Safe CSV Preview (No commit)
  const previewRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'ia-financial-group',
    csvContent,
  }, { 'x-dev-tenant-id': pilot.tenantId });
  assert.equal(previewRes.status, 200, 'CSV preview succeeds');
  assert.equal(previewRes.json.preview.isDuplicate, false);
  assert.equal(previewRes.json.preview.totalGrossCents, 170000); // $1,700.00
  assert.equal(previewRes.json.preview.matchedCount, 1);
  assert.equal(previewRes.json.preview.unmatchedCount, 1);

  // 3. Register CSV Statement Import
  const importRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'STMT-IA-PILOT-2026-10',
    statementDate: '2026-10-15',
    csvContent,
  }, { 'x-dev-tenant-id': pilot.tenantId });
  assert.equal(importRes.status, 201, 'CSV statement registered');
  const importId = importRes.json.import.id;
  assert.ok(importId);
  assert.equal(importRes.json.import.status, 'exceptions_flagged');
  assert.equal(importRes.json.import.matchedCount, 1);
  assert.equal(importRes.json.import.unmatchedCount, 1);

  // 4. Idempotency / Deduplication Guard: Re-uploading identical statement returns 409
  const dupRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'STMT-IA-PILOT-2026-10-DUP',
    statementDate: '2026-10-15',
    csvContent,
  }, { 'x-dev-tenant-id': pilot.tenantId });
  assert.equal(dupRes.status, 409, 'Duplicate statement SHA-256 must be rejected with 409 Conflict');

  // 5. Exception Resolution Drawer: Link orphan line item to newly registered policy
  // First create the missing policy in inventory
  const orphanPolicyRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/policies', {
    policyNumber: 'POL-ORPHAN-QC-999',
    carrierId: 'ia-financial-group',
    producerNodeId: pilot.partners.montreal!.id,
    branchNodeId: pilot.branches.montreal!.id,
    planName: 'iA Discovered Policy',
    jurisdiction: 'QC',
    annualPremiumCents: 100000,
    modalPremiumCents: 10000,
    premiumFrequency: 'monthly',
    effectiveDate: '2026-10-01',
    status: 'active',
  });
  assert.equal(orphanPolicyRes.status, 201);
  const orphanPolicyId = orphanPolicyRes.json.policy.id;

  // Retrieve unmatched line item ID
  const orphanLineId = await owner(async (c) => {
    return (
      await c.query<{ id: string }>(
        `SELECT id FROM commission_line_items WHERE import_id = $1 AND policy_number = 'POL-ORPHAN-QC-999'`,
        [importId],
      )
    ).rows[0]!.id;
  });
  assert.ok(orphanLineId);

  // Reconcile orphan line item to policy
  const reconcileRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/reconcile-line`, {
    lineItemId: orphanLineId,
    policyNumber: 'POL-ORPHAN-QC-999',
  }, { 'x-dev-tenant-id': pilot.tenantId });
  assert.equal(reconcileRes.status, 200, 'Orphan line reconciled');
  assert.equal(reconcileRes.json.resolved, true);

  // =========================================================================
  // Workstream 7: Dual-Controlled Statement Approval, Deterministic Splits & Trigger Immutability
  // =========================================================================
  // 1. Finance Officer Approves Statement
  const approveRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/approve`, {}, {
    'x-dev-tenant-id': pilot.tenantId,
  });
  assert.equal(approveRes.status, 200, 'Statement approved by Finance');
  assert.equal(approveRes.json.status, 'approved');
  assert.equal(approveRes.json.splitCount, 2);

  // 2. Deterministic Commission Split Calculation Verification
  await owner(async (c) => {
    // Check splits for Line 1: Gross $1,200.00 = 120,000 cents
    // Agreement: 65% broker, 10% branch, 25% MGA, 0% holdback
    const s1 = (
      await c.query<{
        gross_amount_cents: number;
        broker_net_cents: number;
        branch_override_cents: number;
        mga_spread_cents: number;
        holdback_cents: number;
      }>(
        `SELECT cs.gross_amount_cents, cs.broker_net_cents, cs.branch_override_cents, cs.mga_spread_cents, cs.holdback_cents
           FROM commission_splits cs
           JOIN commission_line_items li ON li.id = cs.line_item_id
          WHERE li.import_id = $1 AND li.policy_number = 'POL-IA-PILOT-QC-001'`,
        [importId],
      )
    ).rows[0]!;

    assert.equal(s1.gross_amount_cents, 120000);
    assert.equal(s1.broker_net_cents, 78000, '65% broker net = 78,000 cents');
    assert.equal(s1.branch_override_cents, 12000, '10% branch override = 12,000 cents');
    assert.equal(s1.mga_spread_cents, 30000, '25% MGA spread = 30,000 cents');
    assert.equal(s1.holdback_cents, 0, '0% holdback = 0 cents');
    assert.equal(s1.broker_net_cents + s1.branch_override_cents + s1.mga_spread_cents, s1.gross_amount_cents, 'Exact conservation of funds');
  });

  // 3. PostgreSQL Trigger Immutability Verification
  await owner(async (c) => {
    // Attempting direct UPDATE on approved statement must fail
    await assert.rejects(
      async () => {
        await c.query(`UPDATE commission_imports SET statement_reference = 'TAMPERED' WHERE id = $1`, [importId]);
      },
      /Cannot modify an approved or posted commission statement/,
      'PostgreSQL trigger must block UPDATE on approved statement',
    );

    // Attempting direct DELETE on approved statement must fail
    await assert.rejects(
      async () => {
        await c.query(`DELETE FROM commission_imports WHERE id = $1`, [importId]);
      },
      /Cannot delete an approved commission statement/,
      'PostgreSQL trigger must block DELETE on approved statement',
    );
  });

  // 4. Fail-Closed Payout & Live Dispatch Security Guards
  // Attempting to execute live payout must return HTTP 403 Forbidden
  const payoutRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/payout`, {}, {
    'x-dev-tenant-id': pilot.tenantId,
  });
  assert.equal(payoutRes.status, 403, 'Live payouts must be strictly disabled (403)');
  assert.match(payoutRes.json.error.message, /payouts are disabled/i);

  // Outbound carrier dispatch outbox remains locked fail-closed
  assert.throws(
    () => {
      assertExternalCarrierDispatch({
        environment: 'test',
        allowExternalDispatch: false,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: true,
        productionApproved: false,
        changeTicket: 'PILOT-GATE4',
      });
    },
    /External carrier dispatch is disabled/,
    'Carrier dispatch must remain locked fail-closed',
  );

  // =========================================================================
  // Workstream 8: 10-Perspective Pilot Workspace & Role-Tamper Audit
  // =========================================================================
  const testPerspectives = [
    { email: ADMIN, role: 'admin', expectedCards: 8, hasSummary: true },
    { email: HO, role: 'ho', expectedCards: 7, hasSummary: true },
    { email: COMPLIANCE_QC, role: 'compliance', expectedCards: 5, hasSummary: true },
    { email: MGR_MTL, role: 'manager', expectedCards: 5, hasSummary: false },
    { email: BROKER_MTL, role: 'partner', expectedCards: 5, hasSummary: false },
    { email: FINANCE, role: 'finance', expectedCards: 4, hasSummary: false },
    { email: AUDITOR, role: 'auditor', expectedCards: 2, hasSummary: false },
    { email: TRAINER, role: 'trainer', expectedCards: 3, hasSummary: false },
    { email: LEARNER, role: 'learner', expectedCards: 2, hasSummary: false },
    { email: STAFF_MTL, role: 'staff', expectedCards: 3, hasSummary: false },
  ];

  for (const tp of testPerspectives) {
    const query = tp.role === 'admin' ? '' : `?perspective=${tp.role}`;
    const dashRes = await call(tp.email, 'GET', `/v1/workspace/dashboard${query}`, undefined, {
      'x-dev-tenant-id': pilot.tenantId,
    });
    assert.equal(dashRes.status, 200, `Dashboard for ${tp.email} (${tp.role}) must return 200`);
    assert.equal(dashRes.json.perspective, tp.role);
    assert.equal(dashRes.json.cards.length, tp.expectedCards, `${tp.role} must receive exactly ${tp.expectedCards} cards`);

    if (tp.hasSummary) {
      assert.ok(dashRes.json.summary, `Summary must be present for ${tp.role}`);
    } else {
      assert.equal(dashRes.json.summary, undefined, `Summary must be omitted for ${tp.role}`);
    }

    // Role-tamper check: non-admin requesting admin perspective receives 403 Forbidden
    if (tp.role !== 'admin') {
      const tamperRes = await call(tp.email, 'GET', '/v1/workspace/dashboard?perspective=admin', undefined, {
        'x-dev-tenant-id': pilot.tenantId,
      });
      assert.equal(tamperRes.status, 403, `${tp.role} attempting admin perspective must receive 403 Forbidden`);
    }
  }

  // Cross-Branch Workspace Scoping
  const mtlDashboard = await call(MGR_MTL, 'GET', '/v1/workspace/dashboard', undefined, { 'x-dev-tenant-id': pilot.tenantId });
  const torDashboard = await call(MGR_TOR, 'GET', '/v1/workspace/dashboard', undefined, { 'x-dev-tenant-id': pilot.tenantId });
  assert.equal(mtlDashboard.status, 200);
  assert.equal(torDashboard.status, 200);
  assert.equal(mtlDashboard.json.perspective, 'manager');
  assert.equal(torDashboard.json.perspective, 'manager');
});
