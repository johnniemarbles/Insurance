// Gate D demo data: a client in no family who shares a surname with the Singhs, for the Gmail strip suggestion.
const r = await fetch('http://127.0.0.1:3100/v1/contacts', { method: 'POST', headers: { 'x-dev-user-email': 'sanjeev@uat.test', 'content-type': 'application/json' },
  body: JSON.stringify({ fullName: 'Gurdeep Singh', email: 'gurdeep.singh@example.com' }) });
if (r.status !== 201) throw new Error(`contact ${r.status} ${await r.text()}`);
console.log('tools seeded');
