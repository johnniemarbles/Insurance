// Co-pilot step 2 demo data: a rulebook document, a deal for Raj Singh with signed needs analysis and recommendation,
// and a gated stage so the audit-ready score has something to count. Run after seed.mjs, with DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3100';
const c = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': 'sanjeev@uat.test', ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
const MANUAL = `# Replacement of coverage\n\nBefore replacing an existing life policy, the advisor must give the client a signed replacement disclosure and keep it on file for seven years.\n\nThe disclosure explains new contestability and suicide exclusion periods.\n\n# Gifts and entertainment\n\nGifts from carriers over 100 dollars need written approval from compliance.`;
await c('POST', '/v1/copilot/rulebook', { title: 'PII Compliance Manual 2026', fileName: 'manual.md', mime: 'text/markdown', dataBase64: Buffer.from(MANUAL).toString('base64') });
const pipe = (await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).id;
const st = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.id === pipe).stages;
await c('PATCH', `/v1/pipelines/${pipe}/stages/${st[1].id}`, { requiredDocs: ['needs_analysis', 'id_record', 'privacy_consent'] });
const raj = (await c('GET', '/v1/contacts?q=Raj')).contacts[0].id;
const box = (await c('POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review', contactIds: [raj] })).id;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const t = (await db.query('SELECT id FROM tenants LIMIT 1')).rows[0].id;
const u = (await db.query(`SELECT id FROM app_users WHERE email = 'sanjeev@uat.test'`)).rows[0].id;
for (const [kind, title, body] of [['needs_analysis', 'Needs analysis, October 2026', 'Raj needs 500,000 of term coverage for 20 years to cover the mortgage and income for two children.'], ['recommendation', 'Recommendation', 'Term 20, 500,000, with iA Financial Group, monthly premium as quoted on 14 October.']]) {
  await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash) VALUES ($1,$2,$3,$4,$5,'builtin','signed','Raj Singh',$6,now(),'otp','h')`, [t, box, kind, title, body, u]);
}
await db.end();
console.log('copilot step 2 seeded');
