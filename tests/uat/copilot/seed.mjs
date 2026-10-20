const B = 'http://127.0.0.1:3100';
const c = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': 'sanjeev@uat.test', ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`); return t ? JSON.parse(t) : null; };
await c('POST', '/v1/consent/first-login');
await c('POST', '/v1/contacts', { fullName: 'Raj Singh', email: 'raj.singh@example.com', phone: '604-555-0101' });
await c('PUT', '/v1/ai/settings', { enabled: true, includeEmail: false, partnersEnabled: true });
await c('PUT', '/v1/copilot/settings', { provider: 'gemini', allowPartnerKeys: true });
console.log('copilot seeded');
