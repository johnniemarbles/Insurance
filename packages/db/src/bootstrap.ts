import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MAX_PARTNER_LEVELS } from '@pii/domain';

export interface DeploymentInit {
  region: 'ca-qc' | 'us';
  environment: 'dev' | 'staging' | 'prod';
  physicalRegionVerified?: boolean;
}

/** One row per database, written once. The tenant region guard reads it. */
export async function bootstrapDeployment(databaseUrl: string, init: DeploymentInit): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query<{ region: string; environment: string }>('SELECT region, environment FROM deployment_info');
    const row = existing.rows[0];
    if (row) {
      if (row.region !== init.region) throw new Error(`Database is already set up for region ${row.region}`);
      return;
    }
    await client.query('INSERT INTO deployment_info (region, environment, physical_region_verified) VALUES ($1, $2, $3)', [
      init.region,
      init.environment,
      init.physicalRegionVerified ?? false,
    ]);
  } finally {
    await client.end();
  }
}

export interface TenantInit {
  name: string;
  countryCode: 'CA' | 'US';
  defaultLocale?: 'en' | 'fr-CA';
  adminEmail: string;
  adminName?: string;
}

export interface TenantCreated {
  tenantId: string;
  rootNodeId: string;
  adminUserId: string;
}

/**
 * Creates a tenant, its root node and its first admin in one transaction.
 * The first admin is created as 'invited' and becomes active on first sign-in.
 * Runs as the database owner, with the same session settings the policies expect.
 */
export async function bootstrapTenant(databaseUrl: string, init: TenantInit): Promise<TenantCreated> {
  const region = init.countryCode === 'CA' ? 'ca-qc' : 'us';
  const tenantId = randomUUID();
  const rootNodeId = randomUUID();
  const adminUserId = randomUUID();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of [
      ['app.tenant_id', tenantId],
      ['app.user_id', adminUserId],
      ['app.node_ids', `{${rootNodeId}}`],
      ['app.is_tenant_admin', 'true'],
      ['app.can_write', 'true'],
    ] as const) {
      await client.query('SELECT set_config($1, $2, true)', [k, v]);
    }
    await client.query('INSERT INTO tenants (id, name, country_code, region, default_locale) VALUES ($1, $2, $3, $4, $5)', [
      tenantId, init.name, init.countryCode, region, init.defaultLocale ?? 'en',
    ]);
    await client.query('INSERT INTO tenant_settings (tenant_id, max_partner_levels) VALUES ($1, $2)', [tenantId, MAX_PARTNER_LEVELS]);
    await client.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'tenant', $3)`, [rootNodeId, tenantId, init.name]);
    await client.query(
      `INSERT INTO app_users (id, tenant_id, email, display_name, locale, status, home_node_id) VALUES ($1, $2, $3, $4, $5, 'invited', $6)`,
      [adminUserId, tenantId, init.adminEmail.trim().toLowerCase(), init.adminName ?? null, init.defaultLocale ?? 'en', rootNodeId],
    );
    await client.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'admin')`, [tenantId, adminUserId, rootNodeId]);
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail) VALUES ($1, $2, 'tenant_created', 'tenant', $1, $3)`,
      [tenantId, adminUserId, JSON.stringify({ name: init.name, country: init.countryCode })],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
  return { tenantId, rootNodeId, adminUserId };
}

/** Creates or updates the two runtime login roles with the given passwords (run as the database owner/superuser). */
export async function ensureRoles(databaseUrl: string, passwords: { appRuntime: string; appAuth: string }): Promise<void> {
  if (passwords.appRuntime.length < 16 || passwords.appAuth.length < 16) throw new Error('Role passwords must be at least 16 characters');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [role, pw, attr] of [
      ['app_runtime', passwords.appRuntime, 'NOBYPASSRLS'],
      ['app_auth', passwords.appAuth, 'BYPASSRLS'],
    ] as const) {
      const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount === 1;
      const verb = exists ? 'ALTER' : 'CREATE';
      const { rows } = await client.query<{ sql: string }>(`SELECT format('%s ROLE %I LOGIN PASSWORD %L ${attr}', $1::text, $2::text, $3::text) AS sql`, [verb, role, pw]);
      await client.query(rows[0]!.sql);
    }
  } finally {
    await client.end();
  }
}
