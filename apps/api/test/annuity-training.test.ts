// US annuity training (US plan, step 1): annuity hours are logged as CE, and an annuity deal cannot move into a paperwork stage
// until its advisor has finished the initial annuity training their state requires. Switched on with ANNUITY_GATE_ENABLED=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { annuityStatus } from '@pii/domain';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { addBrokerFixture } from './support/broker.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
let co: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
const owner = async <T>(fn: (c: pg.Client) => Promise<T>) => { const c = new pg.Client({ connectionString: db.ownerUrl }); await c.connect(); try { return await fn(c); } finally { await c.end(); } };
async function seedUser(email: string, home: string, role: string) {
  const u = await owner(async (o) => {
    const id = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status,display_name) VALUES ($1,$2,$3,'active',$4) RETURNING id`, [co.tenantId, email, home, email.split('@')[0]])).rows[0].id;
    await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [co.tenantId, id, home, role]);
    return id as string;
  });
  await call(email, 'POST', '/v1/consent/first-login');
  return u;
}
const ADMIN = 'admin@ann.test', MGR = 'mgr@ann.test', PA = 'pa@ann.test', CAN = 'can@ann.test';
let pipe = '', sNew = '', sSub = '', paId = '', canId = '';
/** A deal owned by `who`, with a signed needs analysis for the given product line (written directly: signing is tested elsewhere). */
async function deal(who: string, whoId: string, line: 'annuity' | 'life_health') {
  const id = (await call(who, 'POST', '/v1/boxes', { pipelineId: pipe, name: `${line} deal` })).json.id as string;
  await owner((o) => o.query(
    `INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, status, client_name, created_by, signed_at, signed_method, content_hash, answers, valid_until)
     VALUES ($1,$2,'needs_analysis','Needs analysis','b','builtin','signed','Client',$3,now(),'otp','h',$4,current_date + 300)`, [co.tenantId, id, whoId, { productLine: line }]));
  return id;
}
const submit = (who: string, id: string) => call(who, 'PATCH', `/v1/boxes/${id}`, { stageId: sSub });
const logHours = (who: string, hours: number, completedOn: string, packCode = 'ca_doi') =>
  call(who, 'POST', '/v1/ce/entries', { packCode, title: 'California annuity training', provider: 'Approved provider', category: 'annuity', hours, completedOn });

before(async () => {
  process.env.ANNUITY_GATE_ENABLED = '1';
  db = await createTestDb('us');
  const appPool = createPool(db.appUrl, 6), authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'us', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  co = await bootstrapTenant(db.ownerUrl, { name: 'Liberty Brokers', countryCode: 'US', adminEmail: ADMIN });
  await call(ADMIN, 'POST', '/v1/consent/first-login');
  const BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Los Angeles' })).json.id;
  const NA = await addBrokerFixture(call, db.ownerUrl, BR, 'Pacific Annuities');
  await seedUser(MGR, BR, 'manager');
  paId = await seedUser(PA, NA, 'partner');
  canId = await seedUser(CAN, NA, 'partner');
  pipe = (await call(MGR, 'POST', '/v1/pipelines', { name: 'Annuities', sharedDown: true, stages: [{ name: 'New' }, { name: 'Submitted' }] })).json.id;
  const stages = (await call(MGR, 'GET', '/v1/pipelines')).json.pipelines.find((p: { id: string }) => p.id === pipe).stages;
  sNew = stages[0].id; sSub = stages[1].id;
  { const g = await call(ADMIN, 'PATCH', `/v1/pipelines/${pipe}/stages/${sSub}`, { requiredDocs: ['needs_analysis'] }); assert.ok(g.status < 300, JSON.stringify(g)); }
  // PA holds a California licence; CAN holds none with an annuity rule.
  assert.equal((await call(PA, 'PUT', '/v1/ce/licences', { packCode: 'ca_doi', licenceClass: 'agent', termStart: '2025-06-01' })).status, 204);
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); delete process.env.ANNUITY_GATE_ENABLED; });

test('the rule: initial hours first, then renewal hours in the term; the first hours never count toward renewal', () => {
  const ca = { initial: 8, renewal: 4 };
  const term = { start: '2027-06-01', end: '2029-05-31' };
  assert.deepEqual(
    (({ initialHours, initialDone, renewalDue }) => ({ initialHours, initialDone, renewalDue }))(annuityStatus(ca, [{ completedOn: '2027-07-01', hours: 5 }], term)),
    { initialHours: 5, initialDone: false, renewalDue: false });
  const s = annuityStatus(ca, [{ completedOn: '2026-01-10', hours: 8 }, { completedOn: '2027-08-01', hours: 3 }], term);
  assert.equal(s.initialDone, true); assert.equal(s.renewalDue, true, 'initial finished before this term'); assert.equal(s.renewalHours, 3); assert.equal(s.renewalDone, false);
  const leftover = annuityStatus(ca, [{ completedOn: '2027-07-01', hours: 10 }], term);
  assert.equal(leftover.initialDoneOn, '2027-07-01'); assert.equal(leftover.renewalDue, false, 'finished this term: renewal starts next term');
  const tx = annuityStatus({ initial: 4, renewal: 8 }, [{ completedOn: '2026-02-01', hours: 4 }, { completedOn: '2027-09-01', hours: 8 }], term);
  assert.equal(tx.renewalDone, true);
});

test('an annuity deal is blocked until the advisor finishes the initial training; logging the hours lets it through', async () => {
  const id = await deal(PA, paId, 'annuity');
  const r = await submit(PA, id);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'annuity_training');
  assert.match(r.json.error.message, /0 of 8 hours for California Department of Insurance/);
  assert.equal((await logHours(PA, 5, '2025-07-01')).status < 300, true);
  assert.match((await submit(PA, id)).json.error.message, /5 of 8 hours/);
  assert.equal((await logHours(PA, 3, '2025-08-01')).status < 300, true);
  assert.equal((await submit(PA, id)).status < 300, true, 'trained: the deal moves');
  const me = (await call(PA, 'GET', '/v1/ce/me')).json;
  assert.equal(me.annuity.length, 1);
  assert.equal(me.annuity[0].initialDone, true);
  assert.equal(me.annuity[0].initialRequired, 8);
});

test('the deal\'s own advisor is the one held to the rule, whoever moves it', async () => {
  // CAN (no annuity rule) moves an untrained colleague's deal: still blocked. PA (trained) moves CAN's annuity deal: allowed.
  const untrained = await seedUser('tx@ann.test', (await owner((o) => o.query('SELECT home_node_id FROM app_users WHERE id = $1', [paId]))).rows[0].home_node_id, 'partner');
  await owner((o) => o.query(`INSERT INTO learner_licences (tenant_id, user_id, node_id, pack_code, licence_class, term_anchor) SELECT tenant_id, id, home_node_id, 'ca_doi', 'agent', '2025-06-01' FROM app_users WHERE id = $1`, [untrained]));
  const theirs = await deal('tx@ann.test', untrained, 'annuity');
  const byCan = await submit(CAN, theirs);
  assert.equal(byCan.status, 409, JSON.stringify(byCan));
  assert.match(byCan.json.error.message, /^To move to “Submitted”, tx needs to finish annuity training/);
});

test('not affected: life deals, advisors without a US annuity rule, and the switch off', async () => {
  const life = await deal(CAN, canId, 'life_health');
  assert.equal((await submit(CAN, life)).status < 300, true);
  const ann = await deal(CAN, canId, 'annuity');
  assert.equal((await submit(CAN, ann)).status < 300, true, 'no licence with an annuity rule');
  await owner((o) => o.query(`INSERT INTO learner_licences (tenant_id, user_id, node_id, pack_code, licence_class, term_anchor) SELECT tenant_id, id, home_node_id, 'tx_tdi', (SELECT requirements->'classes'->0->>'key' FROM ce_rule_packs WHERE code = 'tx_tdi'), '2025-01-01' FROM app_users WHERE id = $1`, [canId]));
  const blocked = await deal(CAN, canId, 'annuity');
  assert.match((await submit(CAN, blocked)).json.error.message, /0 of 4 hours for Texas/);
  process.env.ANNUITY_GATE_ENABLED = '';
  assert.equal((await submit(CAN, blocked)).status < 300, true, 'switched off');
  process.env.ANNUITY_GATE_ENABLED = '1';
});

test('the training lookup stays inside one company', async () => {
  const other = await bootstrapTenant(db.ownerUrl, { name: 'Other Brokers', countryCode: 'US', adminEmail: 'other@ann.test' });
  const seen = (tenant: string) => owner(async (o) => {
    try {
      await o.query('BEGIN'); await o.query('SET LOCAL ROLE app_runtime'); await o.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return (await o.query('SELECT count(*)::int n FROM annuity_training_for($1)', [paId])).rows[0].n as number;
    } finally { await o.query('ROLLBACK'); }
  });
  assert.equal(await seen(co.tenantId), 1);
  assert.equal(await seen(other.tenantId), 0, 'another company learns nothing about this advisor');
});
