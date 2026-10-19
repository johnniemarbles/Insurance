import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import {
  loadConfig,
  localKeyProvider,
  bootstrapPilotBrokerage,
  generatePilotCarrierCsv,
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
const BROKER_MTL = 'broker-mtl@punjab-pilot.test';
const BROKER_TOR = 'broker-tor@punjab-pilot.test';
const FINANCE = 'finance@punjab-pilot.test';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function call(email: string | null, method: HttpMethod, url: string, body?: unknown, headers?: Record<string, string>) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(email ? { 'x-dev-user-email': email } : {}),
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

  // Run Master Pilot Bootstrap
  pilot = await bootstrapPilotBrokerage(db.ownerUrl);

  // Pre-accept Law 25 privacy notices for all pilot personas
  const personas = [
    ADMIN,
    HO,
    COMPLIANCE_QC,
    COMPLIANCE_ON,
    MGR_MTL,
    MGR_TOR,
    BROKER_MTL,
    BROKER_TOR,
    FINANCE,
  ];

  await owner(async (c) => {
    for (const email of personas) {
      const u = pilot.users[email];
      if (u) {
        await c.query(
          `INSERT INTO consent_records (
             tenant_id, user_id, kind, notice_version, locale, region
           ) VALUES ($1, $2, 'first_login', 'v1', 'fr-CA', 'ca-qc')
           ON CONFLICT DO NOTHING`,
          [pilot.tenantId, u.id]
        );
      }
    }
  });
});

after(async () => {
  await app.close();
  for (const p of pools) await p.end();
  await db.drop();
});

test('Gate 5 UAT 1: Pilot Brokerage Foundation & Active Policy Registry', async () => {
  // Montreal Manager creates a valid in-force policy for Montreal Branch
  const policyRes = await call(MGR_MTL, 'POST', '/v1/commercial/policies', {
    carrierId: 'ia-financial-group',
    branchNodeId: pilot.branches.montreal!.id,
    producerNodeId: pilot.partners.montreal!.id,
    policyNumber: 'IA-POL-G5-001',
    planName: 'EquiBuild Universal Life',
    jurisdiction: 'QC',
    modalPremiumCents: 150000, // $1,500.00
    premiumFrequency: 'monthly',
    annualPremiumCents: 1800000, // $18,000.00
    clientName: 'Jean-Luc Tremblay',
    status: 'active',
    effectiveDate: '2026-10-01',
  });

  assert.equal(policyRes.status, 201, `Failed to create policy: ${JSON.stringify(policyRes.json)}`);
  assert.equal(policyRes.json.policy.policy_number, 'IA-POL-G5-001');
  assert.equal(policyRes.json.policy.annual_premium_cents, 1800000);
});

