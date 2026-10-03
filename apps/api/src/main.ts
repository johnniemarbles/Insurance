import { loadConfig } from '@pii/platform';
import { assertDeployment, createPool } from '@pii/db';
import { buildApp } from './app.ts';
import { devAuthenticator, firstOf, sessionAuthenticator } from './auth.ts';
import { realGoogleClient } from './google.ts';

const config = loadConfig();
const appPool = createPool(config.appDatabaseUrl);
const authPool = createPool(config.authDatabaseUrl, 5);

// Refuse to start against a database that belongs to a different region.
await assertDeployment(appPool, config.region);

const google = config.googleClientId ? realGoogleClient(config) : undefined;
if (!google && !config.devAuth) {
  throw new Error('Configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / COOKIE_SECRET, or set DEV_AUTH=true in dev only.');
}
const authenticate = config.devAuth ? firstOf(sessionAuthenticator(authPool), devAuthenticator(authPool)) : sessionAuthenticator(authPool);
const app = buildApp({ config, appPool, authPool, authenticate, google });
await app.listen({ port: config.port, host: '0.0.0.0' });
