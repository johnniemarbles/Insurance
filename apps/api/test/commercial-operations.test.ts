import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import {
  parseDecimalToCents,
  tokenizeCsv,
  parseCommissionCsvStrict,
  CARRIER_IMPORT_PROFILES,
} from '@pii/domain';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];
let deps: AppDeps;

const ADMIN = 'admin@punjab-commercial.test';
const COMPLIANCE = 'compliance@punjab-commercial.test';
const MGR_MTL = 'manager-mtl@punjab-commercial.test';
const BROKER_MTL = 'broker-mtl@punjab-commercial.test';
const OTHER_TENANT_USER = 'intruder@other-tenant.test';

let tenantId = '';
let rootNodeId = '';
let branchMtlId = '';
let brokerNodeId = '';

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

async function runtime<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.appUrl });
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

  // Bootstrap tenant
  const t = await bootstrapTenant(db.ownerUrl, {
    name: 'Punjab Commercial Pilot',
    countryCode: 'CA',
    adminEmail: ADMIN,
    defaultLocale: 'fr-CA',
    headOffice: true,
  });
  tenantId = t.tenantId;
  rootNodeId = t.rootNodeId;

  // Set up Montreal Branch & Broker Partner
  await owner(async (c) => {
    branchMtlId = randomUUID();
    brokerNodeId = randomUUID();

    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', 'Montreal Branch (QC)')`, [branchMtlId, tenantId]);
    await c.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'partner', 'Cabinet Gill & Associés')`, [brokerNodeId, tenantId]);
    await c.query(`INSERT INTO org_links (tenant_id, kind, parent_id, child_id) VALUES ($1, 'location_link', $2, $3)`, [tenantId, branchMtlId, brokerNodeId]);

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

    await addUser(COMPLIANCE, 'Jean-Francois Tremblay', branchMtlId, 'compliance', 'fr-CA');
    await addUser(MGR_MTL, 'Amandeep Kaur', branchMtlId, 'manager', 'fr-CA');
    await addUser(BROKER_MTL, 'Baljit Gill', brokerNodeId, 'partner', 'fr-CA');
  });

  for (const email of [ADMIN, COMPLIANCE, MGR_MTL, BROKER_MTL]) {
    await call(email, 'POST', '/v1/consent/first-login');
  }
});

after(async () => {
  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

test('Permission Regression Guard: verify app_runtime table grants and audit restrictions', async () => {
  await owner(async (c) => {
    const grants = (
      await c.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type 
           FROM information_schema.role_table_grants 
          WHERE table_name IN (
            'carrier_certifications', 'carrier_certification_audit',
            'policy_records', 'commission_imports', 'commission_line_items',
            'commercial_audit'
          ) AND grantee = 'app_runtime'
          ORDER BY table_name, privilege_type`
      )
    ).rows;

    const byTable = (name: string) => grants.filter((g) => g.table_name === name).map((g) => g.privilege_type);

    // 1. carrier_certifications: app_runtime must have SELECT, INSERT, UPDATE for direct workflow API
    const certPrivs = byTable('carrier_certifications');
    assert.ok(certPrivs.includes('SELECT'), 'carrier_certifications must have SELECT granted to app_runtime');
    assert.ok(certPrivs.includes('INSERT'), 'carrier_certifications must have INSERT granted to app_runtime');
    assert.ok(certPrivs.includes('UPDATE'), 'carrier_certifications must have UPDATE granted to app_runtime');

    // 2. carrier_certification_audit: app_runtime must have SELECT only, writes revoked (trigger only)
    const certAuditPrivs = byTable('carrier_certification_audit');
    assert.ok(certAuditPrivs.includes('SELECT'), 'carrier_certification_audit must have SELECT granted');
    assert.equal(certAuditPrivs.includes('INSERT'), false, 'carrier_certification_audit direct INSERT must be revoked');
    assert.equal(certAuditPrivs.includes('UPDATE'), false, 'carrier_certification_audit direct UPDATE must be revoked');
    assert.equal(certAuditPrivs.includes('DELETE'), false, 'carrier_certification_audit direct DELETE must be revoked');

    // 3. Commercial tables: policy_records, commission_imports, commission_line_items
    for (const t of ['policy_records', 'commission_imports', 'commission_line_items']) {
      const p = byTable(t);
      assert.ok(p.includes('SELECT'), `${t} must have SELECT granted`);
      assert.ok(p.includes('INSERT'), `${t} must have INSERT granted`);
      assert.ok(p.includes('UPDATE'), `${t} must have UPDATE granted`);
    }

    // 4. commercial_audit: append-only via trigger, direct writes revoked from app_runtime
    const commAuditPrivs = byTable('commercial_audit');
    assert.ok(commAuditPrivs.includes('SELECT'), 'commercial_audit must have SELECT granted');
    assert.equal(commAuditPrivs.includes('INSERT'), false, 'commercial_audit direct INSERT must be revoked');
    assert.equal(commAuditPrivs.includes('UPDATE'), false, 'commercial_audit direct UPDATE must be revoked');
  });

  // Functional runtime check: Direct write to audit table by app_runtime must throw 42501 (permission denied)
  await runtime(async (c) => {
    await c.query(`SET LOCAL "app.tenant_id" = '${tenantId}'`);
    await assert.rejects(
      async () => {
        await c.query(
          `INSERT INTO carrier_certification_audit (tenant_id, carrier_id, revision, operation)
           VALUES ($1, 'ia-financial-group', 99, 'INSERT')`,
          [tenantId]
        );
      },
      (err: any) => err.code === '42501',
      'Direct INSERT to carrier_certification_audit by app_runtime must fail with 42501'
    );

    await assert.rejects(
      async () => {
        await c.query(
          `INSERT INTO commercial_audit (tenant_id, entity_type, entity_id, operation)
           VALUES ($1, 'policy_record', gen_random_uuid(), 'INSERT')`,
          [tenantId]
        );
      },
      (err: any) => err.code === '42501',
      'Direct INSERT to commercial_audit by app_runtime must fail with 42501'
    );
  });
});

