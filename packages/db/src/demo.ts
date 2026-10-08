import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MAX_PARTNER_LEVELS } from '@pii/domain';

/** Small deterministic generator so every reset produces the same demo. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);
const ahead = (days: number) => new Date(Date.now() + days * DAY);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const FIRST_EN = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Mia', 'Lucas', 'Isla', 'Aarav', 'Simran', 'Harjot', 'Priya', 'Rohan', 'Meera', 'Arjun', 'Zara', 'Omar', 'Layla', 'Hassan', 'Mei', 'Jun', 'Hiro', 'Sana', 'Daniel', 'Grace', 'Henry', 'Chloe', 'Samuel', 'Nora'];
const FIRST_FR = ['Camille', 'Léa', 'Gabriel', 'Émilie', 'Mathieu', 'Chloé', 'Antoine', 'Maude', 'Olivier', 'Sophie', 'Félix', 'Noémie'];
const LAST_EN = ['Singh', 'Kaur', 'Patel', 'Sharma', 'Gill', 'Dhillon', 'Chen', 'Wang', 'Nguyen', 'Smith', 'Brown', 'Wilson', 'Taylor', 'Khan', 'Ali', 'Ahmed', 'Rossi', 'Walker', 'Martin', 'Clarke', 'Ng', 'Mehta', 'Gupta', 'Brar', 'Sandhu'];
const LAST_FR = ['Tremblay', 'Gagnon', 'Roy', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', 'Pelletier'];
const COMPANIES = ['Maple Leaf Logistics', 'Northern Lights Bakery', 'Harbourfront Dental', 'Granite Peak Contractors', 'Blue Heron Tours', 'Prairie Wind Farms', 'Lakeshore Physio', 'Riverside Auto Glass', 'Summit Tech Consulting', 'Cedar & Pine Furniture', 'Saint-Laurent Fromagerie', 'Pacific Rim Imports'];
const DESTINATIONS = ['India', 'Mexico', 'United Kingdom', 'Philippines', 'Dominican Republic', 'Italy', 'Japan', 'Vietnam', 'Pakistan', 'Jamaica', 'Cuba', 'Portugal'];
const SOURCES = ['Website form', 'Referral', 'Walk-in', 'Phone', 'Social media', 'Partner agency'];
const NOTE_TEXT = [
  'Spoke with the client; wants coverage that includes pre-existing conditions. Sending three options.',
  'Client compared our quote with another broker. Asked for a lower deductible option.',
  'Documents received: passport copy and invitation letter. Waiting on proof of relationship.',
  'Left a message about the renewal. Will try again tomorrow morning.',
  'Client confirmed travel dates moved by two weeks. Updating the quote.',
  'Explained the stability period and what it means for the claim. Client understood.',
  'Spouse will be added as a second traveller. Need her date of birth.',
  'Client prefers WhatsApp for follow-ups. Noted on contact.',
];
const NOTE_FR = [
  'Le client souhaite une couverture sans franchise. Envoi de deux options.',
  'Documents reçus. En attente de la preuve de relation.',
  'Appel de suivi: le client confirme les dates de voyage.',
];
const TASK_TITLES = ['Send revised quote', 'Call client back', 'Collect passport copy', 'Confirm payment', 'Send policy documents', 'Follow up on application', 'Check licence before quote', 'Renewal reminder call'];
const THREAD_SUBJECTS = ['Quote for Super Visa insurance', 'Travel insurance for parents visiting in June', 'Re: Policy documents', 'Question about pre-existing conditions', 'Renewal quote please', 'Assurance voyage: demande de soumission', 'Payment confirmation', 'Documents you asked for'];

export interface DemoInit {
  /** Real address of the person who will sign in to the demo as its admin. Others are invited through the app. */
  adminEmail?: string;
  /** Wipe the demo tenant's CRM data and build it again. */
  reset?: boolean;
}
export interface DemoResult {
  tenantId: string;
  created: boolean;
  counts: Record<string, number>;
}

const SETTINGS = (tenantId: string, userId: string, root: string) => [
  ['app.tenant_id', tenantId], ['app.user_id', userId], ['app.node_ids', `{${root}}`], ['app.is_tenant_admin', 'true'], ['app.can_write', 'true'],
] as const;

