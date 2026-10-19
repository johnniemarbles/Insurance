import { randomUUID } from 'node:crypto';
import pg from 'pg';

export interface PilotBranchSpec {
  key: 'montreal' | 'toronto' | 'vancouver';
  name: string;
  jurisdiction: 'QC' | 'ON' | 'BC';
  locale: 'en' | 'fr-CA';
  managerEmail: string;
  managerName: string;
  complianceEmail?: string;
  complianceName?: string;
  partnerNodeName: string;
  brokerEmail: string;
  brokerName: string;
  licenseNumber: string;
  regulatoryBody: 'AMF' | 'FSRA' | 'BCFSA';
  carrierId: string;
  brokerSplitBps: number;
  branchOverrideBps: number;
  mgaSpreadBps: number;
  holdbackBps: number;
}

export interface PilotBrokerageConfig {
  tenantName: string;
  countryCode: 'CA' | 'US';
  defaultLocale: 'en' | 'fr-CA';
  adminEmail: string;
  adminName: string;
  branches: PilotBranchSpec[];
}

export interface PilotBrokerageResult {
  tenantId: string;
  rootNodeId: string;
  adminUserId: string;
  branches: Record<string, { id: string; name: string; jurisdiction: string; locale: string }>;
  partners: Record<string, { id: string; name: string; branchKey: string }>;
  users: Record<string, { id: string; email: string; name: string; roles: string[]; homeNodeId: string; locale: string }>;
  commissionAgreements: Record<string, { id: string; carrierId: string; producerNodeId: string; version: string; holdbackBps: number }>;
  pipelineId: string;
}

export const DEFAULT_PILOT_CONFIG: PilotBrokerageConfig = {
  tenantName: 'Punjab Insurance Inc. (Pilot)',
  countryCode: 'CA',
  defaultLocale: 'fr-CA',
  adminEmail: 'admin@punjab-pilot.test',
  adminName: 'Harpreet Singh (Tenant Admin)',
  branches: [
    {
      key: 'montreal',
      name: 'Montreal Branch (QC)',
      jurisdiction: 'QC',
      locale: 'fr-CA',
      managerEmail: 'manager-mtl@punjab-pilot.test',
      managerName: 'Amandeep Kaur (Montreal Manager)',
      complianceEmail: 'compliance-qc@punjab-pilot.test',
      complianceName: 'Jean-Francois Tremblay (QC Compliance Officer)',
      partnerNodeName: 'Cabinet de Services Financiers Gill & Associés',
      brokerEmail: 'broker-mtl@punjab-pilot.test',
      brokerName: 'Baljit Gill (Broker Principal)',
      licenseNumber: 'QC-AMF-44912',
      regulatoryBody: 'AMF',
      carrierId: 'ia-financial-group',
      brokerSplitBps: 6500,
      branchOverrideBps: 1000,
      mgaSpreadBps: 2500,
      holdbackBps: 0,
    },
    {
      key: 'toronto',
      name: 'Toronto Branch (ON)',
      jurisdiction: 'ON',
      locale: 'en',
      managerEmail: 'manager-tor@punjab-pilot.test',
      managerName: 'Rajinder Sharma (Toronto Manager)',
      complianceEmail: 'compliance-on@punjab-pilot.test',
      complianceName: 'David Miller (ON Compliance Officer)',
      partnerNodeName: 'Maple Ridge Wealth & Insurance Services',
      brokerEmail: 'broker-tor@punjab-pilot.test',
      brokerName: 'Vikram Patel (Broker Principal)',
      licenseNumber: 'ON-FSRA-78192',
      regulatoryBody: 'FSRA',
      carrierId: 'sun-life',
      brokerSplitBps: 7000,
      branchOverrideBps: 1000,
      mgaSpreadBps: 2000,
      holdbackBps: 200,
    },
    {
      key: 'vancouver',
      name: 'Vancouver Branch (BC)',
      jurisdiction: 'BC',
      locale: 'en',
      managerEmail: 'manager-van@punjab-pilot.test',
      managerName: 'Sarah Jenkins (Vancouver Manager)',
      partnerNodeName: 'Pacific Rim Advisory Group',
      brokerEmail: 'broker-van@punjab-pilot.test',
      brokerName: 'Gurpreet Dhillon (Broker Principal)',
      licenseNumber: 'BC-BCFSA-33104',
      regulatoryBody: 'BCFSA',
      carrierId: 'manulife',
      brokerSplitBps: 6000,
      branchOverrideBps: 1500,
      mgaSpreadBps: 2500,
      holdbackBps: 500,
    },
  ],
};

