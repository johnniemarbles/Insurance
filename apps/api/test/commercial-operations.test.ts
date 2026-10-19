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