test('Gate 5 UAT 2: Statement Reconciliation & Deterministic Split Finalization', async () => {
  // Ingest carrier CSV statement with Montreal broker line item
  const csvContent = generatePilotCarrierCsv('ia-financial-group', [
    {
      policyNumber: 'IA-POL-G5-001',
      clientName: 'Jean-Luc Tremblay',
      transactionType: 'first_year',
      grossAmountDollars: '1500.00',
      netAmountDollars: '1500.00',
      producerCode: 'MTL-IA-01',
    },
  ]);

  const previewRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv-preview', {
    carrierId: 'ia-financial-group',
    statementReference: 'STMT-G5-IA-OCT26',
    statementDate: '2026-10-25',
    csvContent,
  });

  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.json.preview.unmatchedCount, 0);

  // Commit CSV Statement
  const commitRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'ia-financial-group',
    statementReference: 'STMT-G5-IA-OCT26',
    statementDate: '2026-10-25',
    csvContent,
  });

  assert.equal(commitRes.status, 201);
  const importId = commitRes.json.import.id;
  assert.equal(commitRes.json.import.status, 'reconciled');

  // Approve statement (Head Office / Finance Officer)
  const approveRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/approve`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.status, 'approved');

  // Verify splits: 65% broker net ($975.00), 10% branch ($150.00), 25% MGA spread ($375.00)
  const splitsRes = await call(FINANCE, 'GET', `/v1/commercial/commission-imports/${importId}/splits`);
  assert.equal(splitsRes.status, 200);
  assert.equal(splitsRes.json.splits.length, 1);
  const split = splitsRes.json.splits[0];
  assert.equal(split.broker_net_cents ?? split.brokerNetCents, 97500);
  assert.equal(split.branch_override_cents ?? split.branchOverrideCents, 15000);
  assert.equal(split.mga_spread_cents ?? split.mgaSpreadCents, 37500);
});

test('Gate 5 UAT 3: Dual-Custody Payout Batch Staging (Custody 1: Preparation)', async () => {
  // Look up the approved statement
  const importsRes = await call(FINANCE, 'GET', '/v1/commercial/commission-imports');
  const imp = importsRes.json.imports.find((i: any) => (i.statement_reference || i.statementReference) === 'STMT-G5-IA-OCT26');
  assert.ok(imp, 'Statement should exist');

  // Finance Officer stages the CPA 005 payout batch
  const stageRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${imp.id}/payout-batch/stage`, {
    currency: 'CAD',
  });

  assert.equal(stageRes.status, 200, `Failed to stage payout batch: ${JSON.stringify(stageRes.json)}`);
  assert.equal(stageRes.json.ok, true);
  assert.equal(stageRes.json.batch.status, 'pending_dual_approval');
  assert.equal(stageRes.json.batch.fileFormat, 'CPA_005');
  assert.equal(stageRes.json.batch.currency, 'CAD');
  // Total disbursement = $975.00 broker net + $150.00 branch override = $1,125.00 (112,500 cents)
  assert.equal(stageRes.json.batch.totalAmountCents, 112500);
  assert.equal(stageRes.json.batch.splitCount, 1);
  assert.match(stageRes.json.batch.fileSha256, /^[a-f0-9]{64}$/);

  // Retrieve batch details and inspect generated CPA 005 direct deposit file
  const batchId = stageRes.json.batch.id;
  const getBatchRes = await call(FINANCE, 'GET', `/v1/commercial/payout-batches/${batchId}`);
  assert.equal(getBatchRes.status, 200);
  assert.equal(getBatchRes.json.batch.id, batchId);
  assert.equal(getBatchRes.json.batch.status, 'pending_dual_approval');
  assert.equal(getBatchRes.json.batch.splits.length, 1);
  assert.equal(getBatchRes.json.batch.splits[0].account_number_masked ?? getBatchRes.json.batch.splits[0].accountNumberMasked, '********5544');

  // Verify CPA 005 content structure
  const fileLines = getBatchRes.json.batch.fileContent.trim().split('\r\n');
  assert.equal(fileLines.length, 3); // Header (A), Detail (C), Trailer (Z)
  assert.ok(fileLines[0].startsWith('A98765432100001'));
  assert.ok(fileLines[1].startsWith('C2000000112500000110293')); // Code 200, 112500 cents, transit
  assert.ok(fileLines[2].startsWith('Z0000000011250000000001')); // Total 112500, count 1
});

test('Gate 5 UAT 4: Dual-Custody Invariant & Self-Approval Prevention', async () => {
  const importsRes = await call(FINANCE, 'GET', '/v1/commercial/commission-imports');
  const imp = importsRes.json.imports.find((i: any) => (i.statement_reference || i.statementReference) === 'STMT-G5-IA-OCT26');
  const batchRes = await owner(async (c) => {
    return (await c.query(`SELECT id, status, prepared_by FROM payout_batches WHERE import_id = $1`, [imp.id])).rows[0];
  });
  const batchId = batchRes.id;

  // 1. Finance Officer who prepared the batch attempts to self-approve -> MUST BE FORBIDDEN (403)
  const selfApproveRes = await call(FINANCE, 'POST', `/v1/commercial/payout-batches/${batchId}/approve`);
  assert.equal(selfApproveRes.status, 403, 'Finance preparer MUST NOT be allowed to self-approve payout batch');
  assert.match(selfApproveRes.json.error.message, /Dual custody violation: Preparer cannot self-approve/i);

  // 2. Attempt to release batch without dual-approval -> MUST FAIL (409 Conflict)
  const prematureReleaseRes = await call(FINANCE, 'POST', `/v1/commercial/payout-batches/${batchId}/release`);
  assert.equal(prematureReleaseRes.status, 409, 'Batch must not be released before dual approval');

  // 3. Independent Compliance Officer approves the payout batch -> SUCCESS (200 OK)
  const complianceApproveRes = await call(COMPLIANCE_QC, 'POST', `/v1/commercial/payout-batches/${batchId}/approve`);
  assert.equal(complianceApproveRes.status, 200, `Compliance dual-approval failed: ${JSON.stringify(complianceApproveRes.json)}`);
  assert.equal(complianceApproveRes.json.ok, true);
  assert.equal(complianceApproveRes.json.batch.status, 'approved');
  assert.equal(complianceApproveRes.json.batch.approvedBy, pilot.users[COMPLIANCE_QC]!.id);
});

