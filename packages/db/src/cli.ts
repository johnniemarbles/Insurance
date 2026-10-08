import pg from 'pg';
import { bootstrapDeployment, bootstrapTenant, ensureRoles, migrate, seedDemoTenant, seedStarterPipelines } from './index.ts';

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

try {
  if (cmd === 'migrate') {
    const r = await migrate(url);
    console.log(`applied: ${r.applied.join(', ') || '(none)'}; already applied: ${r.skipped.length}`);
  } else if (cmd === 'release') {
    // Run on every deploy before the API starts: roles, migrations, deployment identity. All idempotent.
    const region = process.env.REGION as 'ca-qc' | 'us' | undefined;
    const environment = (process.env.APP_ENV === 'prod' ? 'prod' : process.env.APP_ENV === 'staging' ? 'staging' : 'dev') as 'dev' | 'staging' | 'prod';
    if (region !== 'ca-qc' && region !== 'us') throw new Error('REGION must be ca-qc or us');
    const appRuntime = process.env.APP_DB_PASSWORD;
    const appAuth = process.env.AUTH_DB_PASSWORD;
    if (!appRuntime || !appAuth) throw new Error('APP_DB_PASSWORD and AUTH_DB_PASSWORD are required');
    await ensureRoles(url, { appRuntime, appAuth });
    const r = await migrate(url);
    const hostedIn = process.env.HOSTED_IN === 'us' || process.env.HOSTED_IN === 'ca' ? process.env.HOSTED_IN : undefined;
    await bootstrapDeployment(url, {
      region, environment, physicalRegionVerified: process.env.PHYSICAL_REGION_VERIFIED === 'true',
      // HOSTED_IN=us on the Canadian deployment records the decision to host Canadian companies in the US.
      ...(hostedIn ? { hostedIn, residencyAcknowledged: process.env.RESIDENCY_ACKNOWLEDGED === 'true' } : {}),
    });
    // Optional head office for this country, created once.
    const ho = { name: process.env.BOOTSTRAP_HEAD_OFFICE_NAME, email: process.env.BOOTSTRAP_HEAD_OFFICE_ADMIN_EMAIL };
    if (ho.name && ho.email) {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      const has = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants WHERE is_head_office')).rows[0]!.n;
      await c.end();
      if (has === 0) {
        const t = await bootstrapTenant(url, { name: ho.name, countryCode: region === 'us' ? 'US' : 'CA', adminEmail: ho.email, headOffice: true });
        console.log(`bootstrapped head office ${t.tenantId}`);
      }
    }
    // Promote an existing company to head office (once): the company whose administrator has this email. Optionally rename it.
    const promote = process.env.PROMOTE_TO_HEAD_OFFICE_EMAIL?.trim().toLowerCase();
    if (promote) {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        const has = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants WHERE is_head_office')).rows[0]!.n;
        const t = (await c.query<{ id: string; root: string }>(
          `SELECT u.tenant_id AS id, n.id AS root FROM app_users u JOIN org_nodes n ON n.tenant_id = u.tenant_id AND n.type = 'tenant' WHERE u.email = $1 LIMIT 1`, [promote])).rows[0];
        if (has === 0 && t) {
          const name = process.env.HEAD_OFFICE_NAME?.trim();
          await c.query('UPDATE tenants SET is_head_office = true WHERE id = $1', [t.id]);
          if (name) { await c.query('UPDATE tenants SET name = $2 WHERE id = $1', [t.id, name]); await c.query('UPDATE org_nodes SET name = $2 WHERE id = $1', [t.root, name]); }
          console.log(`promoted ${t.id} to head office`);
        }
      } finally { await c.end(); }
    }
    // Optional extra company, created once by name (for example the first company under a new head office).
    const co = { name: process.env.BOOTSTRAP_COMPANY_NAME?.trim(), email: process.env.BOOTSTRAP_COMPANY_ADMIN_EMAIL?.trim() };
    if (co.name && co.email) {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      const exists = (await c.query('SELECT 1 FROM tenants WHERE name = $1 UNION ALL SELECT 1 FROM app_users WHERE email = lower($2)', [co.name, co.email])).rowCount;
      await c.end();
      if (!exists) {
        const t = await bootstrapTenant(url, { name: co.name, countryCode: region === 'us' ? 'US' : 'CA', adminEmail: co.email });
        console.log(`bootstrapped company ${t.tenantId}`);
      }
    }
    // Optional first-tenant bootstrap from the environment, only while the database has no tenants.
    const bt = { name: process.env.BOOTSTRAP_TENANT_NAME, country: process.env.BOOTSTRAP_TENANT_COUNTRY, email: process.env.BOOTSTRAP_ADMIN_EMAIL };
    if (bt.name && bt.email && (bt.country === 'CA' || bt.country === 'US')) {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      const n = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM tenants WHERE NOT is_head_office OR EXISTS (SELECT 1 FROM app_users WHERE email = lower($1))`, [bt.email])).rows[0]!.n;
      await c.end();
      if (n === 0) {
        const t = await bootstrapTenant(url, { name: bt.name, countryCode: bt.country, adminEmail: bt.email, defaultLocale: (process.env.BOOTSTRAP_TENANT_LOCALE as 'en' | 'fr-CA') ?? 'en' });
        console.log(`bootstrapped first tenant ${t.tenantId}`);
      }
    }
    if (process.env.SEED_STARTER_PIPELINE === 'true') {
      const n = await seedStarterPipelines(url);
      if (n > 0) console.log(`seeded starter pipeline for ${n} tenant(s)`);
    }
    if (process.env.SEED_DEMO === 'true') {
      // The demo is optional: a refusal (for example an unverified region) must never stop a release.
      const d = await seedDemoTenant(url, { adminEmail: process.env.DEMO_ADMIN_EMAIL, reset: process.env.DEMO_RESET === 'true' }).catch((e: Error) => { console.error(`demo tenant skipped: ${e.message}`); return null; });
      if (d) console.log(d.created ? `seeded demo tenant ${d.tenantId}: ${JSON.stringify(d.counts)}` : d.counts && Object.keys(d.counts).length ? `reset demo tenant ${d.tenantId}: ${JSON.stringify(d.counts)}` : 'demo tenant already present');
    }
    console.log(`release ok: ${region}/${environment}; applied ${r.applied.length}, existing ${r.skipped.length}`);
  } else if (cmd === 'bootstrap-deployment') {
    const region = flag('region') as 'ca-qc' | 'us' | undefined;
    const environment = (flag('environment') ?? 'dev') as 'dev' | 'staging' | 'prod';
    if (region !== 'ca-qc' && region !== 'us') throw new Error('--region ca-qc|us is required');
    const hostedIn = flag('hosted-in') as 'ca' | 'us' | undefined;
    await bootstrapDeployment(url, { region, environment, physicalRegionVerified: args.includes('--verified'), ...(hostedIn ? { hostedIn, residencyAcknowledged: args.includes('--acknowledge') } : {}) });
    console.log(`deployment set: ${region} / ${environment}`);
  } else if (cmd === 'seed-demo') {
    const d = await seedDemoTenant(url, { adminEmail: flag('admin-email'), reset: args.includes('--reset') });
    console.log(JSON.stringify(d, null, 2));
  } else if (cmd === 'create-tenant') {
    const name = flag('name');
    const country = flag('country') as 'CA' | 'US' | undefined;
    const adminEmail = flag('admin-email');
    if (!name || !adminEmail || (country !== 'CA' && country !== 'US')) {
      throw new Error('usage: create-tenant --name "<company>" --country CA|US --admin-email <email> [--admin-name <name>] [--locale en|fr-CA] [--head-office]');
    }
    const t = await bootstrapTenant(url, { name, countryCode: country, adminEmail, adminName: flag('admin-name'), defaultLocale: (flag('locale') as 'en' | 'fr-CA') ?? 'en', headOffice: args.includes('--head-office') });
    console.log(JSON.stringify(t, null, 2));
  } else {
    console.error('commands: migrate | seed-demo [--admin-email <email>] [--reset] | bootstrap-deployment --region ca-qc|us [--environment dev|staging|prod] [--verified] [--hosted-in ca|us --acknowledge] | create-tenant ...');
    process.exit(2);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
