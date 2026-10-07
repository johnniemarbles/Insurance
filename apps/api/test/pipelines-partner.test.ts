import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';

let db: TestDb; let app: FastifyInstance; let pools: Db[] = [];
let co: { tenantId: string; rootNodeId: string }; let other: { tenantId: string; rootNodeId: string };
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function call(email: string, method: M, url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-dev-user-email': email }, ...(body ? { payload: body as object } : {}) });
  let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* html */ }
  return { status: res.statusCode, json };
}
async function seedUser(tenantId: string, email: string, home: string, role: string) {
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const u = (await o.query(`INSERT INTO app_users (tenant_id,email,home_node_id,status) VALUES ($1,$2,$3,'active') RETURNING id`, [tenantId, email, home])).rows[0].id;
  await o.query(`INSERT INTO user_node_roles (tenant_id,user_id,node_id,role) VALUES ($1,$2,$3,$4)`, [tenantId, u, home, role]);
  await o.end();
  await call(email, 'POST', '/v1/consent/first-login');
}
const ADMIN = 'admin@pp.test', MGR = 'mgr@pp.test', PA = 'pa@pp.test', PB = 'pb@pp.test', LRN = 'learner@pp.test', OTHER = 'other@pp.test';
let BR = '', NA = '', NB = '', corePipe = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4), authPool = createPool(db.authUrl, 2); pools = [appPool, authPool];
  const config = loadConfig({ APP_ENV: 'test', REGION: 'ca-qc', DATABASE_URL: db.ownerUrl, APP_DATABASE_URL: db.appUrl, AUTH_DATABASE_URL: db.authUrl, DEV_AUTH: 'true' });
  app = buildApp({ config, appPool, authPool, authenticate: devAuthenticator(authPool), keys: localKeyProvider('0123456789abcdef0123') });
  co = await bootstrapTenant(db.ownerUrl, { name: 'Maple Insurance', countryCode: 'CA', adminEmail: ADMIN });
  other = await bootstrapTenant(db.ownerUrl, { name: 'Birch Insurance', countryCode: 'CA', adminEmail: OTHER });
  await call(ADMIN, 'POST', '/v1/consent/first-login'); await call(OTHER, 'POST', '/v1/consent/first-login');
  BR = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Toronto' })).json.id;
  NA = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner A', parentId: BR })).json.id;
  NB = (await call(ADMIN, 'POST', '/v1/org/partners', { name: 'Partner B', parentId: BR })).json.id;
  await seedUser(co.tenantId, MGR, BR, 'manager');
  await seedUser(co.tenantId, PA, NA, 'partner');
  await seedUser(co.tenantId, PB, NB, 'partner');
  await seedUser(co.tenantId, LRN, NA, 'learner');
  corePipe = (await call(MGR, 'POST', '/v1/pipelines', { name: 'Branch standard', sharedDown: true, stages: [{ name: 'New' }, { name: 'Won', isWon: true }], fields: [{ key: 'carrier', labels: { en: 'Carrier' }, type: 'text' }] })).json.id;
});
after(async () => { await app.close(); await Promise.all(pools.map((p) => p.end())); await db.drop(); });

test('a partner can make a pipeline at their own place; a learner cannot; another partner cannot see it', async () => {
  const r = await call(PA, 'POST', '/v1/pipelines', { name: 'A own' });
  assert.equal(r.status, 201);
  assert.equal((await call(LRN, 'POST', '/v1/pipelines', { name: 'no' })).status, 403);
  assert.equal((await call(PB, 'GET', '/v1/pipelines')).json.pipelines.some((p: any) => p.name === 'A own'), false);
  assert.equal((await call(MGR, 'GET', '/v1/pipelines')).json.pipelines.some((p: any) => p.name === 'A own'), true); // the branch above still sees it
  // and cannot make one at someone else's place
  assert.equal((await call(PA, 'POST', '/v1/pipelines', { name: 'x', ownerNodeId: NB })).status, 403);
  assert.equal((await call(PA, 'POST', '/v1/pipelines', { name: 'x', ownerNodeId: BR })).status, 403);
});

test('a partner edits their own pipeline but not the branch one shared down to them', async () => {
  const mine = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.name === 'A own');
  assert.equal((await call(PA, 'POST', `/v1/pipelines/${mine.id}/stages`, { name: 'Extra' })).status, 201);
  assert.equal((await call(PA, 'POST', `/v1/pipelines/${corePipe}/stages`, { name: 'Extra' })).status, 403);
  assert.equal((await call(PB, 'POST', `/v1/pipelines/${mine.id}/stages`, { name: 'Extra' })).status, 404);
});

test('copying a pipeline: stages and columns come across, automations do not, and the copy is theirs', async () => {
  const c = await call(PA, 'POST', `/v1/pipelines/${corePipe}/clone`, {});
  assert.equal(c.status, 201);
  const copy = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === c.json.id);
  assert.equal(copy.name, 'Branch standard (copy)');
  assert.equal(copy.clonedFrom, corePipe);
  assert.deepEqual(copy.stages.map((s: any) => [s.name, s.isWon]), [['New', false], ['Won', true]]);
  assert.equal(copy.fields.length, 1);
  assert.equal(copy.ownerNodeId, NA);
  assert.equal((await call(PA, 'POST', `/v1/pipelines/${copy.id}/stages`, { name: 'Mine' })).status, 201);
  assert.equal((await call(PA, 'GET', `/v1/pipelines`)).json.pipelines.find((p: any) => p.id === corePipe).stages.length, 2); // the original is untouched
  // a pipeline you cannot see cannot be copied
  const hidden = (await call(OTHER, 'POST', '/v1/pipelines', { name: 'Other co' })).json.id;
  assert.equal((await call(PA, 'POST', `/v1/pipelines/${hidden}/clone`, {})).status, 404);
});

