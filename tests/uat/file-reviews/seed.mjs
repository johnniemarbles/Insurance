// File review walkthrough data: three Life deals owned by Sanjeev (one with an open PEP hit and a large value) and a
// compliance officer, Priya. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3106';
const c = async (m, u, b, who = 'sanjeev@uat.test') => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] });
const pipe = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.name === 'Life').id;
const ids = [];
for (const [name, v] of [['Singh life review', 1500000], ['Gill family term', 400000], ['Dhillon critical illness', 75000]]) ids.push((await c('POST', '/v1/boxes', { pipelineId: pipe, name, valueAmount: v })).id);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const root = (await db.query(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [t])).rows[0].id;
const san = (await db.query(`SELECT id FROM app_users WHERE email = 'sanjeev@uat.test'`)).rows[0].id;
await db.query(`UPDATE boxes SET owner_user_id = $1 WHERE id = ANY($2)`, [san, ids]);
await db.query(`INSERT INTO screening_results (tenant_id, box_id, list, result, screened_on, reviewer_id, reviewer_name) VALUES ($1,$2,'pep','hit',current_date,$3,'Sanjeev')`, [t, ids[0], san]);
const comp = (await db.query(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,'priya@uat.test','Priya (Compliance)',$2,'active') RETURNING id`, [t, root])).rows[0].id;
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'compliance')`, [t, comp, root]);
await db.end();
await c('POST', '/v1/consent/first-login', undefined, 'priya@uat.test');
console.log('file reviews seeded');
