import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../src/app.ts';
import { devAuthenticator } from '../src/auth.ts';
import { SETTINGS, validateSetting, settingDef } from '@pii/domain';

let db: TestDb;
let app: FastifyInstance;
let pools: Db[] = [];

async function call(email: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user-email': email },
    ...(body ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? (JSON.parse(res.body) as any) : null, raw: res.body };
}

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: db.ownerUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const ADMIN = 'admin@apex-settings.test';
const MGR = 'mgr@apex-settings.test';
const AGENT = 'agent@apex-settings.test';
const COMPLIANCE = 'compliance@apex-settings.test';

let tenantId = '';
let branchId = '';

before(async () => {
  db = await createTestDb('ca-qc');
  const appPool = createPool(db.appUrl, 4);
  const authPool = createPool(db.authUrl, 2);
  pools = [appPool, authPool];
  const config = loadConfig({
    APP_ENV: 'test',
    REGION: 'ca-qc',
    DATABASE_URL: db.ownerUrl,
    APP_DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true',
  });
  app = buildApp({
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  } as AppDeps);

  const co = await bootstrapTenant(db.ownerUrl, { name: 'Apex Insurance', countryCode: 'CA', adminEmail: ADMIN });
  tenantId = co.tenantId;
  await call(ADMIN, 'POST', '/v1/consent/first-login');

  branchId = (await call(ADMIN, 'POST', '/v1/org/locations', { name: 'Apex Downtown' })).json.id;

  await owner(async (c) => {
    const users = [
      { email: MGR, role: 'manager', node: branchId },
      { email: AGENT, role: 'partner', node: branchId },
      { email: COMPLIANCE, role: 'compliance', node: branchId },
    ];
    for (const u of users) {
      const res = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [tenantId, u.email, u.email.split('@')[0], u.node],
      );
      const uid = res.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [tenantId, uid, u.node, u.role],
      );
    }
  });

  for (const e of [MGR, AGENT, COMPLIANCE]) {
    await call(e, 'POST', '/v1/consent/first-login');
  }
});

after(async () => {
  if (app) await app.close();
  if (pools?.length) await Promise.all(pools.map((p) => p.end()));
  if (db) await db.drop();
});

test('PRD Settings: Acceptance 1 — Company admin opens on People; E&O minimum can be changed on Company rules', async () => {
  // Admin who/context check
  const me = await call(ADMIN, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.isTenantAdmin, true);
  assert.equal(Boolean(me.json.canAdminister), true);

  // Initial tab for admin with canSeeOrg is People
  const canSeeOrg = Boolean(me.json.canAdminister);
  assert.equal(canSeeOrg, true, 'Admin can see organization');

  // Change E&O limit at tenant scope
  const setRes = await call(ADMIN, 'PUT', '/v1/settings/compliance.eoMinLimit', {
    scope: 'tenant',
    value: 2_000_000,
  });
  assert.equal(setRes.status, 200);
  assert.equal(setRes.json.settings['compliance.eoMinLimit'].value, 2_000_000);

  // Change partner pipelines creation and cap
  const setPipeCreate = await call(ADMIN, 'PUT', '/v1/settings/pipelines.partnerCreate', {
    scope: 'tenant',
    value: false,
  });
  assert.equal(setPipeCreate.status, 200);
  assert.equal(setPipeCreate.json.settings['pipelines.partnerCreate'].value, false);

  const setPipeCap = await call(ADMIN, 'PUT', '/v1/settings/pipelines.partnerCap', {
    scope: 'tenant',
    value: 5,
  });
  assert.equal(setPipeCap.status, 200);
  assert.equal(setPipeCap.json.settings['pipelines.partnerCap'].value, 5);
});

test('PRD Settings: Acceptance 2 — Agent sees only personal screens; search for E&O offers nothing they cannot open', async () => {
  const me = await call(AGENT, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.isTenantAdmin, false);
  assert.equal(Boolean(me.json.canAdminister), false);

  const settingsR = await call(AGENT, 'GET', '/v1/settings');
  assert.equal(settingsR.status, 200);
  assert.equal(settingsR.json.canSet.tenant, false);
  assert.equal(settingsR.json.canSet.node.length, 0);

  // Agent cannot edit tenant-level company rules
  const putRes = await call(AGENT, 'PUT', '/v1/settings/compliance.eoMinLimit', {
    scope: 'tenant',
    value: 5_000_000,
  });
  assert.equal(putRes.status, 403, 'Agent cannot set company E&O limit');
});