test('the country library: only this country, English and French, and the copy remembers its template', async () => {
  const t = await call(PA, 'GET', '/v1/pipeline-templates');
  assert.equal(t.status, 200);
  assert.equal(t.json.country, 'CA');
  assert.ok(t.json.templates.length >= 8);
  assert.ok(t.json.templates.every((x: any) => x.code.startsWith('ca_')));
  assert.ok(t.json.templates.some((x: any) => x.code === 'ca_icbc'));
  assert.ok(!t.json.templates.some((x: any) => x.code === 'us_medicare'));
  const en = await call(PA, 'POST', '/v1/pipeline-templates/ca_personal/use', {});
  assert.equal(en.status, 201);
  const fr = await call(PB, 'POST', '/v1/pipeline-templates/ca_personal/use', { locale: 'fr-CA' });
  assert.equal(fr.status, 201);
  const mine = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === en.json.id);
  assert.equal(mine.templateCode, 'ca_personal'); assert.equal(mine.templateVersion, 1);
  assert.equal(mine.name, 'Personal lines');
  assert.deepEqual(mine.stages.slice(0, 2).map((s: any) => s.name), ['New lead', 'Contacted']);
  const bound = mine.stages.find((s: any) => s.isWon);
  assert.deepEqual(bound.requiredFields.sort(), ['carrier', 'effective_date', 'premium']);
  const frp = (await call(PB, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === fr.json.id);
  assert.equal(frp.name, 'Assurance de particuliers'); assert.equal(frp.stages[0].name, 'Nouvelle piste');
  assert.equal((await call(PA, 'POST', '/v1/pipeline-templates/us_medicare/use', {})).status, 404); // another country's template
  // a copy of a templated pipeline keeps the link, so results can still be compared
  const cp = await call(PA, 'POST', `/v1/pipelines/${en.json.id}/clone`, { name: 'Personal, my way' });
  assert.equal((await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === cp.json.id).templateCode, 'ca_personal');
});

test('every template is well formed: required fields exist, one won stage at most, keys valid', async () => {
  const o = new pg.Client({ connectionString: db.ownerUrl }); await o.connect();
  const rows = (await o.query('SELECT code, country, stages, fields FROM pipeline_templates')).rows; await o.end();
  assert.ok(rows.length >= 17);
  for (const r of rows) {
    const keys: string[] = r.fields.map((f: any) => f.key);
    assert.equal(new Set(keys).size, keys.length, r.code);
    for (const k of keys) assert.match(k, /^[a-z][a-z0-9_]{0,39}$/, r.code);
    assert.ok(r.stages.filter((s: any) => s.won).length <= 1, r.code);
    for (const s of r.stages) for (const k of s.req ?? []) assert.ok(keys.includes(k) || ['value', 'closeDate', 'owner'].includes(k), `${r.code}: ${k}`);
    for (const f of r.fields) if (f.type === 'dropdown') assert.ok(f.options?.length, `${r.code}.${f.key}`);
  }
});

test('the company can cap partners and switch partner pipelines off', async () => {
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/pipelines.partnerCap', { scope: 'tenant', value: 3 })).status < 300, true);
  // partner A already has several; the next one is refused with a clear reason
  const r = await call(PA, 'POST', '/v1/pipelines', { name: 'one too many' });
  assert.equal(r.status, 409); assert.match(r.json.error.message, /most allowed/);
  // managers are not capped
  assert.equal((await call(MGR, 'POST', '/v1/pipelines', { name: 'mgr again' })).status, 201);
  assert.equal((await call(ADMIN, 'PUT', '/v1/settings/pipelines.partnerCreate', { scope: 'tenant', value: false })).status < 300, true);
  assert.equal((await call(PB, 'POST', '/v1/pipelines', { name: 'off' })).status, 403);
  const mine = (await call(PA, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.name === 'A own');
  assert.equal((await call(PA, 'POST', `/v1/pipelines/${mine.id}/stages`, { name: 'x' })).status, 403);
  const places = await call(PA, 'GET', '/v1/pipelines/places');
  assert.deepEqual(places.json.places, []);
});

test('a stage added later goes before Won and Lost; a Won or Lost stage goes last', async () => {
  const id = (await call(ADMIN, 'POST', '/v1/pipelines', { name: 'Order', stages: [{ name: 'New' }, { name: 'Quoted' }, { name: 'Issued', isWon: true }, { name: 'Lost', isLost: true }] })).json.id;
  assert.equal((await call(ADMIN, 'POST', `/v1/pipelines/${id}/stages`, { name: 'Contacted' })).status, 201);
  assert.equal((await call(ADMIN, 'POST', `/v1/pipelines/${id}/stages`, { name: 'Cancelled', isLost: true })).status, 201);
  const names = (await call(ADMIN, 'GET', '/v1/pipelines')).json.pipelines.find((p: any) => p.id === id).stages.map((s: any) => s.name);
  assert.deepEqual(names, ['New', 'Quoted', 'Contacted', 'Issued', 'Lost', 'Cancelled']);
});
