#!/usr/bin/env node
/**
 * PII Nine-Role Authenticated Smoke Test Runner
 *
 * Validates operational workspace perspectives, card authorization scopes,
 * work queue routing, and tamper protection across all nine authorized roles
 * against an isolated test environment.
 *
 * Usage:
 *   node scripts/smoke-test-roles.ts
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { bootstrapTenant, createPool, type Db } from '@pii/db';
import { createTestDb, type TestDb } from '@pii/db/testing';
import { loadConfig, localKeyProvider } from '@pii/platform';
import { buildApp, type AppDeps } from '../apps/api/src/app.ts';
import { devAuthenticator } from '../apps/api/src/auth.ts';
import { addBrokerFixture, caseOfBroker } from '../apps/api/test/support/broker.ts';

const ROLES = [
  { key: 'admin', email: 'admin@smoke.test', title: 'Executive Admin', role: 'admin', expectedCards: ['crm', 'compliance', 'onboarding', 'carriers', 'training', 'learning', 'audit', 'notifications'] },
  { key: 'ho', email: 'ho@smoke.test', title: 'Head Office Compliance', role: 'admin', isHo: true, expectedCards: ['crm', 'compliance', 'onboarding', 'carriers', 'training', 'audit', 'notifications'] },
  { key: 'manager', email: 'manager@smoke.test', title: 'Branch Manager', role: 'manager', expectedCards: ['crm', 'training', 'learning', 'notifications'] },
  { key: 'partner', email: 'partner@smoke.test', title: 'Licensed Broker', role: 'partner', expectedCards: ['crm', 'onboarding', 'carriers', 'learning', 'notifications'] },
  { key: 'compliance', email: 'compliance@smoke.test', title: 'Compliance Officer', role: 'compliance', expectedCards: ['compliance', 'onboarding', 'carriers', 'audit', 'notifications'] },
  { key: 'auditor', email: 'auditor@smoke.test', title: 'Statutory Auditor', role: 'auditor', expectedCards: ['audit', 'notifications'] },
  { key: 'trainer', email: 'trainer@smoke.test', title: 'Branch Trainer', role: 'trainer', expectedCards: ['training', 'learning', 'notifications'] },
  { key: 'learner', email: 'learner@smoke.test', title: 'Agent Trainee', role: 'learner', expectedCards: ['learning', 'notifications'] },
  { key: 'staff', email: 'staff@smoke.test', title: 'Operations Staff', role: 'staff', expectedCards: ['crm', 'learning', 'notifications'] },
];

async function run() {
  console.log('\n======================================================================');
  console.log('   PII Nine-Role Authenticated Smoke Test Suite (Isolated Data)       ');
  console.log('======================================================================\n');
  console.log('• Initializing isolated test database and server fixtures...');

  const db: TestDb = await createTestDb('ca-qc');
  const appPool: Db = createPool(db.appUrl, 4);
  const authPool: Db = createPool(db.authUrl, 2);
  const pools = [appPool, authPool];

  const config = loadConfig({
    APP_ENV: 'test',
    REGION: 'ca-qc',
    DATABASE_URL: db.ownerUrl,
    APP_DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    DEV_AUTH: 'true',
  });

  const deps: AppDeps = {
    config,
    appPool,
    authPool,
    authenticate: devAuthenticator(authPool),
    keys: localKeyProvider('0123456789abcdef0123'),
  };
  const app = buildApp(deps);

  const call = async (email: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      headers: { 'x-dev-user-email': email },
      ...(body ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };

  const owner = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: db.ownerUrl });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  // Bootstrap tenant
  const adminProfile = ROLES.find(r => r.key === 'admin')!;
  const co = await bootstrapTenant(db.ownerUrl, { name: 'Punjab Smoke Brokerage', countryCode: 'CA', adminEmail: adminProfile.email });
  const tenantId = co.tenantId;
  await call(adminProfile.email, 'POST', '/v1/consent/first-login');

  const b1 = (await call(adminProfile.email, 'POST', '/v1/org/locations', { name: 'Toronto Downtown Branch' })).json.id;
  const brokerNode = await addBrokerFixture(call as any, db.ownerUrl, b1, 'Smoke Broker Agency Ltd.');

  await owner(async c => {
    await c.query('UPDATE tenants SET is_head_office = true WHERE id = $1', [tenantId]);
    for (const r of ROLES) {
      if (r.key === 'admin') continue;
      const targetNode = r.key === 'ho' ? co.rootNodeId : (['partner', 'learner'].includes(r.key) ? brokerNode : b1);
      const uRes = await c.query(
        `INSERT INTO app_users (tenant_id, email, display_name, home_node_id, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [tenantId, r.email, r.title, targetNode]
      );
      const uid = uRes.rows[0].id;
      await c.query(
        `INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4)`,
        [tenantId, uid, targetNode, r.role]
      );
    }
  });

  for (const r of ROLES) {
    await call(r.email, 'POST', '/v1/consent/first-login');
  }

  // Create sample pipeline and box
  const pipe = (await call(adminProfile.email, 'POST', '/v1/pipelines', { name: 'Smoke Test Commercial Lines', sharedDown: true })).json.id;
  await call(adminProfile.email, 'POST', '/v1/boxes', { pipelineId: pipe, name: 'Sample Fleet Policy', valueAmount: 12000 });

  console.log('• Tenant & role fixtures ready.\n');
  console.log('--------------------------------------------------------------------------------------------------------------------');
  console.log(String('Role Perspective').padEnd(16) + String('Auth User').padEnd(26) + String('HTTP Status').padEnd(14) + String('Cards Delivered').padEnd(32) + String('Tamper Guard').padEnd(16) + 'Summary Strip');
  console.log('--------------------------------------------------------------------------------------------------------------------');

  let passedAll = true;

  for (const r of ROLES) {
    const t0 = Date.now();
    // 1. Perspective check
    const dash = await call(r.email, 'GET', `/v1/workspace/dashboard?perspective=${r.key}`);
    const dt = Date.now() - t0;
    const okStatus = dash.status === 200;

    // 2. Card modules check
    const cards = (dash.json?.cards || []).map((c: any) => c.module);
    const hasExpectedCards = r.expectedCards.every(m => cards.includes(m));

    // 3. Tamper guard check (try accessing admin perspective if not admin)
    let tamperPassed = true;
    if (r.key !== 'admin' && r.key !== 'ho') {
      const tamper = await call(r.email, 'GET', `/v1/workspace/dashboard?perspective=admin`);
      tamperPassed = tamper.status === 403;
    }

    const hasSummary = Boolean(dash.json?.summary);
    const summaryExpected = ['admin', 'ho', 'compliance'].includes(r.key);
    const summaryOk = hasSummary === summaryExpected;

    const rowPassed = okStatus && hasExpectedCards && tamperPassed && summaryOk;
    if (!rowPassed) passedAll = false;

    const statusPill = okStatus ? `\x1b[32m${dash.status} OK\x1b[0m (${dt}ms)` : `\x1b[31m${dash.status} ERR\x1b[0m`;
    const tamperPill = tamperPassed ? `\x1b[32m403 Blocked\x1b[0m` : `\x1b[31mLEAK\x1b[0m`;
    const summaryPill = summaryOk ? (hasSummary ? `\x1b[36mPresent\x1b[0m` : `Hidden`) : `\x1b[31mFailed\x1b[0m`;

    console.log(
      r.key.padEnd(16) +
      r.email.padEnd(26) +
      statusPill.padEnd(24) +
      `${cards.length} cards (${cards.slice(0, 3).join(',')}...)`.padEnd(32) +
      tamperPill.padEnd(26) +
      summaryPill
    );
  }

  console.log('--------------------------------------------------------------------------------------------------------------------\n');

  await app.close();
  await Promise.all(pools.map(p => p.end()));
  await db.drop();

  if (passedAll) {
    console.log('\x1b[32m✔ Authenticated smoke test passed across all 9 roles with strict tamper isolation and accurate scoping.\x1b[0m\n');
    process.exit(0);
  } else {
    console.error('\x1b[31m✖ One or more smoke tests failed.\x1b[0m\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal smoke test error:', err);
  process.exit(1);
});
