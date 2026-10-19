import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb, type TestDb } from '@pii/db/testing';
import {
  bootstrapPilotBrokerage,
  generatePilotCarrierCsv,
  DEFAULT_PILOT_CONFIG,
  type PilotBrokerageResult,
} from '../src/pilot-bootstrap.ts';

let db: TestDb;

before(async () => {
  db = await createTestDb('ca-qc');
});

after(async () => {
  await db.drop();
});

test('Gate 4 Pilot Provisioning: generatePilotCarrierCsv creates valid formatted CSV', () => {
  const csv = generatePilotCarrierCsv('ia-financial-group', [
    {
      policyNumber: 'POL-QC-2026-001',
      clientName: 'Tremblay, Jean-Francois',
      transactionType: 'first_year',
      grossAmountDollars: '2400.00',
      netAmountDollars: '1200.00',
      producerCode: 'QC-PROD-01',
    },
    {
      policyNumber: 'POL-ON-2026-002',
      clientName: 'Jane Smith',
      transactionType: 'renewal',
      grossAmountDollars: '1800.00',
      netAmountDollars: '180.00',
      producerCode: 'ON-PROD-02',
    },
  ]);

  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'policy_number,client_name,transaction_type,gross_amount,net_amount,producer_code');
  assert.match(lines[1]!, /^POL-QC-2026-001,"Tremblay, Jean-Francois",first_year,2400\.00,1200\.00,QC-PROD-01$/);
  assert.match(lines[2]!, /^POL-ON-2026-002,Jane Smith,renewal,1800\.00,180\.00,ON-PROD-02$/);
});

test('Gate 4 Pilot Provisioning: bootstrapPilotBrokerage initializes complete multi-branch Canadian brokerage', async () => {
  const result: PilotBrokerageResult = await bootstrapPilotBrokerage(db.ownerUrl);

  assert.ok(result.tenantId);
  assert.ok(result.rootNodeId);
  assert.ok(result.adminUserId);
  assert.ok(result.pipelineId);

  // 1. Verify Branches
  assert.equal(Object.keys(result.branches).length, 3);
  assert.ok(result.branches.montreal);
  assert.equal(result.branches.montreal.jurisdiction, 'QC');
  assert.equal(result.branches.montreal.locale, 'fr-CA');
  assert.ok(result.branches.toronto);
  assert.equal(result.branches.toronto.jurisdiction, 'ON');
  assert.ok(result.branches.vancouver);
  assert.equal(result.branches.vancouver.jurisdiction, 'BC');

  // 2. Verify Corporate Partners
  assert.equal(Object.keys(result.partners).length, 3);
  assert.equal(result.partners.montreal?.name, 'Cabinet de Services Financiers Gill & Associés');
  assert.equal(result.partners.toronto?.name, 'Maple Ridge Wealth & Insurance Services');
  assert.equal(result.partners.vancouver?.name, 'Pacific Rim Advisory Group');

  // 3. Verify Users and Roles
  assert.ok(result.users['admin@punjab-pilot.test']);
  assert.deepEqual(result.users['admin@punjab-pilot.test'].roles, ['admin']);

  assert.ok(result.users['ho@punjab-pilot.test']);
  assert.deepEqual(result.users['ho@punjab-pilot.test'].roles, ['compliance', 'staff']);

  assert.ok(result.users['finance@punjab-pilot.test']);
  assert.deepEqual(result.users['finance@punjab-pilot.test'].roles, ['compliance', 'staff']);

  assert.ok(result.users['manager-mtl@punjab-pilot.test']);
  assert.deepEqual(result.users['manager-mtl@punjab-pilot.test'].roles, ['manager']);

  assert.ok(result.users['broker-mtl@punjab-pilot.test']);
  assert.deepEqual(result.users['broker-mtl@punjab-pilot.test'].roles, ['partner']);

  // 4. Verify Commission Agreements with Holdbacks
  assert.equal(result.commissionAgreements.montreal?.carrierId, 'ia-financial-group');
  assert.equal(result.commissionAgreements.montreal?.holdbackBps, 0);
  assert.equal(result.commissionAgreements.toronto?.carrierId, 'sun-life');
  assert.equal(result.commissionAgreements.toronto?.holdbackBps, 200);

  // 5. Verify direct database invariants
  const client = new pg.Client({ connectionString: db.ownerUrl });
  await client.connect();
  try {
    // Check tenant record
    const tRes = await client.query('SELECT name, country_code, region, default_locale, is_head_office FROM tenants WHERE id = $1', [result.tenantId]);
    assert.equal(tRes.rows[0]?.name, DEFAULT_PILOT_CONFIG.tenantName);
    assert.equal(tRes.rows[0]?.country_code, 'CA');
    assert.equal(tRes.rows[0]?.region, 'ca-qc');
    assert.equal(tRes.rows[0]?.default_locale, 'fr-CA');
    assert.equal(tRes.rows[0]?.is_head_office, true);

    // Check org links (location -> partner)
    const linksRes = await client.query('SELECT kind FROM org_links WHERE tenant_id = $1 AND kind = $2', [result.tenantId, 'location_link']);
    assert.equal(linksRes.rows.length, 3);

    // Check compliance items (licence + eo for all 3 partners = 6 items)
    const compRes = await client.query('SELECT kind, limit_amount FROM compliance_items WHERE tenant_id = $1', [result.tenantId]);
    assert.equal(compRes.rows.length, 6);
    const eoItems = compRes.rows.filter((r) => r.kind === 'eo');
    assert.equal(eoItems.length, 3);
    for (const eo of eoItems) {
      assert.equal(Number(eo.limit_amount), 2000000.00);
    }

    // Check pipeline stages
    const stagesRes = await client.query('SELECT name, is_won, is_lost FROM stages WHERE pipeline_id = $1 ORDER BY position', [result.pipelineId]);
    assert.equal(stagesRes.rows.length, 6);
    assert.equal(stagesRes.rows[0]?.name, 'New Lead');
    assert.equal(stagesRes.rows[4]?.name, 'Policy Issued');
    assert.equal(stagesRes.rows[4]?.is_won, true);

    // Check audit log
    const auditRes = await client.query("SELECT action FROM audit_log WHERE tenant_id = $1 AND action = 'pilot_brokerage_bootstrapped'", [result.tenantId]);
    assert.equal(auditRes.rows.length, 1);
  } finally {
    await client.end();
  }
});
