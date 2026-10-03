import { bootstrapDeployment, bootstrapTenant, migrate } from './index.ts';

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
  } else if (cmd === 'bootstrap-deployment') {
    const region = flag('region') as 'ca-qc' | 'us' | undefined;
    const environment = (flag('environment') ?? 'dev') as 'dev' | 'staging' | 'prod';
    if (region !== 'ca-qc' && region !== 'us') throw new Error('--region ca-qc|us is required');
    await bootstrapDeployment(url, { region, environment, physicalRegionVerified: args.includes('--verified') });
    console.log(`deployment set: ${region} / ${environment}`);
  } else if (cmd === 'create-tenant') {
    const name = flag('name');
    const country = flag('country') as 'CA' | 'US' | undefined;
    const adminEmail = flag('admin-email');
    if (!name || !adminEmail || (country !== 'CA' && country !== 'US')) {
      throw new Error('usage: create-tenant --name "<company>" --country CA|US --admin-email <email> [--admin-name <name>] [--locale en|fr-CA]');
    }
    const t = await bootstrapTenant(url, { name, countryCode: country, adminEmail, adminName: flag('admin-name'), defaultLocale: (flag('locale') as 'en' | 'fr-CA') ?? 'en' });
    console.log(JSON.stringify(t, null, 2));
  } else {
    console.error('commands: migrate | bootstrap-deployment --region ca-qc|us [--environment dev|staging|prod] [--verified] | create-tenant ...');
    process.exit(2);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
