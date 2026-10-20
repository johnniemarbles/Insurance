// Suitability walkthrough data: a deal for Raj Singh with a signed needs analysis and a linked signed recommendation
// (cover below the need, premium over budget), a "Submitted" stage that requires a suitability review, the co-pilot on
// with Gemini, and a compliance officer. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3102';
const c = async (m, u, b, who = 'sanjeev@uat.test') => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
await c('PUT', '/v1/ai/settings', { enabled: true, includeEmail: false, partnersEnabled: true });
await c('PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: false });
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com' })).id;
const pipe = (await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] })).id;
const st = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.id === pipe).stages;
await c('PATCH', `/v1/pipelines/${pipe}/stages/${st[1].id}`, { requiredDocs: ['suitability_review'] });
const box = (await c('POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review', contactIds: [raj] })).id;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const u = (await db.query(`SELECT id FROM app_users WHERE email = 'sanjeev@uat.test'`)).rows[0].id;
const root = (await db.query(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [t])).rows[0].id;
const na = { productLine: 'life_health', annualIncome: 90000, incomeYears: 5, mortgage: 300000, existingGroup: 50000, objectives: ['income_replacement', 'education'], monthlyBudget: 150, replacing: false };
const rec = { product: 'Term 20', insurer: 'iA Financial Group', coverageAmount: 500000, monthlyPremium: 180, reasons: 'Affordable term cover.', alternatives: 'Term 10', clientDecision: 'accepted' };
const n = (await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, valid_until)
  VALUES ($1,$2,'needs_analysis','Needs analysis, October 2026','Raj needs cover for the mortgage, five years of income, and his two children''s education.','builtin','signed','Raj Singh',$3,now(),'otp','h',$4,current_date + 300) RETURNING id`, [t, box, u, na])).rows[0].id;
await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, linked_advice_id)
  VALUES ($1,$2,'recommendation','Recommendation: Term 20','Term 20, 500,000, with iA Financial Group.','builtin','signed','Raj Singh',$3,now(),'otp','h',$4,$5)`, [t, box, u, rec, n]);
const comp = (await db.query(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1,'priya@uat.test','Priya (Compliance)',$2,'active') RETURNING id`, [t, root])).rows[0].id;
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,'compliance')`, [t, comp, root]);
await db.end();
await c('POST', '/v1/consent/first-login', undefined, 'priya@uat.test');
console.log('suitability seeded');
