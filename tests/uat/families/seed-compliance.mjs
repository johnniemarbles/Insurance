// Gate C demo data: provinces of residence, a consent, an ID check, a guardian authority waiting for verification, a
// compliance user to verify it, and someone reaching the age of majority soon. Run after seed-insurance.mjs, with DATABASE_URL (owner).
import pg from 'pg';

const B = 'http://127.0.0.1:3100';
const call = async (who, m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'x-dev-user-email': who, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const api = (m, u, b) => call('sanjeev@uat.test', m, u, b);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const t = await one(`SELECT id FROM tenants LIMIT 1`);
const root = await one(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [t.id]);
const u = await one(`INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, 'compliance@uat.test', 'Harpreet (Compliance)', $2, 'active') RETURNING id`, [t.id, root.id]);
await db.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, 'compliance')`, [t.id, u.id, root.id]);
const who = async (name) => (await one(`SELECT id FROM contacts WHERE full_name = $1`, [name])).id;
const [raj, simran, aman, navjot] = await Promise.all(['Raj Singh', 'Simran Singh', 'Aman Singh', 'Navjot Kaur'].map(who));
await db.end();
await call('compliance@uat.test', 'POST', '/v1/consent/first-login');

const soon = new Date(); soon.setUTCDate(soon.getUTCDate() + 20); soon.setUTCFullYear(soon.getUTCFullYear() - 19);
await api('PATCH', `/v1/people/${navjot}/profile`, { dateOfBirth: soon.toISOString().slice(0, 10) });
for (const c of [raj, simran, aman, navjot]) await api('PATCH', `/v1/people/${c}/residence`, { jurisdiction: 'CA-BC' });
const today = new Date().toISOString().slice(0, 10);
await api('POST', `/v1/people/${raj}/consents`, { purpose: 'collection_use', scope: 'all_dealings', channel: 'in_person', grantedOn: today, givenBy: 'self' });
await api('POST', `/v1/people/${raj}/consents`, { purpose: 'carrier_sharing', scope: 'all_dealings', channel: 'in_person', grantedOn: today, givenBy: 'self' });
await api('POST', `/v1/people/${simran}/consents`, { purpose: 'collection_use', scope: 'all_dealings', channel: 'esign', grantedOn: today, givenBy: 'self' });
await api('POST', `/v1/people/${raj}/id-references`, { method: 'in_person', result: 'verified', checkedOn: today, documentsSeen: ['passport'] });
await api('POST', `/v1/people/${aman}/authorities`, { holderContactId: raj, kind: 'guardian_of_minor', purposes: ['collection_use', 'carrier_sharing'], startsOn: '2014-03-15',
  evidenceDescription: 'Birth certificate naming Raj Singh as parent, seen in person at the Surrey office' });
await api('POST', '/v1/compliance-reviews/run');
console.log('compliance seeded');
