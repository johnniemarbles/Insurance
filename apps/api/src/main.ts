import { loadConfig, localKeyProvider } from '@pii/platform';
import { assertDeployment, createPool } from '@pii/db';
import { buildApp } from './app.ts';
import { devAuthenticator, firstOf, sessionAuthenticator } from './auth.ts';
import { realGoogleClient } from './google.ts';
import { startBackgroundJobs } from './background.ts';

const config = loadConfig();
const appPool = createPool(config.appDatabaseUrl);
const authPool = createPool(config.authDatabaseUrl, 5);

// Refuse to start against a database that belongs to a different region.
await assertDeployment(appPool, config.region);

const google = config.googleClientId ? realGoogleClient(config) : undefined;
if (!google && !config.devAuth) {
  // Safe state: the API runs, but nobody can sign in until Google sign-in is configured.
  console.warn('Google sign-in is not configured: every authenticated route will answer 401.');
}
const authenticate = config.devAuth ? firstOf(sessionAuthenticator(authPool), devAuthenticator(authPool)) : sessionAuthenticator(authPool);
const keys = config.localKeys && config.localKeySecret ? localKeyProvider(config.localKeySecret, config.currentKeyId) : undefined;
if (!keys) console.warn('No encryption keys configured: linking email conversations is disabled.');
const app = buildApp({ config, appPool, authPool, authenticate, google, keys });
await app.listen({ port: config.port, host: '0.0.0.0' });
startBackgroundJobs({ config, appPool, authPool, authenticate, google, keys });
