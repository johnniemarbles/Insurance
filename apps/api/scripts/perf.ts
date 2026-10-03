import pg from 'pg';
import { bootstrapTenant, createPool, seedStarterPipelines } from '@pii/db';
import { createTestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
const db = await createTestDb('ca-qc');
const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2);
const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
const app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
const t = await bootstrapTenant(db.ownerUrl, { name: 'Perf', countryCode: 'CA', adminEmail: 'admin@perf.test' });
const H: Record<string,string> = { 'x-dev-user-email': 'admin@perf.test' };
const call = async (m: any, url: string, body?: any) => { const t0 = performance.now(); const r = await app.inject({ method: m, url, headers: H, ...(body ? { payload: body } : {}) }); return { ms: Math.round(performance.now() - t0), status: r.statusCode, json: r.body ? JSON.parse(r.body) : null }; };
await call('POST', '/v1/consent/first-login');
await seedStarterPipelines(db.ownerUrl);
const p = (await call('GET', '/v1/pipelines')).json.pipelines[0];
const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
await o.query(`INSERT INTO boxes (tenant_id, pipeline_id, stage_id, owner_node_id, owner_user_id, name, value_amount, custom, created_by, stage_entered_at)
  SELECT $1, $2, (SELECT id FROM stages WHERE pipeline_id=$2 ORDER BY position OFFSET (g % 6) LIMIT 1), $3, $4, 'Record ' || g, (g % 50) * 100, jsonb_build_object('policy_type','Auto'), $4, now() - ((g % 60) || ' days')::interval
  FROM generate_series(1, 20000) g`, [t.tenantId, p.id, t.rootNodeId, t.adminUserId]);
const L = (await call('POST', '/v1/org/locations', { name: 'Loc' })).json.id;
const PA = (await call('POST', '/v1/org/partners', { name: 'PA', parentId: L })).json.id;
const PB = (await call('POST', '/v1/org/partners', { name: 'PB', parentId: L })).json.id;
const uid = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,'pa@perf.test',$2,'active') RETURNING id`, [t.tenantId, PA])).rows[0].id;
await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,'manager')`, [t.tenantId, uid, PA]);
await o.query(`UPDATE boxes SET owner_node_id = $1, context_node_id = $2 WHERE name LIKE 'Record 1%'`, [PB, L]);
await o.query(`UPDATE boxes SET owner_node_id = $1, context_node_id = $2 WHERE name NOT LIKE 'Record 1%' AND id IN (SELECT id FROM boxes WHERE owner_node_id = $3 ORDER BY id LIMIT 5000)`, [PA, L, t.rootNodeId]);
await o.query('ANALYZE boxes'); await o.end();
H['x-dev-user-email'] = 'pa@perf.test';
await call('POST', '/v1/consent/first-login');
for (const u of [`/v1/boxes?pipelineId=${p.id}&limit=100`, `/v1/boxes?pipelineId=${p.id}&limit=100&sort=daysInStage&dir=desc`, `/v1/boxes?pipelineId=${p.id}&q=Record%2012&limit=100`, `/v1/boxes?pipelineId=${p.id}&limit=200&sort=position&dir=asc&scope=mine`, `/v1/boxes?pipelineId=${p.id}&minDaysInStage=14&limit=100`, `/v1/pipelines/${p.id}/summary?scope=all`]) {
  const r = await call('GET', u); console.log(r.status, r.ms + 'ms', u.slice(0, 90), r.json.total ?? '');
}
await app.close(); await Promise.all([appPool.end(), authPool.end()]); await db.drop();
