// Conduct flag walkthrough data: a Surrey branch with its compliance officer (Priya) and a broker, Harpreet Kaur
// Sandhu, with four deals (three replacing cover, one premium high for income) and five policies (two lapsed early,
// three owned by Raj Singh). Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3107';
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
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com' })).id;
const san = (await db.query(`SELECT id FROM app_users WHERE email = 'sanjeev@uat.test'`)).rows[0].id;
for (let i = 0; i < 4; i++) {
  const b = (await c('POST', '/v1/boxes', { pipelineId: pipe, name: ['Singh life review', 'Gill family term', 'Dhillon critical illness', 'Brar mortgage cover'][i] })).id;
  await db.query(`UPDATE boxes SET owner_node_id = $1, context_node_id = $2 WHERE id = $3`, [broker, X, b]);
  const na = (await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, valid_until)
    VALUES ($1,$2,'needs_analysis','Needs analysis','b','builtin','signed','Client',$3,now(),'otp','h',$4,current_date + 300) RETURNING id`, [t, b, san, { productLine: 'life_health', replacing: i < 3, annualIncome: 40000 }])).rows[0].id;
  await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, linked_advice_id)
    VALUES ($1,$2,'recommendation','Recommendation','b','builtin','signed','Client',$3,now(),'otp','h',$4,$5)`, [t, b, san, { monthlyPremium: i === 0 ? 900 : 100, clientDecision: 'accepted' }, na]);
}
await db.query(`UPDATE contacts SET owner_node_id = $1, context_node_id = $2 WHERE id = $3`, [broker, X, raj]);
const pols = [];
for (let i = 0; i < 5; i++) pols.push((await db.query(`INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents, modal_premium_cents, premium_frequency, status, effective_date, updated_at)
  VALUES ($1,$2,$3,'manulife',$4,'Term 20','BC',120000,10000,'monthly',$5,'2026-01-15',$6) RETURNING id`, [t, X, broker, `UAT-${i}`, i < 2 ? 'lapsed' : 'active', i < 2 ? '2026-06-01' : '2026-01-15'])).rows[0].id);
for (const id of pols.slice(2)) await db.query(`INSERT INTO policy_parties (tenant_id, policy_id, contact_id, role) VALUES ($1,$2,$3,'owner')`, [t, id, raj]);
await db.end();
console.log('conduct seeded');
