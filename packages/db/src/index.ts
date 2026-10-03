import pg from 'pg';
import { toSessionSettings, type RequestContext } from '@pii/domain';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client can be dropped by a database restart or failover; without a listener that crashes the process.
  pool.on('error', (err) => console.error('idle database client error:', err.message));
  return pool;
}

/**
 * Runs `fn` in a transaction with the caller's identity applied as transaction-local settings.
 * Every query the API makes on behalf of a user goes through here, so row-level security always has a tenant and user.
 */
export async function withRequestTx<T>(pool: Db, ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(toSessionSettings(ctx))) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Refuses to run if this database belongs to a different region than the app is configured for. */
export async function assertDeployment(pool: Db, expectedRegion: string): Promise<{ region: string; environment: string; verified: boolean }> {
  const { rows } = await pool.query<{ region: string; environment: string; physical_region_verified: boolean }>(
    'SELECT region, environment, physical_region_verified FROM deployment_info',
  );
  const row = rows[0];
  if (!row) throw new Error('deployment_info is empty: run bootstrap-deployment first');
  if (row.region !== expectedRegion) {
    throw new Error(`Residency violation: database region is ${row.region} but app is configured for ${expectedRegion}`);
  }
  return { region: row.region, environment: row.environment, verified: row.physical_region_verified };
}

export interface LoginCandidate {
  userId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  displayName: string | null;
  locale: 'en' | 'fr-CA';
  status: 'invited' | 'active' | 'disabled';
  homeNodeId: string;
  tenantRootNodeId: string;
  roles: { nodeId: string; role: string }[];
}

/** Login lookup (before any tenant context exists). Uses the narrow app_auth role. */
export async function findLoginCandidates(authPool: Db, email: string): Promise<LoginCandidate[]> {
  const { rows } = await authPool.query(
    `SELECT u.id AS user_id, u.tenant_id, t.name AS tenant_name, u.email::text AS email, u.display_name, u.locale::text AS locale,
            u.status::text AS status, u.home_node_id,
            (SELECT n.id FROM org_nodes n WHERE n.tenant_id = u.tenant_id AND n.type = 'tenant') AS root_id,
            coalesce((SELECT json_agg(json_build_object('nodeId', r.node_id, 'role', r.role::text))
                      FROM user_node_roles r WHERE r.user_id = u.id), '[]'::json) AS roles
       FROM app_users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = $1 AND u.status <> 'disabled'
      ORDER BY t.name`,
    [email],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    email: r.email,
    displayName: r.display_name,
    locale: r.locale,
    status: r.status,
    homeNodeId: r.home_node_id,
    tenantRootNodeId: r.root_id,
    roles: r.roles,
  }));
}

export async function markLogin(authPool: Db, userId: string): Promise<void> {
  await authPool.query(`UPDATE app_users SET last_login_at = now(), status = CASE WHEN status = 'invited' THEN 'active'::user_status ELSE status END WHERE id = $1`, [userId]);
}

export * from './migrate.ts';
export * from './bootstrap.ts';
export * from './auth.ts';
