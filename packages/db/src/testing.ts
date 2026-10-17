import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate, bootstrapDeployment } from './index.ts';

export interface TestDb {
  name: string;
  ownerUrl: string;
  appUrl: string;
  authUrl: string;
  drop(): Promise<void>;
}

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:pw@127.0.0.1:5432/postgres';

function swapDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Creates a throwaway database from the real migrations, in a given region. Needs a superuser (TEST_ADMIN_URL). */
export async function createTestDb(region: 'ca-qc' | 'us' = 'ca-qc'): Promise<TestDb> {
  const name = `pii_t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${name}`); }
  catch (error) { await admin.end(); throw error; }
  const ownerUrl = swapDb(ADMIN, name);
  try {
    await migrate(ownerUrl);
    await bootstrapDeployment(ownerUrl, { region, environment: 'dev' });
  } catch (error) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
    finally { await admin.end(); }
    throw error;
  }
  // LOGIN + password for the two runtime roles (roles are cluster-wide; idempotent).
  try {
    await admin.query(`ALTER ROLE app_runtime LOGIN PASSWORD 'pw'`);
    await admin.query(`ALTER ROLE app_auth LOGIN PASSWORD 'pw'`);
  } catch (error) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
    finally { await admin.end(); }
    throw error;
  }
  const mk = (user: string) => {
    const u = new URL(ownerUrl);
    u.username = user;
    u.password = 'pw';
    return u.toString();
  };
  return {
    name,
    ownerUrl,
    appUrl: mk('app_runtime'),
    authUrl: mk('app_auth'),
    async drop() {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