export async function bootstrapPilotBrokerage(
  clientOrUrl: pg.Client | string,
  customConfig?: Partial<PilotBrokerageConfig>,
): Promise<PilotBrokerageResult> {
  const config: PilotBrokerageConfig = {
    ...DEFAULT_PILOT_CONFIG,
    ...customConfig,
    branches: customConfig?.branches ?? DEFAULT_PILOT_CONFIG.branches,
  };

  let client: pg.Client;
  let ownClient = false;
  if (typeof clientOrUrl === 'string') {
    client = new pg.Client({ connectionString: clientOrUrl });
    await client.connect();
    ownClient = true;
  } else {
    client = clientOrUrl;
  }

  try {
    await client.query('BEGIN');

    const tenantId = randomUUID();
    const rootNodeId = randomUUID();
    const adminUserId = randomUUID();
    const region = config.countryCode === 'CA' ? 'ca-qc' : 'us';

    // 1. Transaction context for RLS session
    for (const [k, v] of [
      ['app.tenant_id', tenantId],
      ['app.user_id', adminUserId],
      ['app.node_ids', `{${rootNodeId}}`],
      ['app.is_tenant_admin', 'true'],
      ['app.can_write', 'true'],
    ] as const) {
      await client.query('SELECT set_config($1, $2, true)', [k, v]);
    }

    // 2. Tenant & Settings
    await client.query(
      `INSERT INTO tenants (id, name, country_code, region, default_locale, is_head_office)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [tenantId, config.tenantName, config.countryCode, region, config.defaultLocale],
    );

    await client.query(
      `INSERT INTO tenant_settings (tenant_id, max_partner_levels)
       VALUES ($1, 3)`,
      [tenantId],
    );

    // 3. Root Node
    await client.query(
      `INSERT INTO org_nodes (id, tenant_id, type, name)
       VALUES ($1, $2, 'tenant', $3)`,
      [rootNodeId, tenantId, config.tenantName],
    );

    const users: PilotBrokerageResult['users'] = {};

    // Helper to insert user and roles
    async function createUser(
      email: string,
      name: string,
      nodeId: string,
      roles: string[],
      locale: 'en' | 'fr-CA',
      userIdOverride?: string,
    ): Promise<string> {
      const uid = userIdOverride ?? randomUUID();
      await client.query(
        `INSERT INTO app_users (id, tenant_id, email, display_name, locale, status, home_node_id)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
        [uid, tenantId, email.trim().toLowerCase(), name, locale, nodeId],
      );
      for (const role of roles) {
        await client.query(
          `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [tenantId, uid, nodeId, role],
        );
      }
      users[email.trim().toLowerCase()] = {
        id: uid,
        email: email.trim().toLowerCase(),
        name,
        roles,
        homeNodeId: nodeId,
        locale,
      };
      return uid;
    }

    // 4. Admin User
    await createUser(
      config.adminEmail,
      config.adminName,
      rootNodeId,
      ['admin'],
      config.defaultLocale,
      adminUserId,
    );

    // 5. Head Office Personas
    await createUser('ho@punjab-pilot.test', 'Harpreet Singh (HO Operations & Compliance)', rootNodeId, ['compliance', 'staff'], config.defaultLocale);
    await createUser('finance@punjab-pilot.test', 'Sonia Roy (HO Finance & Reconciliation)', rootNodeId, ['compliance', 'staff'], config.defaultLocale);
    await createUser('auditor@punjab-pilot.test', 'KPMG External Compliance Auditor', rootNodeId, ['auditor'], config.defaultLocale);
    await createUser('trainer@punjab-pilot.test', 'National Training Director', rootNodeId, ['trainer'], config.defaultLocale);

    const branches: PilotBrokerageResult['branches'] = {};
    const partners: PilotBrokerageResult['partners'] = {};
    const commissionAgreements: PilotBrokerageResult['commissionAgreements'] = {};

    // 6. Provision Branches, Partners, Compliance & Commission Agreements
    for (const b of config.branches) {
      const branchId = randomUUID();
      await client.query(
        `INSERT INTO org_nodes (id, tenant_id, type, name)
         VALUES ($1, $2, 'location', $3)`,
        [branchId, tenantId, b.name],
      );
      branches[b.key] = { id: branchId, name: b.name, jurisdiction: b.jurisdiction, locale: b.locale };

      // Branch Manager
      await createUser(b.managerEmail, b.managerName, branchId, ['manager'], b.locale);

      // Branch Compliance Officer (if configured)
      if (b.complianceEmail && b.complianceName) {
        await createUser(b.complianceEmail, b.complianceName, branchId, ['compliance'], b.locale);
      }

      // Branch-specific trainees & staff for Montreal
      if (b.key === 'montreal') {
        await createUser('learner@punjab-pilot.test', 'Simran Gill (Licensed Trainee Broker)', branchId, ['learner'], 'fr-CA');
        await createUser('staff-mtl@punjab-pilot.test', 'Marie Dupont (Montreal Operations Staff)', branchId, ['staff'], 'fr-CA');
      }

      // Corporate Partner Node
      const partnerId = randomUUID();
      await client.query(
        `INSERT INTO org_nodes (id, tenant_id, type, name)
         VALUES ($1, $2, 'partner', $3)`,
        [partnerId, tenantId, b.partnerNodeName],
      );

      // Link partner to branch location
      await client.query(
        `INSERT INTO org_links (tenant_id, parent_id, child_id, kind)
         VALUES ($1, $2, $3, 'location_link')`,
        [tenantId, branchId, partnerId],
      );
      partners[b.key] = { id: partnerId, name: b.partnerNodeName, branchKey: b.key };

      // Broker Principal
      await createUser(b.brokerEmail, b.brokerName, partnerId, ['partner'], b.locale);

      // Compliance Profile for Partner Agency
      await client.query(
        `INSERT INTO compliance_profiles (
           node_id, tenant_id, entity_type, legal_name, business_number,
           fields, status, submitted_at
         ) VALUES ($1, $2, 'corporation', $3, $4, $5, 'approved', now())`,
        [
          partnerId,
          tenantId,
          b.partnerNodeName,
          `BN-${b.jurisdiction}-99812`,
          JSON.stringify({ jurisdiction: b.jurisdiction, regulatoryBody: b.regulatoryBody }),
        ],
      );

      // Mandatory Licence Compliance Item
      await client.query(
        `INSERT INTO compliance_items (
           tenant_id, node_id, kind, label, number, jurisdiction,
           lines, expires_on
         ) VALUES (
           $1, $2, 'licence', $3, $4, $5,
           $6, CURRENT_DATE + INTERVAL '1 year'
         )`,
        [
          tenantId,
          partnerId,
          `${b.regulatoryBody} Life and Health Representative`,
          b.licenseNumber,
          b.jurisdiction,
          ['life', 'accident_sickness'],
        ],
      );

      // Mandatory E&O Policy ($2M coverage >= $1M statutory minimum)
      await client.query(
        `INSERT INTO compliance_items (
           tenant_id, node_id, kind, label, number,
           limit_amount, expires_on
         ) VALUES (
           $1, $2, 'eo', 'Trisura Guarantee Insurance Company', $3,
           2000000.00, CURRENT_DATE + INTERVAL '1 year'
         )`,
        [tenantId, partnerId, `POL-EO-${b.jurisdiction}-2026-99`],
      );

      // Contractual Commission Agreement
      const agreementId = randomUUID();
      await client.query(
        `INSERT INTO commission_agreements (
           id, tenant_id, producer_node_id, carrier_id, version,
           broker_split_bps, branch_override_bps, mga_spread_bps, holdback_bps,
           effective_from, effective_to, status, approved_by, approved_at
         ) VALUES (
           $1, $2, $3, $4, 'v1.0-pilot',
           $5, $6, $7, $8,
           '2026-01-01', NULL, 'active', $9, now()
         )`,
        [
          agreementId,
          tenantId,
          partnerId,
          b.carrierId,
          b.brokerSplitBps,
          b.branchOverrideBps,
          b.mgaSpreadBps,
          b.holdbackBps,
          adminUserId,
        ],
      );

      commissionAgreements[b.key] = {
        id: agreementId,
        carrierId: b.carrierId,
        producerNodeId: partnerId,
        version: 'v1.0-pilot',
        holdbackBps: b.holdbackBps,
      };
    }

    // 7. Starter CRM Pipeline & Stages
    const pipelineId = randomUUID();
    await client.query(
      `INSERT INTO pipelines (id, tenant_id, owner_node_id, name, is_shared_down, created_by)
       VALUES ($1, $2, $3, 'Commercial & Personal Insurance', true, $4)`,
      [pipelineId, tenantId, rootNodeId, adminUserId],
    );

    const stages: [string, boolean, boolean][] = [
      ['New Lead', false, false],
      ['Contacted', false, false],
      ['Quote Sent', false, false],
      ['Application', false, false],
      ['Policy Issued', true, false],
      ['Lost', false, true],
    ];
    let pos = 1;
    for (const [sName, isWon, isLost] of stages) {
      await client.query(
        `INSERT INTO stages (tenant_id, pipeline_id, name, position, is_won, is_lost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, pipelineId, sName, pos++, isWon, isLost],
      );
    }

    // 8. Audit Log
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail)
       VALUES ($1, $2, 'pilot_brokerage_bootstrapped', 'tenant', $1, $3)`,
      [
        tenantId,
        adminUserId,
        JSON.stringify({
          brokerage: config.tenantName,
          branchesCount: config.branches.length,
          country: config.countryCode,
        }),
      ],
    );

    await client.query('COMMIT');

    return {
      tenantId,
      rootNodeId,
      adminUserId,
      branches,
      partners,
      users,
      commissionAgreements,
      pipelineId,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    if (ownClient) {
      await client.end();
    }
  }
}

export interface PilotStatementRow {
  policyNumber: string;
  clientName: string;
  transactionType: 'first_year' | 'renewal' | 'chargeback' | 'bonus' | 'override' | 'fee';
  grossAmountDollars: string;
  netAmountDollars: string;
  producerCode?: string;
}

export function generatePilotCarrierCsv(carrierId: string, rows: PilotStatementRow[]): string {
  const headers = ['policy_number', 'client_name', 'transaction_type', 'gross_amount', 'net_amount', 'producer_code'];
  const csvLines = [headers.join(',')];

  for (const r of rows) {
    const escapedClient = r.clientName.includes(',') || r.clientName.includes('"')
      ? `"${r.clientName.replace(/"/g, '""')}"`
      : r.clientName;
    csvLines.push([
      r.policyNumber,
      escapedClient,
      r.transactionType,
      r.grossAmountDollars,
      r.netAmountDollars,
      r.producerCode ?? '',
    ].join(','));
  }

  return csvLines.join('\n');
}