test('Gate 5 UAT 5: Disbursement Release & Ledger Immutability Lock', async () => {
  const importsRes = await call(FINANCE, 'GET', '/v1/commercial/commission-imports');
  const imp = importsRes.json.imports.find((i: any) => (i.statement_reference || i.statementReference) === 'STMT-G5-IA-OCT26');
  const batchRes = await owner(async (c) => {
    return (await c.query(`SELECT id, status, batch_file_sha256 FROM payout_batches WHERE import_id = $1`, [imp.id])).rows[0];
  });
  const batchId = batchRes.id;

  // Finance Officer executes release of dual-approved payout batch
  const releaseRes = await call(FINANCE, 'POST', `/v1/commercial/payout-batches/${batchId}/release`);
  assert.equal(releaseRes.status, 200, `Failed to release batch: ${JSON.stringify(releaseRes.json)}`);
  assert.equal(releaseRes.json.ok, true);
  assert.equal(releaseRes.json.batch.status, 'released');
  assert.ok(releaseRes.json.batch.releasedAt);
  assert.equal(releaseRes.json.batch.transmissionSha256, batchRes.batch_file_sha256);

  // Direct Payout Route without dual custody continues to be rejected with 403 Forbidden
  const rawPayoutRes = await call(ADMIN, 'POST', `/v1/commercial/commission-imports/${imp.id}/payout`);
  assert.equal(rawPayoutRes.status, 403, 'Unilateral payout endpoint remains strictly disabled');

  // Database Immutability Trigger Lock: Attempting to UPDATE released payout batch MUST throw exception
  await assert.rejects(
    async () => {
      await owner(async (c) => {
        await c.query(`UPDATE payout_batches SET total_amount_cents = 9999 WHERE id = $1`, [batchId]);
      });
    },
    (err: any) => {
      return /Cannot modify a released payout batch/i.test(err.message);
    },
    'Immutability trigger must block modification of released payout batch'
  );

  // Database Immutability Trigger Lock: Attempting to DELETE released payout batch MUST throw exception
  await assert.rejects(
    async () => {
      await owner(async (c) => {
        await c.query(`DELETE FROM payout_batches WHERE id = $1`, [batchId]);
      });
    },
    (err: any) => {
      return /Cannot delete an approved or released payout batch/i.test(err.message);
    },
    'Immutability trigger must block deletion of released payout batch'
  );
});

