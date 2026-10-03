import { loadConfig } from '@pii/platform';
import { assertDeployment, createPool } from '@pii/db';
import { buildApp } from './app.ts';
import { devAuthenticator } from './auth.ts';

const config = loadConfig();
const appPool = createPool(config.appDatabaseUrl);
const authPool = createPool(config.authDatabaseUrl, 3);

// Refuse to start against a database that belongs to a different region.
await assertDeployment(appPool, config.region);

if (!config.devAuth) {
  throw new Error('Google sign-in is not built yet (ticket 1.1). Set DEV_AUTH=true in dev/test only.');
}
const app = buildApp({ config, appPool, authenticate: devAuthenticator(authPool) });
await app.listen({ port: config.port, host: '0.0.0.0' });
