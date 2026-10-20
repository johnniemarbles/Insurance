// Electronic ID walkthrough data: Raj Singh (born 1980-04-12) on a deal, both ID routes switched on. Needs DATABASE_URL (owner).
import pg from 'pg';
const B = 'http://127.0.0.1:3101';
const c = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': 'sanjeev@uat.test', ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com', phone: '604-555-0101' })).id;
const pipe = (await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }, { name: 'Bound' }] })).id;
const st = (await c('GET', '/v1/pipelines')).pipelines.find((p) => p.id === pipe).stages;
await c('PATCH', `/v1/pipelines/${pipe}/stages/${st[1].id}`, { requiredDocs: ['id_record'] });
await c('POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review', contactIds: [raj] });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
await db.query(`UPDATE contacts SET date_of_birth = '1980-04-12' WHERE id = $1`, [raj]);
await db.end();
console.log('eid seeded');