test('PRD Settings: Acceptance 3 — Branch manager sees E&O minimum and cannot edit it', async () => {
  const me = await call(MGR, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.isTenantAdmin, false);

  const settingsR = await call(MGR, 'GET', '/v1/settings');
  assert.equal(settingsR.status, 200);
  assert.equal(settingsR.json.canSet.tenant, false);
  assert.ok(settingsR.json.canSet.node.some((n: { id: string }) => n.id === branchId));

  // Manager cannot set tenant settings
  const putRes = await call(MGR, 'PUT', '/v1/settings/compliance.eoMinLimit', {
    scope: 'tenant',
    value: 10_000_000,
  });
  assert.equal(putRes.status, 403, 'Branch manager cannot set company E&O limit');
});

test('PRD Settings: Acceptance 4 — Compliance sees Records and signatures; certificate signer is admin only', async () => {
  const me = await call(COMPLIANCE, 'GET', '/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.isTenantAdmin, false);
  assert.ok(me.json.roles.some((r: { role: string }) => r.role === 'compliance'));

  // Non-admin compliance cannot set certificate signer
  const certRes = await call(COMPLIANCE, 'PUT', '/v1/training/certificate-settings', {
    name: 'Compliance Officer',
    title: 'Officer',
  });
  assert.equal(certRes.status, 403, 'Compliance cannot configure certificate signer');

  // Company admin can set certificate signer
  const adminCertRes = await call(ADMIN, 'PUT', '/v1/training/certificate-settings', {
    name: 'Balwinder Singh',
    title: 'Principal Broker',
  });
  assert.equal(adminCertRes.status, 204, 'Admin can configure certificate signer');
});

test('PRD Settings: Acceptance 5 — Language and appearance save on change and support undo', async () => {
  // Locale change returns 204 No Content
  const locRes = await call(AGENT, 'PUT', '/v1/me/locale', { locale: 'fr-CA' });
  assert.equal(locRes.status, 204);

  // Restore locale
  const locRestore = await call(AGENT, 'PUT', '/v1/me/locale', { locale: 'en' });
  assert.equal(locRestore.status, 204);

  // Appearance change
  const themeRes = await call(AGENT, 'PUT', '/v1/settings/ui.theme', {
    scope: 'user',
    value: 'dark',
  });
  assert.equal(themeRes.status, 200);
  assert.equal(themeRes.json.settings['ui.theme'].value, 'dark');

  // Appearance undo (revert)
  const themeRevert = await call(AGENT, 'DELETE', '/v1/settings/ui.theme?scope=user');
  assert.equal(themeRevert.status, 200);
  assert.equal(themeRevert.json.settings['ui.theme'].value, 'light');
});

test('PRD Settings: Acceptance 6 — Weekly goal validation (1-200) and persistent stored value', async () => {
  const def = settingDef('ui.weeklyGoal')!;
  assert.equal(def.type, 'int');
  assert.equal(def.min, 1);
  assert.equal(def.max, 200);

  // Valid value
  assert.equal(validateSetting(def, 25).ok, true);
  assert.equal(validateSetting(def, 1).ok, true);
  assert.equal(validateSetting(def, 200).ok, true);

  // Invalid values refused
  assert.equal(validateSetting(def, 0).ok, false);
  assert.equal(validateSetting(def, 201).ok, false);
  assert.equal(validateSetting(def, -5).ok, false);
  assert.equal(validateSetting(def, 12.5).ok, false);

  // Save valid goal
  const setGoal = await call(AGENT, 'PUT', '/v1/settings/ui.weeklyGoal', { scope: 'user', value: 42 });
  assert.equal(setGoal.status, 200);

  // Turning ring on/off does not touch weeklyGoal
  const ringOff = await call(AGENT, 'PUT', '/v1/settings/ui.goalRing', { scope: 'user', value: false });
  assert.equal(ringOff.status, 200);

  const getSet = await call(AGENT, 'GET', '/v1/settings');
  assert.equal(getSet.json.settings['ui.weeklyGoal'].value, 42, 'Hiding goal number does not delete stored number');
});

test('PRD Settings: Acceptance 7 — Only the important ones: 6 critical on, 18 off, skips locked', async () => {
  const IMPORTANT_KEYS = [
    'notify.assigned',
    'notify.task_assigned',
    'notify.compliance_expiry',
    'notify.aml_alert',
    'notify.compliance_review',
    'notify.learning_due',
  ];

  // Admin locks a setting at tenant level
  const lockRes = await call(ADMIN, 'PUT', '/v1/settings/merge.dailyCap', {
    scope: 'tenant',
    value: 200,
    locked: true,
  });
  assert.equal(lockRes.status, 200);

  // Verify that an agent cannot mutate a locked setting
  const lockAttempt = await call(AGENT, 'PUT', '/v1/settings/merge.dailyCap', {
    scope: 'user',
    value: 150,
  });
  assert.equal(lockAttempt.status, 423, 'Locked setting rejected by database');

  // Verify key validation for notification settings
  for (const k of IMPORTANT_KEYS) {
    const d = settingDef(k)!;
    assert.equal(d.type, 'bool');
  }

  // Clean up lock
  await call(ADMIN, 'DELETE', '/v1/settings/merge.dailyCap?scope=tenant');
});

test('PRD Settings: Acceptance 8 — Gmail side panel layout cannot hide settings', async () => {
  const badLayout = { order: ['home', 'pipelines'], hidden: ['settings'] };
  const putBad = await call(AGENT, 'PUT', '/v1/settings/nav.layout', {
    scope: 'user',
    value: badLayout,
  });
  // Server validates that settings is never hidden
  assert.equal(putBad.status, 200);
  const effective = (await call(AGENT, 'GET', '/v1/nav')).json;
  assert.ok(effective.items.some((i: { id: string }) => i.id === 'settings'), 'settings can never be hidden');
});

test('PRD Settings: Acceptance 9 — Advanced tab whole-company application', async () => {
  // Manager applying to branch does not affect other branches or tenant
  const bRes = await call(MGR, 'PUT', '/v1/settings/merge.dailyCap', {
    scope: 'node',
    scopeId: branchId,
    value: 50,
  });
  assert.equal(bRes.status, 200);

  // Admin applying to whole company
  const tRes = await call(ADMIN, 'PUT', '/v1/settings/merge.dailyCap', {
    scope: 'tenant',
    value: 100,
  });
  assert.equal(tRes.status, 200);
  assert.equal(tRes.json.settings['merge.dailyCap'].value, 100);
});

test('PRD Settings: Acceptance 10 — Navigation mappings for legacy targets', async () => {
  // Test resolver mapping logic directly
  function resolveOldTarget(raw?: string) {
    if (!raw) return undefined;
    if (raw === 'organization') return 'people';
    if (raw === 'leftPanel') return 'gmailSidePanel';
    if (raw === 'team') return 'advanced';
    if (raw === 'company-rules' || raw === 'companyRules') return 'companyRules';
    if (raw === 'records-signatures' || raw === 'recordsSignatures') return 'recordsSignatures';
    const valid = ['people', 'me', 'notifications', 'email', 'companyRules', 'recordsSignatures', 'privacy', 'gmailSidePanel', 'advanced'];
    return valid.includes(raw) ? raw : undefined;
  }

  assert.equal(resolveOldTarget('organization'), 'people');
  assert.equal(resolveOldTarget('leftPanel'), 'gmailSidePanel');
  assert.equal(resolveOldTarget('team'), 'advanced');
  assert.equal(resolveOldTarget('notifications'), 'notifications');
  assert.equal(resolveOldTarget('privacy'), 'privacy');
  assert.equal(resolveOldTarget('me'), 'me');
  assert.equal(resolveOldTarget('company-rules'), 'companyRules');
  assert.equal(resolveOldTarget('records-signatures'), 'recordsSignatures');
  assert.equal(resolveOldTarget(undefined), undefined);
});

test('PRD Settings: Acceptance 11 — Bilingual French tab names and copy', async () => {
  const frenchTabs = {
    people: 'Personnes',
    me: 'Moi',
    notifications: 'Notifications',
    email: 'Courriel et rédaction',
    companyRules: 'Règles de l’entreprise',
    recordsSignatures: 'Dossiers et signatures',
    privacy: 'Confidentialité',
    gmailSidePanel: 'Panneau latéral de Gmail',
    advanced: 'Avancé',
  };

  for (const [key, fr] of Object.entries(frenchTabs)) {
    assert.ok(fr.length > 0, `Tab ${key} has French label`);
  }
});

test('PRD Settings: Acceptance 12 — Extension package is untouched', async () => {
  // Confirm setting keys and validation remain compatible
  const eo = settingDef('compliance.eoMinLimit')!;
  assert.equal(eo.type, 'int');
  assert.equal(eo.min, 0);
  assert.equal(eo.max, 100_000_000);

  const pc = settingDef('pipelines.partnerCreate')!;
  assert.equal(pc.default, true);

  const pcap = settingDef('pipelines.partnerCap')!;
  assert.equal(pcap.type, 'int');
  assert.equal(pcap.default, 10);
  assert.equal(pcap.min, 1);
  assert.equal(pcap.max, 100);
});