test('Gate 5 UAT 6: US NACHA ACH Payout Batch Workflow', async () => {
  // Toronto Manager creates a USD policy for US operations
  const policyRes = await call(MGR_TOR, 'POST', '/v1/commercial/policies', {
    carrierId: 'sun-life',
    branchNodeId: pilot.branches.toronto!.id,
    producerNodeId: pilot.partners.toronto!.id,
    policyNumber: 'SL-USD-G5-101',
    planName: 'Sun Life Universal Series US',
    jurisdiction: 'ON',
    modalPremiumCents: 250000, // $2,500.00
    premiumFrequency: 'annual',
    annualPremiumCents: 250000,
    clientName: 'Robert Vance',
    status: 'active',
    effectiveDate: '2026-10-15',
  });
  assert.equal(policyRes.status, 201);

  // Ingest statement
  const csvContent = generatePilotCarrierCsv('sun-life', [
    {
      policyNumber: 'SL-USD-G5-101',
      clientName: 'Robert Vance',
      transactionType: 'first_year',
      grossAmountDollars: '2500.00',
      netAmountDollars: '2500.00',
      producerCode: 'TOR-SL-01',
    },
  ]);

  const commitRes = await call(FINANCE, 'POST', '/v1/commercial/commission-imports/csv', {
    carrierId: 'sun-life',
    statementReference: 'STMT-US-SL-OCT26',
    statementDate: '2026-10-25',
    csvContent,
  });
  assert.equal(commitRes.status, 201);
  const importId = commitRes.json.import.id;

  // Approve statement
  const stmtApproveRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/approve`);
  assert.equal(stmtApproveRes.status, 200);

  // Stage NACHA Batch (USD)
  const stageRes = await call(FINANCE, 'POST', `/v1/commercial/commission-imports/${importId}/payout-batch/stage`, {
    currency: 'USD',
  });
  assert.equal(stageRes.status, 200);
  assert.equal(stageRes.json.batch.fileFormat, 'NACHA');
  assert.equal(stageRes.json.batch.currency, 'USD');
  const batchId = stageRes.json.batch.id;

  // Verify NACHA 94-char records
  const getBatchRes = await call(FINANCE, 'GET', `/v1/commercial/payout-batches/${batchId}`);
  const lines = getBatchRes.json.batch.fileContent.trim().split('\r\n');
  assert.ok(lines.length >= 5);
  for (const line of lines) {
    assert.equal(line.length, 94, `NACHA record width must be exactly 94 chars: ${line}`);
  }
  assert.equal(lines[0][0], '1', 'File Header record');
  assert.equal(lines[1][0], '5', 'Batch Header record');
  assert.ok(lines[1].includes('PPD'), 'Standard Entry Class Code PPD');

  // Dual Approval by Compliance Officer
  const approveRes = await call(COMPLIANCE_ON, 'POST', `/v1/commercial/payout-batches/${batchId}/approve`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.batch.status, 'approved');

  // Release by Finance Officer
  const releaseRes = await call(FINANCE, 'POST', `/v1/commercial/payout-batches/${batchId}/release`);
  assert.equal(releaseRes.status, 200);
  assert.equal(releaseRes.json.batch.status, 'released');
});

test('Gate 5 UAT 7: Insurer Production Appointment Sign-Off Protocol & Controlled Dispatch', async () => {
  // 1. Attempting production sign-off before gates are complete MUST fail (422)
  const prematureSignoff = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/production-signoff', {
    appointmentReference: 'MGA-IA-2026-LIVE',
    insurerSignoffContact: 'VP Operations, iA Financial',
    dpaAgreementHash: 'a'.repeat(64),
    tierExpiresOn: '2027-12-31',
  });
  assert.equal(prematureSignoff.status, 422, 'Premature production sign-off must fail with 422');
  assert.match(prematureSignoff.json.error.message, /All 5 certification gates must be completed/i);

  // 2. Complete Gates 1 - 5 for iA Financial Group
  await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate1_legal_agreement',
    evidence: 'Bilateral Insurer Master Distribution Agreement signed 2026-10-01',
  });
  await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate2_sandbox_certified',
    evidence: 'Gate 3 synthetic sandbox protocol verified: 25 concurrent webhook requests, 0 defects',
  });
  await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate3_kms_secrets_provisioned',
    evidence: 'Dual-key KMS envelope encryption provisioned in ca-central-1',
  });
  await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate4_outbox_safety_verified',
    evidence: 'Transactional outbox dead-letter queue, replay guard, and audit verification certified',
  });
  await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/gate', {
    gateKey: 'gate5_feature_flag_active',
    evidence: 'CHG-2026-PROD-IA approved by Chief Compliance Officer',
  });

  // 3. Execute formal production appointment sign-off protocol
  const dpaHash = createHash('sha256').update('Bilateral DPA iA Financial Group 2026', 'utf8').digest('hex');
  const signoffRes = await call(COMPLIANCE_QC, 'POST', '/v1/compliance/carrier-certifications/ia-financial-group/production-signoff', {
    appointmentReference: 'MGA-IA-2026-LIVE',
    insurerSignoffContact: 'VP Distribution, iA Financial Group',
    dpaAgreementHash: dpaHash,
    tierExpiresOn: '2027-12-31',
    jurisdictions: ['QC', 'ON'],
  });

  assert.equal(signoffRes.status, 200, `Sign-off failed: ${JSON.stringify(signoffRes.json)}`);
  assert.equal(signoffRes.json.ok, true);
  assert.equal(signoffRes.json.tier, 'live');
  assert.equal(signoffRes.json.dispatchLocked, false);
  assert.equal(signoffRes.json.signoff.appointment_reference, 'MGA-IA-2026-LIVE');

  // 4. Query carrier certifications registry and verify dispatchLocked is false for iA Financial Group, but true for Sun Life
  const certsRes = await call(COMPLIANCE_QC, 'GET', '/v1/compliance/carrier-certifications');
  assert.equal(certsRes.status, 200);
  const iaCert = certsRes.json.certifications.find((c: any) => c.carrierId === 'ia-financial-group');
  const slCert = certsRes.json.certifications.find((c: any) => c.carrierId === 'sun-life');

  assert.equal(iaCert.currentTier, 'live');
  assert.equal(iaCert.dispatchLocked, false, 'iA Financial Group dispatch lock should be released to false');
  assert.equal(slCert.dispatchLocked, true, 'Sun Life dispatch lock should remain strictly locked true');
});

test('Gate 5 UAT 8: Production Telemetry & Operational Health Probes', async () => {
  // 1. Liveness Probe
  const healthRes = await call(null, 'GET', '/healthz');
  assert.equal(healthRes.status, 200);
  assert.deepEqual(healthRes.json, { ok: true });

  // 2. Readiness Probe with Deployment Integrity
  const readyRes = await call(null, 'GET', '/readyz');
  assert.equal(readyRes.status, 200);
  assert.equal(readyRes.json.ok, true);
  assert.equal(readyRes.json.region, 'ca-qc');

  // 3. Operational Telemetry Probe
  const telemetryRes = await call(null, 'GET', '/v1/ops/telemetry');
  assert.equal(telemetryRes.status, 200);
  assert.equal(telemetryRes.json.ok, true);
  assert.equal(telemetryRes.json.country, 'CA');
  assert.equal(telemetryRes.json.database.connected, true);
  assert.ok(typeof telemetryRes.json.database.queryLatencyMs === 'number');
  assert.ok(telemetryRes.json.process.uptimeSeconds >= 0);
  assert.ok(telemetryRes.json.process.memoryUsageMb.rss > 0);
});
