import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb, type TestDb } from '../src/testing.ts';
import { seedDemoTenant } from '../src/demo.ts';

let db: TestDb;
before(async () => { db = await createTestDb('ca-qc'); });
after(async () => { await db.drop(); });

async function count(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  const n = (await c.query<{ n: number }>(sql, params)).rows[0]!.n;
  await c.end();
  return Number(n);
}

test('demo tenant is seeded once, with data in every scenario, and can be reset', async () => {
  const a = await seedDemoTenant(db.ownerUrl, { adminEmail: 'Demo.Owner@Example.com' });
  assert.equal(a.created, true);
  assert.equal(await count(`SELECT count(*) n FROM tenants WHERE is_demo`), 1);
  assert.equal(await count(`SELECT count(*) n FROM app_users WHERE tenant_id = $1 AND email = 'demo.owner@example.com'`, [a.tenantId]), 1);
  assert.equal(await count(`SELECT count(*) n FROM app_users WHERE tenant_id = $1 AND status = 'invited'`, [a.tenantId]), 1);
  assert.equal(await count(`SELECT count(*) n FROM app_users WHERE tenant_id = $1 AND status = 'disabled'`, [a.tenantId]), 1);
  assert.ok(await count(`SELECT count(*) n FROM app_users WHERE tenant_id = $1 AND locale = 'fr-CA'`, [a.tenantId]) >= 2);
  assert.equal(await count(`SELECT count(*) n FROM pipelines WHERE tenant_id = $1`, [a.tenantId]), 4);
  assert.equal(await count(`SELECT count(*) n FROM alias_rules WHERE tenant_id = $1`, [a.tenantId]), 3);
  assert.ok(await count(`SELECT count(*) n FROM contacts WHERE tenant_id = $1`, [a.tenantId]) >= 150);
  assert.ok(await count(`SELECT count(*) n FROM boxes WHERE tenant_id = $1`, [a.tenantId]) >= 200);
  // Every stage of the head-office pipelines holds at least one deal; won and lost both appear.
  assert.equal(await count(`SELECT count(*) n FROM stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.tenant_id = $1 AND p.is_shared_down AND NOT EXISTS (SELECT 1 FROM boxes b WHERE b.stage_id = s.id)`, [a.tenantId]), 0);
  assert.ok(await count(`SELECT count(*) n FROM tasks WHERE tenant_id = $1 AND done_at IS NULL AND due_at < now()`, [a.tenantId]) > 0, 'overdue tasks');
  assert.ok(await count(`SELECT count(*) n FROM tasks WHERE tenant_id = $1 AND done_at IS NOT NULL`, [a.tenantId]) > 0, 'done tasks');
  assert.ok(await count(`SELECT count(*) n FROM notes WHERE tenant_id = $1 AND kind = 'call'`, [a.tenantId]) > 0, 'call logs');
  assert.ok(await count(`SELECT count(*) n FROM box_threads WHERE tenant_id = $1`, [a.tenantId]) > 0, 'linked threads');
  assert.ok(await count(`SELECT count(*) n FROM contacts WHERE tenant_id = $1 AND email_opt_out_at IS NOT NULL`, [a.tenantId]) > 0, 'opted-out contacts');
  assert.ok(await count(`SELECT count(*) n FROM boxes WHERE tenant_id = $1 AND now() - stage_entered_at > interval '14 days'`, [a.tenantId]) > 0, 'stale deals');
  // The people other than the admin can never sign in: their addresses cannot receive mail.
  assert.equal(await count(`SELECT count(*) n FROM app_users WHERE tenant_id = $1 AND email NOT LIKE '%@demo.invalid'`, [a.tenantId]), 1);

  const again = await seedDemoTenant(db.ownerUrl);
  assert.equal(again.created, false);
  assert.equal(again.tenantId, a.tenantId);

  const boxesBefore = await count(`SELECT count(*) n FROM boxes WHERE tenant_id = $1`, [a.tenantId]);
  const reset = await seedDemoTenant(db.ownerUrl, { reset: true });
  assert.equal(reset.tenantId, a.tenantId);
  assert.equal(await count(`SELECT count(*) n FROM boxes WHERE tenant_id = $1`, [a.tenantId]), boxesBefore, 'reset rebuilds the same amount');
  assert.equal(await count(`SELECT count(*) n FROM tenants WHERE is_demo`), 1);
});
