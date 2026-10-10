import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb, type TestDb } from '../src/testing.ts';
import { seedDemoTenant } from '../src/demo.ts';

let db: TestDb;
before(async () => { db = await createTestDb('us'); });
after(async () => { await db.drop(); });

async function q<T = any>(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
}

test('US demo company: US pipelines and people, California licensees with CE hours, and it resets cleanly', async () => {
  const a = await seedDemoTenant(db.ownerUrl, { adminEmail: 'demo.us@example.com' });
  assert.ok(a.created);
  const pipes = (await q<{ name: string }>('SELECT name FROM pipelines WHERE tenant_id = $1', [a.tenantId])).map((p) => p.name).sort();
  assert.deepEqual(pipes, ['Life & Health', 'Medicare & Senior Health', 'Personal Lines', 'Walk-ins (New York branch)']);
  assert.equal((await q('SELECT 1 FROM app_users WHERE tenant_id = $1 AND locale::text <> $2', [a.tenantId, 'en'])).length, 0, 'no French users on the US demo');
  assert.equal((await q('SELECT 1 FROM boxes WHERE tenant_id = $1 AND currency <> $2', [a.tenantId, 'USD'])).length, 0);
  const lic = await q<{ n: string; term_anchor: string }>(`SELECT u.display_name n, l.term_anchor::text FROM learner_licences l JOIN app_users u ON u.id = l.user_id WHERE l.tenant_id = $1 AND l.pack_code = 'ca_doi' ORDER BY 1`, [a.tenantId]);
  assert.deepEqual(lic.map((l) => l.n), ['Sofia Rossi', 'Wei Chen']);
  const entries = Number((await q('SELECT count(*) n FROM ce_entries WHERE tenant_id = $1', [a.tenantId]))[0].n);
  assert.equal(entries, 5);
  const reset = await seedDemoTenant(db.ownerUrl, { reset: true });
  assert.equal(reset.tenantId, a.tenantId);
  assert.equal(Number((await q('SELECT count(*) n FROM ce_entries WHERE tenant_id = $1', [a.tenantId]))[0].n), 5, 'reset rebuilds the CE hours without hitting the retention lock');
});