test('Phase 11: Policy Inventory Ledger with integer cents and branch scoping', async () => {
  // 1. Create Policy: Montreal branch manager creates active policy for Montreal broker
  const createRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-IA-2026-001',
    planName: 'iA Term 20 Life & Critical Illness',
    jurisdiction: 'QC',
    annualPremiumCents: 125000, // $1,250.00
    modalPremiumCents: 11000,   // $110.00 / month
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2026-10-01',
  });

  assert.equal(createRes.status, 201, 'Policy should be created successfully');
  const policy = createRes.json.policy;
  assert.equal(policy.policy_number, 'POL-IA-2026-001');
  assert.equal(policy.annual_premium_cents, 125000);
  assert.equal(policy.modal_premium_cents, 11000);
  assert.equal(policy.status, 'active');

  // Verify financial audit trigger captured the insert
  await owner(async (c) => {
    const auditRows = (
      await c.query(
        `SELECT * FROM commercial_audit WHERE entity_id = $1 AND entity_type = 'policy_record'`,
        [policy.id]
      )
    ).rows;
    assert.equal(auditRows.length, 1, 'commercial_audit must record policy creation trigger');
    assert.equal(auditRows[0].operation, 'INSERT');
  });

  // 2. Monetary invariant: non-integer or negative cents must be rejected
  const floatRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-IA-FLOAT-ERR',
    planName: 'iA Whole Life',
    jurisdiction: 'QC',
    annualPremiumCents: 1250.50, // Invalid float!
    modalPremiumCents: 11000,
    premiumFrequency: 'monthly',
    effectiveDate: '2026-10-01',
  });
  assert.equal(floatRes.status, 422, 'Non-integer cents must be rejected with 422');

  // 3. Duplicate policy number rejection
  const dupRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-IA-2026-001',
    planName: 'iA Duplicate',
    jurisdiction: 'QC',
    annualPremiumCents: 125000,
    modalPremiumCents: 11000,
    premiumFrequency: 'monthly',
    effectiveDate: '2026-10-01',
  });
  assert.equal(dupRes.status, 409, 'Duplicate policy number for carrier must return 409 Conflict');

  // 4. List Policies
  const listRes = await call(COMPLIANCE, 'GET', '/v1/commercial/policies?carrier_id=ia-financial-group');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.json.policies.length, 1);
  assert.equal(listRes.json.policies[0].policy_number, 'POL-IA-2026-001');

  // 5. Get Single Policy
  const getRes = await call(MGR_MTL, 'GET', `/v1/commercial/policies/${policy.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.json.policy.id, policy.id);
  assert.equal(getRes.json.policy.branch_name, 'Montreal Branch (QC)');
  assert.equal(getRes.json.policy.producer_name, 'Cabinet Gill & Associés');
});

test('Phase 11: Idempotent Commission Statement Import & Reconciliation Preview', async () => {
  const fileHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  // 1. Register Commission Statement with 3 line items:
  //    - Line 1: Matches in-force policy 'POL-IA-2026-001', first year commission
  //    - Line 2: Unmatched policy 'POL-IA-UNKNOWN-999', renewal commission
  //    - Line 3: Matches in-force policy 'POL-IA-2026-001', chargeback (negative amount)
  const importRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-COMM-2026-10',
    statementDate: '2026-10-15',
    fileHashSha256: fileHash,
    lines: [
      {
        policyNumber: 'POL-IA-2026-001',
        grossAmountCents: 62500,  // $625.00
        netAmountCents: 50000,    // $500.00
        transactionType: 'first_year',
        carrierProducerCode: 'QC-GILL-01',
      },
      {
        policyNumber: 'POL-IA-UNKNOWN-999',
        grossAmountCents: 12000,  // $120.00
        netAmountCents: 9600,     // $96.00
        transactionType: 'renewal',
        carrierProducerCode: 'QC-GILL-01',
      },
      {
        policyNumber: 'POL-IA-2026-001',
        grossAmountCents: -15000, // -$150.00 chargeback
        netAmountCents: -12000,   // -$120.00
        transactionType: 'chargeback',
        carrierProducerCode: 'QC-GILL-01',
      },
    ],
  });

  assert.equal(importRes.status, 201, 'Commission import should register successfully');
  const imp = importRes.json.import;
  assert.equal(imp.statementReference, 'IA-COMM-2026-10');
  assert.equal(imp.lineCount, 3);
  assert.equal(imp.matchedCount, 1);
  assert.equal(imp.unmatchedCount, 1);
  assert.equal(imp.chargebackCount, 1);
  assert.equal(imp.status, 'exceptions_flagged'); // Unmatched line flags exceptions
  assert.equal(imp.payoutsDisabled, true);

  // 2. Idempotency Check: Submitting same file hash must return 409 Conflict
  const dupImportRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-COMM-2026-10-RETRY',
    statementDate: '2026-10-15',
    fileHashSha256: fileHash,
    lines: [
      {
        policyNumber: 'POL-IA-2026-001',
        grossAmountCents: 62500,
        netAmountCents: 50000,
        transactionType: 'first_year',
      },
    ],
  });
  assert.equal(dupImportRes.status, 409, 'Duplicate statement SHA-256 hash must return 409 Conflict');

  // 3. Reconciliation Preview with Exception Visibility
  const previewRes = await call(COMPLIANCE, 'GET', `/v1/commercial/commission-imports/${imp.id}/preview`);
  assert.equal(previewRes.status, 200);
  const preview = previewRes.json.preview;
  assert.equal(preview.matchedCount, 1);
  assert.equal(preview.unmatchedCount, 1);
  assert.equal(preview.chargebackCount, 1);
  assert.equal(preview.lines.length, 3);

  // Verify unmatched line exception message
  const unmatchedLine = preview.lines.find((l: any) => l.policy_number === 'POL-IA-UNKNOWN-999');
  assert.ok(unmatchedLine);
  assert.equal(unmatchedLine.reconciliation_status, 'unmatched');
  assert.equal(unmatchedLine.exception_reason, 'Policy not found in inventory');

  // Verify chargeback linked line
  const chargebackLine = preview.lines.find((l: any) => l.transaction_type === 'chargeback');
  assert.ok(chargebackLine);
  assert.equal(chargebackLine.reconciliation_status, 'chargeback_linked');
  assert.equal(chargebackLine.gross_amount_cents, -15000);

  // 4. Fail-Closed Payout Guard: Payout attempts must be strictly refused
  const payoutRes = await call(ADMIN, 'POST', `/v1/commercial/commission-imports/${imp.id}/payout`);
  assert.equal(payoutRes.status, 403, 'Payouts must be strictly refused with 403 Forbidden');
});

test('Phase 12: Commission Agreements & Versioned Deterministic Basis Points (BPS)', async () => {
  // 1. Create Agreement v1: 75% broker, 10% branch, 15% MGA, 5% holdback
  const res1 = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'ia-financial-group',
    version: 'v1',
    brokerSplitBps: 7500,
    branchOverrideBps: 1000,
    mgaSpreadBps: 1500,
    holdbackBps: 500,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-05-31',
  });
  assert.equal(res1.status, 201, 'Agreement v1 should be created');
  assert.equal(res1.json.agreement.broker_split_bps, 7500);
  assert.equal(res1.json.agreement.version, 'v1');

  // 2. Reject agreement where BPS does not sum to 10,000 (100.00%)
  const resInvalid = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'ia-financial-group',
    version: 'v-invalid',
    brokerSplitBps: 7000,
    branchOverrideBps: 1000,
    mgaSpreadBps: 1000, // Total = 9,000 BPS
    holdbackBps: 500,
    effectiveFrom: '2026-01-01',
  });
  assert.equal(resInvalid.status, 422, 'Invalid BPS sum must be rejected with 422');

  // 2b. Contract Control: Reject overlapping agreement date range
  const resOverlap = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'ia-financial-group',
    version: 'v-overlap',
    brokerSplitBps: 7000,
    branchOverrideBps: 1500,
    mgaSpreadBps: 1500,
    holdbackBps: 500,
    effectiveFrom: '2026-03-01',
    effectiveTo: '2026-07-01',
  });
  assert.equal(resOverlap.status, 409, 'Overlapping agreement validity period must return 409 Conflict');

  // 3. Create Agreement v2 (revised split: 70% broker, 15% branch, 15% MGA)
  const res2 = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'ia-financial-group',
    version: 'v2',
    brokerSplitBps: 7000,
    branchOverrideBps: 1500,
    mgaSpreadBps: 1500,
    holdbackBps: 500,
    effectiveFrom: '2026-06-01',
  });
  assert.equal(res2.status, 201, 'Agreement v2 should be created');
  assert.equal(res2.json.agreement.version, 'v2');

  // 4. List agreements
  const listRes = await call(COMPLIANCE, 'GET', `/v1/commercial/agreements?carrier_id=ia-financial-group&producer_node_id=${brokerNodeId}`);
  assert.equal(listRes.status, 200);
  assert.ok(listRes.json.agreements.length >= 2, 'Should list both versions');
});

test('Phase 12: CSV Commission Statement Ingestion & Pre-Commit Preview', async () => {
  const csvContent = [
    'PolicyNumber,GrossAmount,NetAmount,TransactionType,ProducerCode',
    'POL-IA-2026-001,1000.00,800.00,first_year,QC-GILL-01',
    'POL-IA-2026-001,-200.00,-160.00,chargeback,QC-GILL-01',
    'POL-IA-UNRESOLVED-888,500.00,400.00,renewal,QC-GILL-01',
  ].join('\n');

  // 1. Safe CSV preview before committing
  const previewRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'ia-financial-group',
    csvContent,
  });
  assert.equal(previewRes.status, 200, 'CSV preview should succeed');
  const p = previewRes.json.preview;
  assert.equal(p.lineCount, 3);
  assert.equal(p.matchedCount, 1);
  assert.equal(p.chargebackCount, 1);
  assert.equal(p.unmatchedCount, 1);
  assert.equal(p.totalGrossCents, 130000); // $1,000.00 - $200.00 + $500.00 = $1,300.00
  assert.equal(p.totalNetCents, 104000);   // $800.00 - $160.00 + $400.00 = $1,040.00

  // 2. Ingest statement via CSV endpoint
  const importRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-COMM-CSV-2026-11',
    statementDate: '2026-11-01',
    csvContent,
  });
  assert.equal(importRes.status, 201, 'CSV statement import should register');
  const imp = importRes.json.import;
  assert.equal(imp.statementReference, 'IA-COMM-CSV-2026-11');
  assert.equal(imp.status, 'exceptions_flagged');

  // 3. Verify duplicate import rejection
  const dupRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'IA-COMM-CSV-2026-11-RETRY',
    statementDate: '2026-11-01',
    csvContent,
  });
  assert.equal(dupRes.status, 409, 'Duplicate CSV statement must return 409');
});

test('Phase 12: Reconciliation Exception Line Resolution, Approval Lifecycle & Deterministic Splits', async () => {
  // First, create the missing policy in inventory
  const createPolicyRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-IA-UNRESOLVED-888',
    planName: 'iA Universal Life',
    jurisdiction: 'QC',
    annualPremiumCents: 60000,
    modalPremiumCents: 5000,
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2026-10-01',
  });
  assert.equal(createPolicyRes.status, 201);
  const resolvedPolicy = createPolicyRes.json.policy;

  // Get the imported CSV statement preview to find the unmatched line
  const impListRes = await call(COMPLIANCE, 'GET', '/v1/commercial/commission-imports?carrier_id=ia-financial-group');
  assert.equal(impListRes.status, 200);
  const csvImp = impListRes.json.imports.find((i: any) => i.statement_reference === 'IA-COMM-CSV-2026-11');
  assert.ok(csvImp);

  const previewRes = await call(COMPLIANCE, 'GET', `/v1/commercial/commission-imports/${csvImp.id}/preview`);
  const unmatchedLine = previewRes.json.preview.lines.find((l: any) => l.policy_number === 'POL-IA-UNRESOLVED-888');
  assert.ok(unmatchedLine);

  // Resolve the unmatched exception line
  const resolveRes = await call(COMPLIANCE, 'POST', `/v1/commercial/commission-imports/${csvImp.id}/reconcile-line`, {
    lineItemId: unmatchedLine.id,
    policyNumber: 'POL-IA-UNRESOLVED-888',
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.json.resolved, true);
  assert.equal(resolveRes.json.remainingUnmatched, 0);
  assert.equal(resolveRes.json.importStatus, 'reconciled');

  // Approve statement & trigger deterministic split calculations
  const approveRes = await call(COMPLIANCE, 'POST', `/v1/commercial/commission-imports/${csvImp.id}/approve`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.approved, true);
  assert.equal(approveRes.json.status, 'approved');
  assert.equal(approveRes.json.splitCount, 3); // 3 lines split

  // Inspect generated splits
  const splitsRes = await call(COMPLIANCE, 'GET', `/v1/commercial/commission-imports/${csvImp.id}/splits`);
  assert.equal(splitsRes.status, 200);
  const splits = splitsRes.json.splits;
  assert.equal(splits.length, 3);

  // Verify deterministic math on first line: $1,000.00 gross (100,000 cents)
  // Agreement v2: broker 7000 BPS (70%), branch 1500 BPS (15%), MGA 1500 BPS (15%), holdback 500 BPS (5%)
  // Broker gross = 70,000 cents. Holdback = 70,000 * 5% = 3,500 cents. Broker net = 66,500 cents.
  // Branch override = 15,000 cents. MGA spread = 15,000 cents.
  // Total = broker net (66500) + holdback (3500) + branch (15000) + mga (15000) = 100,000 cents.
  const firstYearSplit = splits.find((s: any) => s.policy_number === 'POL-IA-2026-001' && s.gross_amount_cents > 0);
  assert.ok(firstYearSplit);
  assert.equal(firstYearSplit.gross_amount_cents, 100000);
  assert.equal(firstYearSplit.broker_net_cents, 66500);
  assert.equal(firstYearSplit.holdback_cents, 3500);
  assert.equal(firstYearSplit.branch_override_cents, 15000);
  assert.equal(firstYearSplit.mga_spread_cents, 15000);
  assert.equal(
    firstYearSplit.broker_net_cents + firstYearSplit.holdback_cents + firstYearSplit.branch_override_cents + firstYearSplit.mga_spread_cents,
    firstYearSplit.gross_amount_cents,
    'Splits must balance to exact gross amount cents'
  );

  // Payout remains strictly forbidden even after approval
  const payoutRes = await call(ADMIN, 'POST', `/v1/commercial/commission-imports/${csvImp.id}/payout`);
  assert.equal(payoutRes.status, 403, 'Payout must still be refused with 403 Forbidden');
});

test('Phase 12: Workspace Dashboard Work Queue & Commercial KPIs Integration', async () => {
  // Create an active policy that expires in 15 days (renewal queue candidate)
  const expiringDate = new Date();
  expiringDate.setDate(expiringDate.getDate() + 15);
  const expiryDateStr = expiringDate.toISOString().slice(0, 10);

  const renewalPolicyRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-IA-EXPIRING-2026',
    planName: 'iA Term 10 Renewable',
    jurisdiction: 'QC',
    annualPremiumCents: 85000,
    modalPremiumCents: 7500,
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2025-11-01',
    expiryDate: expiryDateStr,
  });
  assert.equal(renewalPolicyRes.status, 201);

  // Check Admin / Head Office perspective dashboard
  const adminDashRes = await call(ADMIN, 'GET', '/v1/workspace/dashboard?perspective=admin');
  assert.equal(adminDashRes.status, 200);
  const adminDash = adminDashRes.json;

  // Check executive summary includes pending approvals
  assert.ok(adminDash.summary);
  assert.ok(adminDash.summary.pendingApprovals >= 1);

  // Check workQueue includes commercial items
  const renewalItem = adminDash.workQueue.find((w: any) => w.id === `wq-pol-renewal-${renewalPolicyRes.json.policy.id}`);
  assert.ok(renewalItem, 'Expiring policy renewal must appear in work queue');
  assert.equal(renewalItem.category, 'contract_approval');
  assert.equal(renewalItem.priority, 'high');

  // Check carrier card has pendingStatements metric
  const carrierCard = adminDash.cards.find((c: any) => c.module === 'carriers');
  assert.ok(carrierCard, 'Carriers card must be present');
  const stmtMetric = carrierCard.metrics.find((m: any) => m.id === 'pendingStatements');
  assert.ok(stmtMetric, 'pendingStatements metric must be present on carrier card');
  assert.ok(carrierCard.allowedActions.includes('reconcile_statements'));

  // Check Broker (Partner) perspective dashboard
  const brokerDashRes = await call(BROKER_MTL, 'GET', '/v1/workspace/dashboard?perspective=partner');
  assert.equal(brokerDashRes.status, 200);
  const brokerDash = brokerDashRes.json;
  const brokerRenewalItem = brokerDash.workQueue.find((w: any) => w.id === `wq-pol-renewal-${renewalPolicyRes.json.policy.id}`);
  assert.ok(brokerRenewalItem, 'Broker should see renewal item for their policy');
  assert.equal(brokerRenewalItem.role, 'Broker');
});

test('Phase 13: Strict Decimal-to-Cents Parsing & Exact Financial Precision', () => {
  // 1. Basic conversions
  assert.equal(parseDecimalToCents('100'), 10000);
  assert.equal(parseDecimalToCents('100.00'), 10000);
  assert.equal(parseDecimalToCents('100.50'), 10050);
  assert.equal(parseDecimalToCents('0.05'), 5);
  assert.equal(parseDecimalToCents('0.10'), 10);
  assert.equal(parseDecimalToCents('0.01'), 1);

  // 2. Float rounding pitfalls in standard JS:
  // 0.07 * 100 = 7.000000000000001
  // 19.99 * 100 = 1998.9999999999998
  // 0.29 * 100 = 28.999999999999996
  assert.equal(parseDecimalToCents('0.07'), 7);
  assert.equal(parseDecimalToCents('19.99'), 1999);
  assert.equal(parseDecimalToCents('0.29'), 29);
  assert.equal(parseDecimalToCents('55.55'), 5555);

  // 3. Thousands separators
  assert.equal(parseDecimalToCents('1,234.56'), 123456);
  assert.equal(parseDecimalToCents('$1,250,500.25'), 125050025);
  assert.equal(parseDecimalToCents('-1,000,000.00'), -100000000);

  // 4. Accounting parentheses for negative numbers
  assert.equal(parseDecimalToCents('(150.00)'), -15000);
  assert.equal(parseDecimalToCents('($1,250.50)'), -125050);
  assert.equal(parseDecimalToCents('( 50.00 )'), -5000);
  assert.equal(parseDecimalToCents('(0.07)'), -7);

  // 5. Currency symbols and prefixes
  assert.equal(parseDecimalToCents('$100.00'), 10000);
  assert.equal(parseDecimalToCents('CAD 250.75'), 25075);
  assert.equal(parseDecimalToCents('USD $10.00'), 1000);
  assert.equal(parseDecimalToCents('-150.00'), -15000);
  assert.equal(parseDecimalToCents('-0.05'), -5);

  // 6. Explicit rejection of invalid formats
  assert.throws(() => parseDecimalToCents('100.555'), /at most 2 decimal places/);
  assert.throws(() => parseDecimalToCents('10.123'), /at most 2 decimal places/);
  assert.throws(() => parseDecimalToCents('abc'), /Invalid monetary format/);
  assert.throws(() => parseDecimalToCents('$$$'), /Invalid monetary format/);
  assert.throws(() => parseDecimalToCents(''), /cannot be empty/);
  assert.throws(() => parseDecimalToCents('12.34.56'), /Invalid monetary format/);
  assert.throws(() => parseDecimalToCents('--100'), /Invalid monetary format/);
});

test('Phase 13: RFC 4180 CSV Tokenizer & Zero Silent Skipping Enforcement', () => {
  // 1. Quoted commas
  const quotedCommas = 'POL-123,"Smith, John",100.00';
  const tokens1 = tokenizeCsv(quotedCommas);
  assert.deepEqual(tokens1, [['POL-123', 'Smith, John', '100.00']]);

  // 2. Escaped quotes
  const escapedQuotes = 'POL-456,"Plan ""Elite"" Gold",200.00';
  const tokens2 = tokenizeCsv(escapedQuotes);
  assert.deepEqual(tokens2, [['POL-456', 'Plan "Elite" Gold', '200.00']]);

  // 3. Multiline quoted fields
  const multiline = 'POL-789,"Line 1\nLine 2",300.00';
  const tokens3 = tokenizeCsv(multiline);
  assert.deepEqual(tokens3, [['POL-789', 'Line 1\nLine 2', '300.00']]);

  // 4. Zero silent skipping: Incomplete row throws line-numbered error
  const incompleteCsv = [
    'PolicyNumber,GrossAmount,NetAmount,TransactionType,ProducerCode',
    'POL-001,100.00,80.00,first_year,QC-01',
    'POL-002,200.00,160.00', // only 3 fields
  ].join('\n');
  assert.throws(() => parseCommissionCsvStrict(incompleteCsv, 'standard'), /Row 3: expected 5 fields, found 3/);

  // 5. Zero silent skipping: Empty line in statement throws explicit error
  const emptyLineCsv = [
    'PolicyNumber,GrossAmount,NetAmount,TransactionType,ProducerCode',
    'POL-001,100.00,80.00,first_year,QC-01',
    '',
    'POL-002,200.00,160.00,first_year,QC-01',
  ].join('\n');
  assert.throws(() => parseCommissionCsvStrict(emptyLineCsv, 'standard'), /Row 3 is empty; empty rows are not permitted/);

  // 6. Missing required header throws explicit error
  const missingHeaderCsv = [
    'GrossAmount,NetAmount,TransactionType,ProducerCode',
    '100.00,80.00,first_year,QC-01',
  ].join('\n');
  assert.throws(() => parseCommissionCsvStrict(missingHeaderCsv, 'standard'), /Missing required header column: policyNumber/);

  // 7. Unknown carrier profile throws explicit error
  assert.throws(() => parseCommissionCsvStrict(missingHeaderCsv, 'non-existent-carrier'), /Unknown carrier import profile/);
});

test('Phase 13: Carrier Profiles (iA & Sun Life) & Transaction Validation', async () => {
  // 1. iA Financial Group with French headers & carrier transaction codes
  const iaCsv = [
    'NoPolice,CommissionBrute,CommissionNette,TypeTransaction,CodeConseiller',
    'POL-IA-2026-001,1000.00,800.00,COMM1,QC-GILL-01',
    'POL-IA-2026-001,(200.00),(160.00),CHGBK,QC-GILL-01',
    'POL-IA-2026-001,300.00,240.00,COMM2,QC-GILL-01',
  ].join('\n');

  const iaPreview = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'ia-financial-group',
    csvContent: iaCsv,
  });
  assert.equal(iaPreview.status, 200);
  assert.equal(iaPreview.json.preview.lineCount, 3);
  assert.equal(iaPreview.json.preview.totalGrossCents, 110000); // 100000 - 20000 + 30000
  assert.equal(iaPreview.json.preview.totalNetCents, 88000);    // 80000 - 16000 + 24000
  assert.equal(iaPreview.json.preview.chargebackCount, 1);

  // 2. Reject unknown transaction type
  const invalidTypeCsv = [
    'NoPolice,CommissionBrute,CommissionNette,TypeTransaction,CodeConseiller',
    'POL-IA-2026-001,1000.00,800.00,UNKNOWN_TX,QC-GILL-01',
  ].join('\n');
  const invalidTypeRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'ia-financial-group',
    csvContent: invalidTypeCsv,
  });
  assert.equal(invalidTypeRes.status, 422);
  assert.match(invalidTypeRes.json.error.message, /Unrecognized transaction type 'UNKNOWN_TX'/i);

  // 3. Sun Life carrier profile with currency symbols and accounting parentheses
  const sunLifeCsv = [
    'Policy_Number,Gross_Amt,Net_Amt,Trans_Code,Advisor_ID',
    'POL-IA-2026-001,"$1,500.50","$1,200.40",FYC,ADV-001',
    'POL-IA-2026-001,($300.00),($240.00),CBK,ADV-001',
  ].join('\n');
  const slPreview = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'sun-life',
    csvContent: sunLifeCsv,
  });
  assert.equal(slPreview.status, 200);
  assert.equal(slPreview.json.preview.lineCount, 2);
  assert.equal(slPreview.json.preview.totalGrossCents, 120050); // 150050 - 30000
  assert.equal(slPreview.json.preview.totalNetCents, 96040);    // 120040 - 24000
});

test('Phase 13: Contract Controls & Holdback Constraints', async () => {
  // 1. Missing holdbackBps rejected
  const resNoHoldback = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'sun-life',
    version: 'sl-v1',
    brokerSplitBps: 8000,
    branchOverrideBps: 1000,
    mgaSpreadBps: 1000,
    effectiveFrom: '2026-01-01',
  });
  assert.equal(resNoHoldback.status, 422);
  assert.match(resNoHoldback.json.error.message, /holdbackBps is required/);

  // 2. holdbackBps > brokerSplitBps rejected at API level
  const resExcessiveHoldback = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'sun-life',
    version: 'sl-v1',
    brokerSplitBps: 5000,
    branchOverrideBps: 2500,
    mgaSpreadBps: 2500,
    holdbackBps: 6000, // 60% > 50%
    effectiveFrom: '2026-01-01',
  });
  assert.equal(resExcessiveHoldback.status, 422);
  assert.match(resExcessiveHoldback.json.error.message, /cannot exceed broker share/);

  // 3. Database Check Constraint enforces holdback_bps <= broker_split_bps
  await owner(async (c) => {
    await assert.rejects(
      async () => {
        await c.query(
          `INSERT INTO commission_agreements (
             tenant_id, producer_node_id, carrier_id, version,
             broker_split_bps, branch_override_bps, mga_spread_bps, holdback_bps, effective_from
           ) VALUES ($1, $2, 'sun-life', 'sql-invalid-holdback', 4000, 3000, 3000, 5000, '2026-01-01')`,
          [tenantId, brokerNodeId]
        );
      },
      (err: any) => {
        return err.code === '23514' && err.constraint === 'comm_agreements_holdback_le_broker';
      },
      'Database constraint must reject holdback_bps > broker_split_bps'
    );
  });
});

test('Phase 13: Statement Deduplication, Immutable Approval Snapshots & Lock Triggers', async () => {
  // 1. Create a Sun Life policy
  const slPolicyRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'sun-life',
    branchNodeId: branchMtlId,
    producerNodeId: brokerNodeId,
    policyNumber: 'POL-SL-LOCK-001',
    planName: 'Sun Life SunSpectrum',
    jurisdiction: 'QC',
    annualPremiumCents: 120000,
    modalPremiumCents: 10000,
    premiumFrequency: 'monthly',
    status: 'active',
    effectiveDate: '2026-01-01',
  });
  assert.equal(slPolicyRes.status, 201);

  // 2. Create Sun Life Agreement
  const slAgreeRes = await call(COMPLIANCE, 'POST', '/v1/commercial/agreements', {
    producerNodeId: brokerNodeId,
    carrierId: 'sun-life',
    version: 'sl-lock-v1',
    brokerSplitBps: 8000,
    branchOverrideBps: 1000,
    mgaSpreadBps: 1000,
    holdbackBps: 500,
    effectiveFrom: '2026-01-01',
  });
  assert.equal(slAgreeRes.status, 201);

  // 3. Ingest Sun Life CSV statement with matching lines
  const slCsv = [
    'Policy_Number,Gross_Amt,Net_Amt,Trans_Code,Advisor_ID',
    'POL-SL-LOCK-001,"$1,000.00","$800.00",FYC,ADV-001',
    'POL-SL-LOCK-001,"($200.00)","($160.00)",CBK,ADV-001',
  ].join('\n');

  const slImportRes = await call(COMPLIANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'sun-life',
    statementReference: 'SL-LOCK-STATEMENT-2026-11',
    statementDate: '2026-11-01',
    csvContent: slCsv,
  });
  assert.equal(slImportRes.status, 201, slImportRes.json?.error?.message ?? JSON.stringify(slImportRes.json));
  const imp = slImportRes.json.import;
  assert.equal(imp.status, 'reconciled');
  assert.equal(imp.matchedCount, 1);
  assert.equal(imp.chargebackCount, 1);
  assert.equal(imp.unmatchedCount, 0);

  // 4. Approve statement & verify approval snapshot
  const approveRes = await call(COMPLIANCE, 'POST', `/v1/commercial/commission-imports/${imp.id}/approve`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.approved, true);

  // 5. Inspect database record for approval_snapshot and split statuses
  await owner(async (c) => {
    const importRow = (
      await c.query<{ approval_snapshot: any; status: string }>(
        'SELECT approval_snapshot, status FROM commission_imports WHERE id = $1',
        [imp.id]
      )
    ).rows[0];
    assert.ok(importRow);
    assert.equal(importRow.status, 'approved');
    assert.ok(importRow.approval_snapshot, 'approval_snapshot must be stored on commission_imports');
    assert.equal(importRow.approval_snapshot.carrierId, 'sun-life');
    assert.equal(importRow.approval_snapshot.agreementVersion, 'sl-lock-v1');
    assert.equal(importRow.approval_snapshot.totalGrossCents, 80000); // 100000 - 20000
    assert.equal(importRow.approval_snapshot.splits.length, 2);

    // Verify split records statuses: positive line -> approved, chargeback line -> clawback
    const splitRows = (
      await c.query<{ status: string; gross_amount_cents: string }>(
        'SELECT status, gross_amount_cents FROM commission_splits WHERE import_id = $1 ORDER BY gross_amount_cents DESC',
        [imp.id]
      )
    ).rows;
    assert.equal(splitRows.length, 2);
    assert.ok(splitRows[0]);
    assert.ok(splitRows[1]);
    assert.equal(splitRows[0].status, 'approved');
    assert.equal(splitRows[1].status, 'clawback');

    // 6. Verify Line Item Uniqueness Constraint: duplicate split insert must fail
    const lineItem = (
      await c.query<{ id: string }>('SELECT id FROM commission_line_items WHERE import_id = $1 LIMIT 1', [imp.id])
    ).rows[0];
    assert.ok(lineItem);
    await assert.rejects(
      async () => {
        await c.query(
          `INSERT INTO commission_splits (
             tenant_id, import_id, line_item_id, agreement_id, producer_node_id, status,
             gross_amount_cents, broker_net_cents, branch_override_cents, mga_spread_cents, holdback_cents
           ) VALUES ($1, $2, $3, $4, $5, 'calculated', 1000, 800, 100, 100, 0)`,
          [tenantId, imp.id, lineItem.id, slAgreeRes.json.agreement.id, brokerNodeId]
        );
      },
      (err: any) => {
        return err.code === '23505' && err.constraint === 'comm_splits_line_unique';
      },
      'Unique constraint comm_splits_line_unique must prevent duplicate split for same line item'
    );

    // 7. Verify Database Lock Trigger: trg_lock_approved_commission_splits blocks UPDATE and DELETE
    await assert.rejects(
      async () => {
        await c.query('UPDATE commission_splits SET broker_net_cents = 0 WHERE import_id = $1', [imp.id]);
      },
      (err: any) => {
        return err.message.includes('Cannot modify or delete commission splits for an approved or posted statement');
      },
      'Lock trigger must prevent UPDATE on splits of approved import'
    );

    await assert.rejects(
      async () => {
        await c.query('DELETE FROM commission_splits WHERE import_id = $1', [imp.id]);
      },
      (err: any) => {
        return err.message.includes('Cannot modify or delete commission splits for an approved or posted statement');
      },
      'Lock trigger must prevent DELETE on splits of approved import'
    );

    // 8. Verify Database Lock Trigger: trg_lock_approved_commission_imports blocks UPDATE and DELETE
    await assert.rejects(
      async () => {
        await c.query("UPDATE commission_imports SET status = 'reconciled' WHERE id = $1", [imp.id]);
      },
      (err: any) => {
        return err.message.includes('Cannot revoke or alter status of an approved statement');
      },
      'Lock trigger must prevent UPDATE on approved commission import'
    );

    await assert.rejects(
      async () => {
        await c.query('DELETE FROM commission_imports WHERE id = $1', [imp.id]);
      },
      (err: any) => {
        return err.message.includes('Cannot delete an approved commission statement');
      },
      'Lock trigger must prevent DELETE on approved commission import'
    );
  });
});

