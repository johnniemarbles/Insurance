// Supervision walkthrough data: a 1.5M life deal for Raj Singh, a "Submitted" stage, and a compliance officer. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3104';
const c = async (m, u, b, who = 'sanjeev@uat.test') => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com' })).id;
await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] });
const pipe = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.name === 'Life').id;
await c('POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review', contactIds: [raj], valueAmount: 1500000 });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const root = (await db.query(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [t])).rows[0].id;
const comp = (await db.query(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,'priya@uat.test','Priya (Compliance)',$2,'active') RETURNING id`, [t, root])).rows[0].id;
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'compliance')`, [t, comp, root]);
await db.end();
await c('POST', '/v1/consent/first-login', undefined, 'priya@uat.test');
console.log('supervision seeded');