export async function seedDemoTenant(databaseUrl: string, init: DemoInit = {}): Promise<DemoResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const dep = (await client.query<{ region: 'ca-qc' | 'us' }>('SELECT region FROM deployment_info')).rows[0];
    if (!dep) throw new Error('deployment_info is empty: run bootstrap-deployment first');
    const ca = dep.region === 'ca-qc';
    const name = ca ? 'Maple Demo Insurance' : 'Liberty Demo Insurance';
    const existing = (await client.query<{ id: string }>('SELECT id FROM tenants WHERE is_demo LIMIT 1')).rows[0];
    if (existing && !init.reset) return { tenantId: existing.id, created: false, counts: {} };

    await client.query('BEGIN');
    const tenantId = existing?.id ?? randomUUID();
    let root: string;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
    const r = rng(20261008);

    if (existing) {
      root = (await client.query<{ id: string }>(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [tenantId])).rows[0]!.id;
      for (const [k, v] of SETTINGS(tenantId, randomUUID(), root)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
      // Children first. Everything below hangs off boxes, contacts, accounts or pipelines.
      for (const t of ['box_threads', 'notes', 'tasks', 'box_contacts', 'boxes', 'email_threads', 'contacts', 'accounts', 'field_defs', 'stages', 'pipelines']) {
        await client.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
      }
      await client.query(`DELETE FROM consent_records WHERE tenant_id = $1 AND kind = 'link_thread'`, [tenantId]);
    } else {
      root = randomUUID();
      const adminId = randomUUID();
      for (const [k, v] of SETTINGS(tenantId, adminId, root)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
      await client.query('INSERT INTO tenants (id, name, country_code, region, default_locale, is_demo) VALUES ($1,$2,$3,$4,$5,true)', [tenantId, name, ca ? 'CA' : 'US', dep.region, 'en']);
      await client.query('INSERT INTO tenant_settings (tenant_id, max_partner_levels) VALUES ($1,$2)', [tenantId, MAX_PARTNER_LEVELS]);
      await client.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1,$2,'tenant',$3)`, [root, tenantId, name]);
      bump('org_nodes');

      // Locations hang off the tenant root by position only; links exist from a location to its partners and between partners.
      const node = async (type: 'location' | 'partner', nm: string, parent: string | null, kind: 'location_link' | 'partner_link' | null) => {
        const id = randomUUID();
        await client.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1,$2,$3,$4)`, [id, tenantId, type, nm]);
        if (parent && kind) await client.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind) VALUES ($1,$2,$3,$4)`, [tenantId, parent, id, kind]);
        bump('org_nodes');
        return id;
      };
      const loc = ca
        ? { a: await node('location', 'Toronto branch', null, null), b: await node('location', 'Vancouver branch', null, null), c: await node('location', 'Montréal branch', null, null) }
        : { a: await node('location', 'New York branch', null, null), b: await node('location', 'California branch', null, null), c: await node('location', 'Texas branch', null, null) };
      const partner = await node('partner', 'Northwind Partner Agency', loc.a, 'location_link');
      await client.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind) VALUES ($1,$2,$3,'location_link')`, [tenantId, loc.b, partner]);
      const sub = await node('partner', 'Harbour Brokers', partner, 'partner_link');

      type U = { key: string; name: string; email: string; node: string; role: 'admin' | 'manager' | 'trainer' | 'partner' | 'learner' | 'compliance'; locale?: 'en' | 'fr-CA'; status?: 'active' | 'invited' | 'disabled' };
      const d = (s: string) => `${s}@demo.invalid`;
      const users: U[] = [
        { key: 'admin', name: 'Demo Admin', email: (init.adminEmail ?? d('admin')).trim().toLowerCase(), node: root, role: 'admin' },
        { key: 'compliance', name: 'Priya Nair', email: d('priya.nair'), node: root, role: 'compliance' },
        { key: 'trainer', name: 'Marcus Lee', email: d('marcus.lee'), node: root, role: 'trainer' },
        { key: 'mgrA', name: 'Aisha Khan', email: d('aisha.khan'), node: loc.a, role: 'manager' },
        { key: 'advA1', name: 'Daniel Singh', email: d('daniel.singh'), node: loc.a, role: 'learner' },
        { key: 'advA2', name: 'Emma Clarke', email: d('emma.clarke'), node: loc.a, role: 'learner' },
        { key: 'mgrB', name: 'Wei Chen', email: d('wei.chen'), node: loc.b, role: 'manager' },
        { key: 'advB1', name: 'Sofia Rossi', email: d('sofia.rossi'), node: loc.b, role: 'learner' },
        { key: 'mgrC', name: 'Jean-Philippe Gagnon', email: d('jp.gagnon'), node: loc.c, role: 'manager', locale: 'fr-CA' },
        { key: 'advC1', name: 'Camille Roy', email: d('camille.roy'), node: loc.c, role: 'learner', locale: 'fr-CA' },
        { key: 'partAdmin', name: 'Harpreet Dhillon', email: d('harpreet.dhillon'), node: partner, role: 'admin' },
        { key: 'subUser', name: 'Olivia Brown', email: d('olivia.brown'), node: sub, role: 'partner' },
        { key: 'newhire', name: 'Liam Walker', email: d('liam.walker'), node: loc.a, role: 'learner', status: 'invited' },
        { key: 'former', name: 'Noah Martin', email: d('noah.martin'), node: loc.b, role: 'learner', status: 'disabled' },
      ];
      const ids: Record<string, string> = { admin: adminId };
      for (const u of users) {
        const id = ids[u.key] ?? randomUUID();
        ids[u.key] = id;
        const status = u.status ?? 'active';
        await client.query(
          `INSERT INTO app_users (id, tenant_id, email, display_name, locale, status, home_node_id, last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, tenantId, u.email, u.name, u.locale ?? 'en', status, u.node, status === 'active' ? ago(r.int(0, 6), r.int(0, 20)) : null],
        );
        await client.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1,$2,$3,$4)`, [tenantId, id, u.node, u.role]);
        if (status === 'active') {
          await client.query(`INSERT INTO consent_records (tenant_id, user_id, kind, notice_version, locale, region) VALUES ($1,$2,'first_login','v1',$3,$4)`, [tenantId, id, u.locale ?? 'en', dep.region]);
        }
        bump('users');
      }
      await client.query(`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,'tenant_created','tenant',$1,$3)`, [tenantId, adminId, JSON.stringify({ name, demo: true })]);
    }

    // ---- Everything below is rebuilt on every run (first seed and reset). ----
    const ctxRow = (await client.query<{ id: string; node: string; role: string; name: string; locale: string }>(
      `SELECT u.id, u.home_node_id AS node, (SELECT role::text FROM user_node_roles x WHERE x.user_id = u.id LIMIT 1) AS role, u.display_name AS name, u.locale::text AS locale
         FROM app_users u WHERE u.tenant_id = $1 AND u.status = 'active'`, [tenantId])).rows;
    const adminRow = ctxRow.find((u) => u.role === 'admin' && u.node === root)!;
    for (const [k, v] of SETTINGS(tenantId, adminRow.id, root)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
    const nodes = (await client.query<{ id: string; name: string; type: string }>(`SELECT id, name, type::text FROM org_nodes WHERE tenant_id = $1`, [tenantId])).rows;
    const firstLoc = nodes.filter((n) => n.type === 'location').sort((a, b) => a.name.localeCompare(b.name));
    const advisors = ctxRow.filter((u) => ['learner', 'manager'].includes(u.role) && u.node !== root);
    const frNode = nodes.find((n) => n.name.startsWith('Montr'))?.id;

    // Pipelines: three shared down from the head office, one visible only to one branch.
    type Fd = [string, Record<string, string>, 'text' | 'date' | 'currency' | 'dropdown', string[] | null];
    const PIPES: { name: string; owner: string; shared: boolean; stages: [string, boolean, boolean][]; fields: Fd[]; products: string[] }[] = [
      {
        name: 'Travel & Visitor', owner: root, shared: true, products: ['Single-trip travel', 'Multi-trip annual', 'Visitor to Canada', 'Student coverage'],
        stages: [['New enquiry', false, false], ['Needs analysis', false, false], ['Quote sent', false, false], ['Accepted', false, false], ['Policy issued', true, false], ['Lost', false, true]],
        fields: [['destination', { en: 'Destination', 'fr-CA': 'Destination' }, 'text', null], ['departure', { en: 'Departure date', 'fr-CA': 'Date de départ' }, 'date', null], ['premium', { en: 'Premium', 'fr-CA': 'Prime' }, 'currency', null], ['carrier', { en: 'Carrier', 'fr-CA': 'Assureur' }, 'dropdown', ['Allianz Global Assistance', 'GMS', 'RSA', 'Tugo', 'Travelance', 'MRM', 'Travel Shield']]],
      },
      {
        name: 'Super Visa', owner: root, shared: true, products: ['Super Visa 1 year', 'Super Visa with deductible', 'Super Visa instalments'],
        stages: [['Enquiry', false, false], ['Documents', false, false], ['Quote sent', false, false], ['Application', false, false], ['Policy issued', true, false], ['Declined', false, true]],
        fields: [['applicant_age', { en: 'Oldest applicant age', 'fr-CA': 'Âge du plus âgé' }, 'text', null], ['premium', { en: 'Premium', 'fr-CA': 'Prime' }, 'currency', null], ['carrier', { en: 'Carrier', 'fr-CA': 'Assureur' }, 'dropdown', ['Allianz Global Assistance', 'GMS', 'RSA', 'Tugo', 'Travelance', 'MRM', 'Travel Shield']]],
      },
      {
        name: 'Life & Health', owner: root, shared: true, products: ['Term life 20', 'Living benefits', 'Group health', 'Savings plan'],
        stages: [['Lead', false, false], ['Meeting booked', false, false], ['Quote sent', false, false], ['Underwriting', false, false], ['Policy issued', true, false], ['Lost', false, true]],
        fields: [['coverage_amount', { en: 'Coverage amount', 'fr-CA': 'Montant de couverture' }, 'currency', null], ['renewal_date', { en: 'Renewal date', 'fr-CA': 'Date de renouvellement' }, 'date', null], ['medical_required', { en: 'Medical exam', 'fr-CA': 'Examen médical' }, 'dropdown', ['Not required', 'Scheduled', 'Done']]],
      },
      {
        name: 'Branch referrals', owner: (firstLoc.find((n) => /^(Toronto|New York)/.test(n.name)) ?? firstLoc[0]!).id, shared: false, products: ['Referral'],
        stages: [['Received', false, false], ['Contacted', false, false], ['Converted', true, false], ['Not a fit', false, true]],
        fields: [['referrer', { en: 'Referred by', 'fr-CA': 'Référé par' }, 'text', null]],
      },
    ];
    const pipes: { id: string; stageIds: string[]; def: (typeof PIPES)[number] }[] = [];
    for (const p of PIPES) {
      const id = randomUUID();
      await client.query(`INSERT INTO pipelines (id, tenant_id, owner_node_id, name, is_shared_down, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, tenantId, p.owner, p.name, p.shared, adminRow.id]);
      const stageIds: string[] = [];
      let pos = 1;
      for (const [nm, won, lost] of p.stages) {
        const sid = randomUUID();
        stageIds.push(sid);
        await client.query('INSERT INTO stages (id, tenant_id, pipeline_id, name, position, is_won, is_lost) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sid, tenantId, id, nm, pos++, won, lost]);
      }
      let fp = 1;
      for (const [key, labels, type, options] of p.fields) {
        await client.query('INSERT INTO field_defs (tenant_id, pipeline_id, key, labels, type, options, required, position) VALUES ($1,$2,$3,$4,$5,$6,false,$7)', [tenantId, id, key, JSON.stringify(labels), type, options ? JSON.stringify(options) : null, fp++]);
      }
      pipes.push({ id, stageIds, def: p });
      bump('pipelines');
    }

    // Accounts (companies) owned by branches.
    const accountIds: { id: string; node: string }[] = [];
    for (const [i, co] of COMPANIES.entries()) {
      const n = firstLoc[i % firstLoc.length]!.id;
      const id = randomUUID();
      await client.query(`INSERT INTO accounts (id, tenant_id, owner_node_id, name, domain) VALUES ($1,$2,$3,$4,$5)`, [id, tenantId, n, co, `${co.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`]);
      accountIds.push({ id, node: n });
      bump('accounts');
    }

    // Contacts: mostly English, a Montréal group in French; a few edge cases.
    type C = { id: string; node: string; owner: string; fr: boolean; name: string };
    const contacts: C[] = [];
    const usedEmail = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const owner = r.pick(advisors);
      const fr = owner.node === frNode && r.chance(0.8);
      const first = fr ? r.pick(FIRST_FR) : r.pick(FIRST_EN);
      const last = fr ? r.pick(LAST_FR) : r.pick(LAST_EN);
      const full = `${first} ${last}`;
      let email = `${first}.${last}${i}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9.]/g, '') + '@example.com';
      if (usedEmail.has(`${owner.node}:${email}`)) email = `x${i}.${email}`;
      usedEmail.add(`${owner.node}:${email}`);
      const acct = r.chance(0.12) ? r.pick(accountIds.filter((a) => a.node === owner.node).length ? accountIds.filter((a) => a.node === owner.node) : accountIds) : null;
      const id = randomUUID();
      await client.query(
        `INSERT INTO contacts (id, tenant_id, owner_node_id, account_id, email, full_name, phone, custom, email_opt_out_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, tenantId, owner.node, acct?.id ?? null, email, full, `+1 555 01${String(i).padStart(2, '0')}`, JSON.stringify({ language: fr ? 'fr-CA' : 'en', source: r.pick(SOURCES) }), r.chance(0.04) ? ago(r.int(1, 60)) : null, ago(r.int(1, 120))],
      );
      contacts.push({ id, node: owner.node, owner: owner.id, fr, name: full });
      bump('contacts');
    }
    // Edge case: the same person known to two branches (allowed, isolated).
    const twin = contacts[0]!;
    const otherNode = firstLoc.find((n) => n.id !== twin.node)!.id;
    await client.query(`INSERT INTO contacts (tenant_id, owner_node_id, email, full_name, phone, custom) VALUES ($1,$2,$3,$4,$5,'{}')`, [tenantId, otherNode, `twin.${twin.id.slice(0, 6)}@example.com`, twin.name, '+1 555 0199']);
    bump('contacts');

    // Boxes (deals) across pipelines and stages, with notes, tasks and linked threads.
    const consentByUser = new Map<string, string>();
    const consentFor = async (userId: string, locale: string) => {
      if (consentByUser.has(userId)) return consentByUser.get(userId)!;
      const id = randomUUID();
      await client.query(`INSERT INTO consent_records (id, tenant_id, user_id, kind, notice_version, locale, region) VALUES ($1,$2,$3,'link_thread','v1',$4,$5)`, [id, tenantId, userId, locale, dep.region]);
      consentByUser.set(userId, id);
      return id;
    };
    const stageWeights = [0.22, 0.2, 0.2, 0.12, 0.16, 0.1];
    const pickStage = (n: number) => {
      let x = r.next();
      for (let i = 0; i < n; i++) { x -= stageWeights[i] ?? 0.1; if (x <= 0) return i; }
      return n - 1;
    };
    const posCounter = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const pipe = pipes[i % 10 < 4 ? 0 : i % 10 < 7 ? 1 : i % 10 < 9 ? 2 : 3]!;
      const advisorsForPipe = pipe.def.owner === root ? advisors : advisors.filter((a) => a.node === pipe.def.owner);
      const c = pipe.def.owner === root ? r.pick(contacts) : r.pick(contacts.filter((x) => x.node === pipe.def.owner));
      const owner = advisorsForPipe.find((a) => a.id === c.owner) ?? r.pick(advisorsForPipe.length ? advisorsForPipe : advisors);
      const si = pickStage(pipe.stageIds.length);
      const stale = r.chance(0.18) && si < pipe.stageIds.length - 2;
      const entered = stale ? ago(r.int(15, 45)) : ago(r.int(0, 12), r.int(0, 20));
      const product = r.pick(pipe.def.products);
      const closeOffset = si >= pipe.stageIds.length - 2 ? -r.int(1, 40) : r.int(-8, 45); // some overdue
      const custom: Record<string, unknown> = {};
      for (const f of pipe.def.fields) {
        if (f[0] === 'destination') custom[f[0]] = r.pick(DESTINATIONS);
        else if (f[0] === 'departure' || f[0] === 'renewal_date') custom[f[0]] = dateOnly(ahead(r.int(10, 330)));
        else if (f[0] === 'premium') custom[f[0]] = r.int(180, 3800);
        else if (f[0] === 'carrier') custom[f[0]] = r.pick(f[3]!);
        else if (f[0] === 'applicant_age') custom[f[0]] = String(r.int(58, 82));
        else if (f[0] === 'coverage_amount') custom[f[0]] = r.pick([250000, 500000, 750000, 1000000]);
        else if (f[0] === 'medical_required') custom[f[0]] = r.pick(f[3]!);
        else if (f[0] === 'referrer') custom[f[0]] = r.pick(FIRST_EN) + ' ' + r.pick(LAST_EN);
      }
      const id = randomUUID();
      const pk = `${pipe.id}:${pipe.stageIds[si]}`;
      const pos = (posCounter.get(pk) ?? 0) + 1;
      posCounter.set(pk, pos);
      await client.query(
        `INSERT INTO boxes (id, tenant_id, pipeline_id, stage_id, owner_node_id, owner_user_id, name, value_amount, currency, close_date, custom, created_by, created_at, stage_entered_at, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, tenantId, pipe.id, pipe.stageIds[si], c.node, owner.id, `${c.name}: ${product}`, (custom.premium as number | undefined) ?? r.int(300, 4000), ca ? 'CAD' : 'USD', dateOnly(ahead(closeOffset)), JSON.stringify(custom), owner.id, ago(r.int(10, 150)), entered, pos],
      );
      await client.query(`INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3)`, [id, c.id, tenantId]);
      bump('boxes');

      const nNotes = r.chance(0.65) ? r.int(1, 3) : 0;
      for (let k = 0; k < nNotes; k++) {
        const isCall = r.chance(0.3);
        await client.query(
          `INSERT INTO notes (tenant_id, box_id, owner_node_id, author_id, body, kind, call_outcome, call_minutes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tenantId, id, c.node, owner.id, c.fr ? r.pick(NOTE_FR) : r.pick(NOTE_TEXT), isCall ? 'call' : 'note', isCall ? r.pick(['connected', 'connected', 'voicemail', 'no_answer']) : null, isCall ? r.int(2, 25) : null, ago(r.int(0, 30), r.int(0, 20))],
        );
        bump('notes');
      }
      if (r.chance(0.55)) {
        const kind = r.pick(['overdue', 'today', 'soon', 'later', 'done'] as const);
        const due = kind === 'overdue' ? ago(r.int(1, 9)) : kind === 'today' ? new Date(Date.now() + r.int(1, 8) * 3_600_000) : kind === 'soon' ? ahead(r.int(1, 3)) : kind === 'later' ? ahead(r.int(5, 25)) : ago(r.int(1, 6));
        await client.query(`INSERT INTO tasks (tenant_id, box_id, owner_node_id, assignee_id, title, due_at, done_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tenantId, id, c.node, owner.id, r.pick(TASK_TITLES), due, kind === 'done' ? ago(r.int(0, 5)) : null]);
        bump('tasks');
      }
      if (r.chance(0.3)) {
        const tid = randomUUID();
        const subj = c.fr ? THREAD_SUBJECTS[5]! : r.pick(THREAD_SUBJECTS);
        await client.query(
          `INSERT INTO email_threads (id, tenant_id, owner_node_id, gmail_thread_id, subject, snippet, participants, last_message_at, message_count, linked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tid, tenantId, c.node, `demo-${i}`, subj, 'Thanks for getting back to me. Could you confirm the coverage dates and the deductible?', JSON.stringify([owner.id, c.name]), ago(r.int(0, 20)), r.int(2, 9), owner.id],
        );
        await client.query(`INSERT INTO box_threads (box_id, thread_id, tenant_id, linked_by, consent_id) VALUES ($1,$2,$3,$4,$5)`, [id, tid, tenantId, owner.id, await consentFor(owner.id, owner.locale)]);
        bump('threads');
      }
    }
    // Edge case: a box with no owner or contact, a very long name, and an empty pipeline stage (Lost) are already covered by the weights above.

    await client.query('COMMIT');
    return { tenantId, created: !existing, counts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
