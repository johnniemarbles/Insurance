// Licence check walkthrough data: a Toronto branch with its compliance officer, a broker "Harpreet Kaur Sandhu" with an
// Ontario licence on file. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3105';
const c = async (m, u, b, who = 'sanjeev@uat.test') => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
const X = (await c('POST', '/v1/org/locations', { name: 'Toronto' })).id;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const comp = (await db.query(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,'priya@uat.test','Priya (Compliance)',$2,'active') RETURNING id`, [t, X])).rows[0].id;
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'compliance')`, [t, comp, X]);
await c('POST', '/v1/consent/first-login', undefined, 'priya@uat.test');
const broker = (await c('POST', '/v1/onboarding/brokers', { name: 'Harpreet Kaur Sandhu', parentId: X, type: 'individual', adminEmail: 'harpreet@uat.test' }, 'priya@uat.test')).nodeId;
await db.query(`DELETE FROM compliance_items WHERE node_id = $1 AND kind = 'licence'`, [broker]);
await db.query(`INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction, expires_on) VALUES ($1,$2,'licence','Life and accident and sickness','12345-M','ON','2027-03-31')`, [t, broker]);
await db.end();
console.log('licence seeded');
