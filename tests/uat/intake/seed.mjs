// Intake walkthrough data: Raj Singh (with an email) on a deal.
const B = 'http://127.0.0.1:3103';
const c = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': 'sanjeev@uat.test', ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
const raj = (await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com', phone: '604-555-0101' })).id;
const pipe = (await c('POST', '/v1/pipelines', { name: 'Life', sharedDown: true, stages: [{ name: 'New' }] })).id;
await c('POST', '/v1/boxes', { pipelineId: pipe, name: 'Singh life review', contactIds: [raj] });
console.log('intake seeded');
