import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import {
  loadConfig,
  localKeyProvider,
  executeCarrierSandboxProtocol,
  buildSandboxContractInput,
} from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;

let tenantId = '';
let rootNodeId = '';
let branchMtlId = '';
let branchTorId = '';
let partnerNodeId = '';

let pipelineId = '';
let stageWonId = '';
let crmBoxId = '';
let policyRecordId = '';
let orphanPolicyId = '';
let importId = '';

const ADMIN = 'admin@apex-gate3-uat.test';
const COMPLIANCE_QC = 'compliance-qc@apex-gate3-uat.test';
const MGR_ON = 'manager-on@apex-gate3-uat.test';
const PRODUCER_QC = 'producer-qc@apex-gate3-uat.test';

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

  // 1. Bootstrap Tenant
  const t = await bootstrapTenant(db.ownerUrl, {
    name: 'Apex Financial & Insurance Services Inc.',
    countryCode: 'CA',
    adminEmail: ADMIN,
    defaultLocale: 'en',
    headOffice: true,
  });
  tenantId = t.tenantId;
  rootNodeId = t.rootNodeId;

  // 2. Set up Organizational Structure: Toronto Hub, Montreal Branch, Broker Partner Firm
  await owner(async (c) => {
    branchTorId = randomUUID();
    branchMtlId = randomUUID();
    partnerNodeId = randomUUID();

    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', 'Toronto Financial Centre')`, [branchTorId, tenantId]);
    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', 'Succursale de Montréal (QC)')`, [branchMtlId, tenantId]);
    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'partner', 'Cabinet de Courtage Beaulieu & Fils')`, [partnerNodeId, tenantId]);

    // Link Locations to Partner Node
    await c.query(`INSERT INTO org_links (tenant_id, kind, parent_id, child_id) VALUES ($1, 'location_link', $2, $3)`, [tenantId, branchTorId, partnerNodeId]);
    await c.query(`INSERT INTO org_links (tenant_id, kind, parent_id, child_id) VALUES ($1, 'location_link', $2, $3)`, [tenantId, branchMtlId, partnerNodeId]);

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

    await addUser(COMPLIANCE_QC, 'Valérie Deschamps', branchMtlId, 'compliance', 'fr-CA');
    await addUser(MGR_ON, 'David Miller', branchTorId, 'manager', 'en');
    await addUser(PRODUCER_QC, 'Jean-Luc Beaulieu', partnerNodeId, 'partner', 'fr-CA');
  });

  // Complete first login consent for all seeded actors
  for (const email of [ADMIN, COMPLIANCE_QC, MGR_ON, PRODUCER_QC]) {
    await call(email, 'POST', '/v1/consent/first-login');
  }
});

after(async () => {
  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

// ===========================================================================
// WORKSTREAM 1: Multi-Tier Organization & Role Authorization Scoping
// ===========================================================================
test('Workstream 1: Multi-Tier Organization Structure & Scoped Contexts', async () => {
  // Admin sees full organization tree nodes
  const orgRes = await call(ADMIN, 'GET', '/v1/org/nodes');
  assert.equal(orgRes.status, 200);
  assert.ok(orgRes.json.nodes.length >= 3);

  // Producer advisor sees contexts for linked branches (Toronto and Montreal)
  const ctxRes = await call(PRODUCER_QC, 'GET', '/v1/org/contexts');
  assert.equal(ctxRes.status, 200);
  assert.equal(ctxRes.json.locations.length, 2);
  const locationNames = ctxRes.json.locations.map((l: any) => l.name);
  assert.ok(locationNames.includes('Toronto Financial Centre'));
  assert.ok(locationNames.includes('Succursale de Montréal (QC)'));

  // Role permissions: Producer advisor cannot create organization locations
  const forbiddenOrgRes = await call(PRODUCER_QC, 'POST', '/v1/org/locations', { name: 'Unauthorized Hub' });
  assert.equal(forbiddenOrgRes.status, 403);
});

// ===========================================================================
// WORKSTREAM 2: Advisor Compliance & Carrier Sandbox Certification Protocol
// ===========================================================================
test('Workstream 2: Advisor Licensing, E&O, AML & Carrier Sandbox Certification', async () => {
  // 1. Authoritative Carrier Registry Gates & Tier Setup for iA Financial Group
  const gate1Res = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate1_legal_agreement',
    evidence: 'Bilateral DPA and Managing General Agency contract signed 2026-10-15 ref #IA-QC-2026-MGA',
  });
  assert.equal(gate1Res.status, 200);
  assert.equal(gate1Res.json.ok, true);

  const gate2Res = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate2_sandbox_certified',
    evidence: 'Automated Carrier Sandbox Certification Protocol executed successfully with synthetic contract acceptance',
  });
  assert.equal(gate2Res.status, 200);

  const gate3Res = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate3_kms_secrets_provisioned',
    evidence: 'AWS/GCP KMS envelope keys and HMAC-SHA256 secrets provisioned for iA webhook intake',
  });
  assert.equal(gate3Res.status, 200);

  // Promote carrier to certified tier
  const tierRes = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/tier', {
    tier: 'certified',
    tierExpiresOn: '2027-12-31',
  });
  assert.equal(tierRes.status, 200);
  assert.equal(tierRes.json.certification.tier, 'certified');

  // Verify fail-closed dispatch lock is enforced
  const listCerts = await call(COMPLIANCE_QC, 'GET', '/v1/compliance/carrier-certifications');
  assert.equal(listCerts.status, 200);
  const iaCert = listCerts.json.certifications.find((c: any) => c.carrierId === 'ia-financial-group');
  assert.ok(iaCert);
  assert.equal(iaCert.currentTier, 'certified');
  assert.equal(iaCert.dispatchLocked, true, 'Fail-closed dispatch lock must be strictly active');

  // 2. Automated Carrier Sandbox Certification Protocol Runner (@pii/platform)
  const sandboxInput = buildSandboxContractInput('ia-financial-group', 'QC', {
    broker: {
      id: 'advisor-qc-1',
      firstName: 'Jean-Luc',
      lastName: 'Beaulieu',
      email: 'jbeaulieu@pilot.qc.ca',
      primaryJurisdiction: 'QC',
      languagePreference: 'fr-CA',
    },
    eoInsurance: {
      policyNumber: 'EO-CAN-2026-999',
      insurerName: 'Trisura Guarantee Insurance Company',
      coverageAmount: 2_000_000,
      aggregateAmount: 2_000_000,
      expiresOn: '2027-12-31',
    },
    licence: {
      licenceNumber: 'AMF-QC-98765',
      jurisdiction: 'QC',
      class: 'life_and_health',
      expiresOn: '2027-12-31',
    },
  });

  const sandboxResult = await executeCarrierSandboxProtocol('ia-financial-group', sandboxInput, {
    mockSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    eventType: 'appointment.confirmed',
  });

  assert.equal(sandboxResult.status, 'passed');
  assert.equal(sandboxResult.packetValidated, true);
  assert.equal(sandboxResult.validationResult.valid, true);
  assert.equal(sandboxResult.canonicalPayload?.carrier, 'ia-financial-group');
  assert.equal(sandboxResult.canonicalPayload?.metadata.jurisdiction, 'QC');
  assert.equal(sandboxResult.canonicalPayload?.regulatory.eoPerClaimLimit, 2_000_000);
  assert.equal(sandboxResult.dispatchFailedClosed, true);
  assert.equal(sandboxResult.simulatedWebhook.verifiedReceipt.carrierId, 'ia-financial-group');
  assert.equal((sandboxResult.simulatedWebhook.verifiedReceipt.payload as any).eventType, 'appointment.confirmed');
});

// ===========================================================================
// WORKSTREAM 3: Client Law 25 & PIPEDA Consent Capture
// ===========================================================================
test('Workstream 3: Client Law 25 & PIPEDA Consent Capture in CRM', async () => {
  // 1. Create a CRM Pipeline for Life Insurance Opportunities, owned by Montreal branch and shared down
  const pipeRes = await call(ADMIN, 'POST', '/v1/pipelines', {
    name: 'Life & Living Benefits Pipeline',
    ownerNodeId: branchMtlId,
    sharedDown: true,
    fields: [
      {
        key: 'policy_type',
        labels: { en: 'Policy Type', 'fr-CA': 'Type de police' },
        type: 'dropdown',
        options: ['universal_life', 'term', 'critical_illness'],
      },
    ],
  });
  assert.equal(pipeRes.status, 201);
  pipelineId = pipeRes.json.id;

  const pipeDetail = await call(ADMIN, 'GET', '/v1/pipelines');
  const pipeline = pipeDetail.json.pipelines.find((p: any) => p.id === pipelineId);
  assert.ok(pipeline);
  assert.equal(pipeline.stages.length, 4);
  stageWonId = pipeline.stages[2].id; // 3rd stage is Won (isWon: true)

  // 2. Producer logs a client opportunity box in Montreal location context
  const boxRes = await call(PRODUCER_QC, 'POST', '/v1/boxes', {
    pipelineId,
    name: 'Tremblay, Jean-Luc - Universal Life $500k',
    contextNodeId: branchMtlId,
    valueAmount: 2400.0,
    closeDate: '2026-11-01',
    custom: {
      policy_type: 'universal_life',
    },
  });
  assert.equal(boxRes.status, 201);
  crmBoxId = boxRes.json.id;

  // 3. Capture Law 25 & PIPEDA Client Consents electronically
  const consent1 = await call(PRODUCER_QC, 'POST', `/v1/boxes/${crmBoxId}/consents`, {
    kind: 'collection_use',
    channel: 'esign',
    grantedOn: '2026-10-18',
    note: 'Client signed electronic Law 25 / PIPEDA consent declaration in French (fr-CA)',
  });
  assert.equal(consent1.status, 201);
  assert.ok(consent1.json.id);

  const consent2 = await call(PRODUCER_QC, 'POST', `/v1/boxes/${crmBoxId}/consents`, {
    kind: 'carrier_sharing',
    channel: 'esign',
    grantedOn: '2026-10-18',
    note: 'Consent to transmit application and personal health info to iA Financial Group',
  });
  assert.equal(consent2.status, 201);
  assert.ok(consent2.json.id);

  // Verify active consents on file
  const consentsList = await call(PRODUCER_QC, 'GET', `/v1/boxes/${crmBoxId}/consents`);
  assert.equal(consentsList.status, 200);
  assert.ok(consentsList.json.active.includes('collection_use'));
  assert.ok(consentsList.json.active.includes('carrier_sharing'));
  assert.equal(consentsList.json.wording.kinds.length, 4);
});

// ===========================================================================
// WORKSTREAM 4: CRM Pipeline Stage Movement to Won
// ===========================================================================
test('Workstream 4: CRM Opportunity Stage Progression to Closed/Won', async () => {
  // Move box stage to stageWonId
  const updateStageRes = await call(PRODUCER_QC, 'PATCH', `/v1/boxes/${crmBoxId}`, {
    stageId: stageWonId,
  });
  assert.equal(updateStageRes.status, 204);

  // Verify box is now in Won stage
  const verifyBoxRes = await call(PRODUCER_QC, 'GET', `/v1/boxes/${crmBoxId}`);
  assert.equal(verifyBoxRes.status, 200);
  assert.equal(verifyBoxRes.json.stageId, stageWonId);
});

// ===========================================================================
// WORKSTREAM 5: 1-Click Policy Issuance & Inventory Ledger
// ===========================================================================
test('Workstream 5: 1-Click Policy Issuance with Branch Scoping and Integer Cents', async () => {
  const policyRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: partnerNodeId,
    policyNumber: 'POL-IA-UAT-2026-88',
    planName: 'iA Genesis Universal Life',
    jurisdiction: 'QC',
    annualPremiumCents: 240000,
    modalPremiumCents: 20000,
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2026-10-01',
  });

  assert.equal(policyRes.status, 201);
  assert.ok(policyRes.json.policy);
  policyRecordId = policyRes.json.policy.id;
  assert.equal(policyRes.json.policy.policy_number, 'POL-IA-UAT-2026-88');
  assert.equal(policyRes.json.policy.annual_premium_cents, 240000);
  assert.equal(policyRes.json.policy.modal_premium_cents, 20000);
  assert.equal(policyRes.json.policy.status, 'active');

  // Verify inventory listing scoped to Montreal branch
  const listRes = await call(COMPLIANCE_QC, 'GET', `/v1/commercial/policies?branch_node_id=${branchMtlId}`);
  assert.equal(listRes.status, 200);
  const found = listRes.json.policies.find((p: any) => p.id === policyRecordId);
  assert.ok(found);
  assert.equal(found.policy_number, 'POL-IA-UAT-2026-88');
});

// ===========================================================================
// WORKSTREAM 6: Versioned Commission Agreements & Overlap Controls
// ===========================================================================
test('Workstream 6: Versioned Commission Agreements, Holdback Controls & Overlap Prevention', async () => {
  // 1. Create active commission agreement (75% Broker, 15% Branch, 10% MGA, 5% Holdback)
  const agreementRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/agreements', {
    producerNodeId: partnerNodeId,
    carrierId: 'ia-financial-group',
    version: 'ia-uat-v2026.1',
    brokerSplitBps: 7500,
    branchOverrideBps: 1500,
    mgaSpreadBps: 1000,
    holdbackBps: 500,
    effectiveFrom: '2026-01-01',
  });
  assert.equal(agreementRes.status, 201);
  assert.ok(agreementRes.json.agreement);
  assert.equal(agreementRes.json.agreement.broker_split_bps, 7500);
  assert.equal(agreementRes.json.agreement.holdback_bps, 500);

  // 2. Attempt to create concurrent overlapping active agreement -> rejected with 409 Conflict
  const overlapRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/agreements', {
    producerNodeId: partnerNodeId,
    carrierId: 'ia-financial-group',
    version: 'ia-uat-v2026.2',
    brokerSplitBps: 7000,
    branchOverrideBps: 1500,
    mgaSpreadBps: 1500,
    holdbackBps: 500,
    effectiveFrom: '2026-06-01',
  });
  assert.equal(overlapRes.status, 409);
  assert.match(overlapRes.json.error.message, /overlaps with requested validity period/i);

  // 3. Attempt invalid holdback (holdback > broker split) -> rejected with 422
  const invalidHoldbackRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/agreements', {
    producerNodeId: partnerNodeId,
    carrierId: 'ia-financial-group',
    version: 'ia-uat-invalid',
    brokerSplitBps: 4000,
    branchOverrideBps: 3000,
    mgaSpreadBps: 3000,
    holdbackBps: 5000,
    effectiveFrom: '2028-01-01',
  });
  assert.equal(invalidHoldbackRes.status, 422);
  assert.match(invalidHoldbackRes.json.error.message, /cannot exceed broker share/i);
});

// ===========================================================================
// WORKSTREAM 7: Strict Statement CSV Ingestion & Pre-Commit Preview
// ===========================================================================
test('Workstream 7: Strict Carrier CSV Ingestion, Pre-Commit Preview & Exception Resolution', async () => {
  // 1. Ingest Carrier Statement CSV with 1 matched line and 1 unmatched orphan line
  const iaCsv = [
    'NoPolice,CommissionBrute,CommissionNette,TypeTransaction,CodeConseiller',
    'POL-IA-UAT-2026-88,"$1,000.00","$800.00",COMM1,QC-ADV-01',
    'POL-IA-ORPHAN-007,"$400.00","$320.00",COMM1,QC-ADV-01',
  ].join('\n');

  const importRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-STMT-UAT-2026-10',
    statementDate: '2026-10-15',
    csvContent: iaCsv,
  });

  assert.equal(importRes.status, 201);
  const imp = importRes.json.import;
  importId = imp.id;
  assert.equal(imp.statementReference, 'IA-STMT-UAT-2026-10');
  assert.equal(imp.lineCount, 2);
  assert.equal(imp.matchedCount, 1);
  assert.equal(imp.unmatchedCount, 1);
  assert.equal(imp.totalGrossCents, 140000); // 1000.00 + 400.00 = 1400.00 (140,000 cents)
  assert.equal(imp.totalNetCents, 112000);   // 800.00 + 320.00 = 1120.00 (112,000 cents)
  assert.equal(imp.status, 'exceptions_flagged');

  // Duplicate import rejection by SHA-256 hash -> 409 Conflict
  const dupImportRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-STMT-UAT-2026-10-DUP',
    statementDate: '2026-10-15',
    csvContent: iaCsv,
  });
  assert.equal(dupImportRes.status, 409);
  assert.match(dupImportRes.json.error.message, /Statement already imported/i);

  // 2. Pre-Commit Reconciliation Preview
  const previewRes = await call(COMPLIANCE_QC, 'GET', `/v1/commercial/commission-imports/${importId}/preview`);
  assert.equal(previewRes.status, 200);
  const preview = previewRes.json.preview;
  assert.equal(preview.matchedCount, 1);
  assert.equal(preview.unmatchedCount, 1);
  assert.equal(preview.totalGrossCents, 140000);

  const matchedLine = preview.lines.find((l: any) => l.policy_number === 'POL-IA-UAT-2026-88');
  assert.ok(matchedLine);
  assert.equal(matchedLine.reconciliation_status, 'matched');

  const orphanLine = preview.lines.find((l: any) => l.policy_number === 'POL-IA-ORPHAN-007');
  assert.ok(orphanLine);
  assert.equal(orphanLine.reconciliation_status, 'unmatched');

  // 3. Exception Resolution Workflow:
  // Issue the missing orphan policy into inventory
  const orphanPolicyRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: partnerNodeId,
    policyNumber: 'POL-IA-ORPHAN-007',
    planName: 'iA Term 20 Special',
    jurisdiction: 'QC',
    annualPremiumCents: 48000,
    modalPremiumCents: 4000,
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2026-10-10',
  });
  assert.equal(orphanPolicyRes.status, 201);
  orphanPolicyId = orphanPolicyRes.json.policy.id;

  // Reconcile the line item against the newly issued policy
  const reconcileLineRes = await call(COMPLIANCE_QC, 'POST', `/v1/commercial/commission-imports/${importId}/reconcile-line`, {
    lineItemId: orphanLine.id,
    policyNumber: 'POL-IA-ORPHAN-007',
  });
  assert.equal(reconcileLineRes.status, 200);
  assert.equal(reconcileLineRes.json.resolved, true);
  assert.equal(reconcileLineRes.json.remainingUnmatched, 0);
  assert.equal(reconcileLineRes.json.importStatus, 'reconciled');
});

// ===========================================================================
// WORKSTREAM 8: Dual-Controlled Statement Approval, Immutability & Reversals
// ===========================================================================
test('Workstream 8: Dual-Controlled Statement Approval, Split Engine & Ledger Immutability', async () => {
  // 1. Dual-Controlled Statement Approval
  const approveRes = await call(COMPLIANCE_QC, 'POST', `/v1/commercial/commission-imports/${importId}/approve`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.approved, true);
  assert.equal(approveRes.json.status, 'approved');
  assert.equal(approveRes.json.splitCount, 2);

  // 2. Deterministic Commission Split Verification
  const splitsRes = await call(COMPLIANCE_QC, 'GET', `/v1/commercial/commission-imports/${importId}/splits`);
  assert.equal(splitsRes.status, 200);
  const splits = splitsRes.json.splits;
  assert.equal(splits.length, 2);

  // Line 1: $1,000.00 Gross (100,000 cents)
  // Agreement: Broker 75%, Branch 15%, MGA 10%, Holdback 5%
  // Broker Gross: 75,000 cents
  // Holdback: 5% of 75,000 = 3,750 cents
  // Broker Net Payout: 75,000 - 3,750 = 71,250 cents
  // Branch Override: 15,000 cents
  // MGA Spread: 10,000 cents
  // Balance: 71,250 + 3,750 + 15,000 + 10,000 = 100,000 cents
  const split1 = splits.find((s: any) => s.policy_number === 'POL-IA-UAT-2026-88');
  assert.ok(split1);
  assert.equal(split1.gross_amount_cents, 100000);
  assert.equal(split1.holdback_cents, 3750);
  assert.equal(split1.broker_net_cents, 71250);
  assert.equal(split1.branch_override_cents, 15000);
  assert.equal(split1.mga_spread_cents, 10000);
  assert.equal(
    split1.broker_net_cents + split1.holdback_cents + split1.branch_override_cents + split1.mga_spread_cents,
    split1.gross_amount_cents,
    'Line 1 splits must balance exactly to gross cents'
  );

  // Line 2: $400.00 Gross (40,000 cents)
  // Broker Gross: 30,000 cents, Holdback: 1,500 cents, Broker Net: 28,500 cents
  // Branch Override: 6,000 cents, MGA Spread: 4,000 cents
  // Balance: 28,500 + 1,500 + 6,000 + 4,000 = 40,000 cents
  const split2 = splits.find((s: any) => s.policy_number === 'POL-IA-ORPHAN-007');
  assert.ok(split2);
  assert.equal(split2.gross_amount_cents, 40000);
  assert.equal(split2.holdback_cents, 1500);
  assert.equal(split2.broker_net_cents, 28500);
  assert.equal(split2.branch_override_cents, 6000);
  assert.equal(split2.mga_spread_cents, 4000);
  assert.equal(
    split2.broker_net_cents + split2.holdback_cents + split2.branch_override_cents + split2.mga_spread_cents,
    split2.gross_amount_cents,
    'Line 2 splits must balance exactly to gross cents'
  );

  // 3. Immutability Lock: PostgreSQL Database Triggers Reject Tampering on Approved Statements
  await owner(async (c) => {
    // A. Cannot modify approved statement status back to pending or draft
    await assert.rejects(
      async () => {
        await c.query(`UPDATE commission_imports SET status = 'pending' WHERE id = $1`, [importId]);
      },
      (err: any) => err.message.includes('Cannot modify an approved or posted commission statement'),
      'Database trigger must reject modifying approved statement'
    );

    // B. Cannot delete approved statement
    await assert.rejects(
      async () => {
        await c.query(`DELETE FROM commission_imports WHERE id = $1`, [importId]);
      },
      (err: any) => err.message.includes('Cannot delete an approved commission statement'),
      'Database trigger must reject deleting approved statement'
    );

    // C. Cannot modify line items of approved statement
    await assert.rejects(
      async () => {
        await c.query(
          `UPDATE commission_line_items SET gross_amount_cents = 999999 WHERE import_id = $1`,
          [importId]
        );
      },
      (err: any) => err.message.includes('Cannot modify or delete line items for an approved or posted statement'),
      'Database trigger must reject modifying line items of approved statement'
    );

    // D. Cannot delete splits of approved statement
    await assert.rejects(
      async () => {
        await c.query(`DELETE FROM commission_splits WHERE import_id = $1`, [importId]);
      },
      (err: any) => err.message.includes('Cannot modify or delete commission splits for an approved or posted statement'),
      'Database trigger must reject deleting splits of approved statement'
    );
  });

  // 4. Live Payout Guard: Payout endpoint remains strictly disabled fail-closed
  const payoutRes = await call(ADMIN, 'POST', `/v1/commercial/commission-imports/${importId}/payout`);
  assert.equal(payoutRes.status, 403, 'Payout must remain strictly forbidden fail-closed');

  // 5. Offsetting Reversal Accounting (Chargeback & Adjustment Statement)
  const reversalCsv = [
    'NoPolice,CommissionBrute,CommissionNette,TypeTransaction,CodeConseiller',
    'POL-IA-UAT-2026-88,"$500.00","$400.00",COMM2,QC-ADV-01',
    'POL-IA-UAT-2026-88,"($200.00)","($160.00)",CHGBK,QC-ADV-01',
  ].join('\n');

  const reversalRes = await call(COMPLIANCE_QC, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-STMT-UAT-REVERSAL-2026-10',
    statementDate: '2026-10-31',
    csvContent: reversalCsv,
  });
  assert.equal(reversalRes.status, 201);
  const revImp = reversalRes.json.import;
  assert.equal(revImp.lineCount, 2);
  assert.equal(revImp.chargebackCount, 1);
  assert.equal(revImp.totalGrossCents, 30000); // 50000 - 20000 = 30000 cents
  assert.equal(revImp.status, 'reconciled'); // Both lines matched automatically against POL-IA-UAT-2026-88

  // Approve the reversal statement independently without rewriting history
  const approveRevRes = await call(COMPLIANCE_QC, 'POST', `/v1/commercial/commission-imports/${revImp.id}/approve`);
  assert.equal(approveRevRes.status, 200);
  assert.equal(approveRevRes.json.status, 'approved');

  // Original statement remains intact and untouched
  const origStmtCheck = await call(COMPLIANCE_QC, 'GET', `/v1/commercial/commission-imports?carrier_id=ia-financial-group`);
  assert.equal(origStmtCheck.status, 200);
  const origFound = origStmtCheck.json.imports.find((i: any) => i.id === importId);
  assert.ok(origFound);
  assert.equal(origFound.status, 'approved');
  assert.equal(origFound.total_gross_cents, 140000);

  // 6. Role-Based Dashboard Perspectives: Finance & Compliance
  const financeDash = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=finance');
  assert.equal(financeDash.status, 200);
  const commCard = financeDash.json.cards.find((c: any) => c.module === 'commercial');
  assert.ok(commCard, 'Commercial module card must be present for finance perspective');

  const compDash = await call(COMPLIANCE_QC, 'GET', '/v1/workspace/dashboard?perspective=compliance');
  assert.equal(compDash.status, 200);
  assert.ok(compDash.json.summary);
});
