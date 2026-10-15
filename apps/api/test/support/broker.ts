// Test fixture: add a top-level broker the way the product does (plan v7, section 5). The Compliance Manager of the branch
// adds it in one call, which creates the broker and its file together. Tests that are not about adding brokers use this.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Any test's own call helper fits: it may name fewer methods, and may or may not return the raw body.
export type FixtureCall = (
  email: string, method: any, url: string, body?: unknown,
) => Promise<{ status: number; json: any; raw?: string; text?: string }>;

/** The Compliance Manager for one branch, created on first use (one per branch, so tests do not share an officer). */
export async function officerFor(call: FixtureCall, ownerUrl: string, branchId: string): Promise<string> {
  const email = `officer-${branchId.slice(0, 8)}@fixtures.test`;
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const have = (await c.query('SELECT id FROM app_users WHERE email = $1', [email])).rows[0];
    if (!have) {
      const { rows } = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM org_nodes WHERE id = $1', [branchId]);
      const tenantId = rows[0]!.tenant_id;
      const u = (await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, 'fixture officer', $3, 'active') RETURNING id`,
        [tenantId, email, branchId])).rows[0];
      await c.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'compliance')`, [tenantId, u.id, branchId]);
      await call(email, 'POST', '/v1/consent/first-login');
    }
  } finally {
    await c.end();
  }
  return email;
}

/** Adds a broker under a branch as its Compliance Manager, and returns the broker's id. */
export async function addBrokerFixture(call: FixtureCall, ownerUrl: string, branchId: string, name: string): Promise<string> {
  const officer = await officerFor(call, ownerUrl, branchId);
  const r = await call(officer, 'POST', '/v1/onboarding/brokers', {
    name, parentId: branchId, type: 'individual', adminEmail: `admin-${randomUUID().slice(0, 8)}@fixtures.test`,
  });
  if (r.status !== 201) throw new Error(`fixture broker "${name}" not added: ${r.status} ${r.raw ?? ''}`);
  return r.json.nodeId as string;
}

/** The onboarding case of a broker that was added through the helper (the file starts with the add). */
export async function caseOfBroker(ownerUrl: string, nodeId: string): Promise<string> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    return (await c.query('SELECT id FROM onboarding_cases WHERE node_id = $1', [nodeId])).rows[0].id as string;
  } finally {
    await c.end();
  }
}
