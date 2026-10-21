// Evidence pack walkthrough data: a Surrey branch with its compliance officer (Priya) and a broker, Harpreet Kaur
// Sandhu, with two deals (one with a needs PDF and a complaint) and a Manulife policy. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3108';
const c = async (m, u, b, who = 'sanjeev@uat.test') => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
const X = (await c('POST', '/v1/org/locations', { name: 'Surrey' })).id;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const comp = (await db.query(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,'priya@uat.test','Priya (Compliance)',$2,'active') RETURNING id`, [t, X])).rows[0].id;
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'compliance')`, [t, comp, X]);
await c('POST', '/v1/consent/first-login', undefined, 'priya@uat.test');
const broker = (await c('POST', '/v1/onboarding/brokers', { name: 'Harpreet Kaur Sandhu', parentId: X, type: 'individual', adminEmail: 'harpreet@uat.test' }, 'priya@uat.test')).nodeId;
await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] });
const pipe = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.name === 'Life').id;
const boxes = [];
for (const name of ['Singh life review', 'Gill family term']) {
  const b = (await c('POST', '/v1/boxes', { pipelineId: pipe, name })).id;
  await db.query(`UPDATE boxes SET owner_node_id = $1, context_node_id = $2 WHERE id = $3`, [broker, X, b]);
  boxes.push(b);
}
await c('POST', `/v1/boxes/${boxes[0]}/documents`, { name: 'needs-analysis.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 needs analysis').toString('base64') });
await c('POST', `/v1/boxes/${boxes[0]}/complaints`, { receivedOn: new Date().toISOString().slice(0, 10), channel: 'email', category: 'service', summary: 'Client waited two weeks for a reply.' }, 'priya@uat.test');
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com' })).id;
await db.query(`UPDATE contacts SET owner_node_id = $1, context_node_id = $2 WHERE id = $3`, [broker, X, raj]);
await db.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [boxes[1], raj, t]);
const pid = (await db.query(`INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents, modal_premium_cents, premium_frequency, status, effective_date)
  VALUES ($1,$2,$3,'manulife','UAT-1','Term 20','BC',120000,10000,'monthly','active',current_date - 30) RETURNING id`, [t, X, broker])).rows[0].id;
await db.query(`INSERT INTO policy_parties (tenant_id, policy_id, contact_id, role) VALUES ($1,$2,$3,'owner')`, [t, pid, raj]);
await db.end();
console.log('evidence packs seeded');
