// Gate B demo data: policies (written straight to the database, as a carrier import would), people on them through the
// API, a deal with a signed needs analysis, and one coverage assessment. Run after seed.mjs, with DATABASE_URL (owner).
import pg from 'pg';

const B = 'http://127.0.0.1:3100';
const H = { 'x-dev-user-email': 'sanjeev@uat.test', 'content-type': 'application/json' };
const api = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: b ? H : { 'x-dev-user-email': H['x-dev-user-email'] }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`${m} ${u} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const t = await one(`SELECT id FROM tenants LIMIT 1`);
const root = await one(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [t.id]);
const user = await one(`SELECT id FROM app_users WHERE email = 'sanjeev@uat.test'`);
const who = async (name) => (await one(`SELECT id FROM contacts WHERE full_name = $1`, [name])).id;
const [raj, simran, aman, gill] = await Promise.all(['Raj Singh', 'Simran Singh', 'Aman Singh', 'Gurpreet Gill'].map(who));
const policy = async (carrier, num, plan, jur, cents, status, expiry) => (await one(
  `INSERT INTO policy_records (tenant_id, branch_node_id, producer_node_id, carrier_id, policy_number, plan_name, jurisdiction, annual_premium_cents,
     modal_premium_cents, premium_frequency, status, effective_date, expiry_date)
   VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$7,'annual',$8,'2025-01-15',$9) RETURNING id`, [t.id, root.id, carrier, num, plan, jur, cents, status, expiry])).id;
const life = await policy('ia-financial-group', 'L-100', 'Term life 20', 'CA-BC', 120000, 'active', '2027-03-01');
const health = await policy('manulife', 'H-200', 'Family health and dental', 'CA-BC', 240000, 'active', '2026-12-15');
const ci = await policy('sun-life', 'S-300', 'Critical illness', 'CA-BC', 50000, 'lapsed', null);
const gillLife = await policy('canada-life', 'U-400', 'Whole life', 'CA-BC', 80000, 'active', '2028-06-30');
await policy('manulife', 'E-700', 'Travel annual', 'CA-BC', 30000, 'active', '2026-11-30');
// A deal for Raj with a signed needs analysis (evidence for a potential gap).
const pl = await one(`INSERT INTO pipelines (tenant_id, owner_node_id, name) VALUES ($1,$2,'Life reviews') RETURNING id`, [t.id, root.id]);
const st = await one(`INSERT INTO stages (tenant_id, pipeline_id, name, position) VALUES ($1,$2,'Review',1) RETURNING id`, [t.id, pl.id]);
const box = await one(`INSERT INTO boxes (tenant_id, pipeline_id, stage_id, owner_node_id, name) VALUES ($1,$2,$3,$4,'Singh annual review') RETURNING id`, [t.id, pl.id, st.id, root.id]);
await db.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)', [box.id, raj, t.id]);
await db.query(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash)
  VALUES ($1,$2,'needs_analysis','Needs analysis, October 2026','Body','builtin','signed','Raj Singh',$3,now(),'otp','h')`, [t.id, box.id, user.id]);
await db.end();

const add = (pol, body) => api('POST', `/v1/policies/${pol}/parties`, body);
await add(life, { contactId: raj, role: 'owner' });
await add(life, { contactId: raj, role: 'insured' });
await add(life, { contactId: simran, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 60, relationshipToInsured: 'Spouse' });
await add(life, { contactId: aman, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 40, relationshipToInsured: 'Son' });
for (const [c, role] of [[raj, 'owner'], [raj, 'payor'], [raj, 'insured'], [simran, 'joint_insured']]) await add(health, { contactId: c, role });
await add(ci, { contactId: simran, role: 'owner' });
await add(ci, { contactId: simran, role: 'insured' });
await add(gillLife, { contactId: gill, role: 'owner' });
await add(gillLife, { contactId: gill, role: 'insured' });
await add(gillLife, { contactId: aman, role: 'beneficiary', beneficiaryClass: 'primary', allocationMethod: 'percentage', sharePercent: 100 });
await api('POST', `/v1/people/${raj}/coverage`, { lineKey: 'life', state: 'covered', policyId: life });
console.log('insurance seeded');
