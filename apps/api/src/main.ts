import { loadConfig } from '@pii/platform';
import { keysFromEnv } from './kms.ts';
import { assertDeployment, createPool } from '@pii/db';
import { buildApp } from './app.ts';
import { resendMailer } from './mailer.ts';
import { s3Vault } from './vault.ts';
import { devAuthenticator, firstOf, sessionAuthenticator } from './auth.ts';
import { fakeGoogleClient, realGoogleClient } from './google.ts';
import { aiFromEnv, aiProvidersFromEnv } from './ai.ts';
import { fakeStripeIdentity, stripeIdentityClient } from './eid.ts';
import { startBackgroundJobs } from './background.ts';

const config = loadConfig();
const appPool = createPool(config.appDatabaseUrl);
const authPool = createPool(config.authDatabaseUrl, 5);

// Refuse to start against a database that belongs to a different region.
await assertDeployment(appPool, config.region);

// The stand-in Google never runs on a real (https) address, whatever the variables say.
const google = process.env.GOOGLE_FAKE === '1' && config.appEnv === 'dev' && !config.appOrigin.startsWith('https://') ? fakeGoogleClient(config.appOrigin) : config.googleClientId ? realGoogleClient(config) : undefined;
if (!google && !config.devAuth) {
  // Safe state: the API runs, but nobody can sign in until Google sign-in is configured.
  console.warn('Google sign-in is not configured: every authenticated route will answer 401.');
}
const authenticate = config.devAuth ? firstOf(sessionAuthenticator(authPool), devAuthenticator(authPool)) : sessionAuthenticator(authPool);
// Field-encryption keys: AWS KMS when KMS_WRAPPED_DATA_KEY is set (older data still opens with LOCAL_KEY_SECRET), else the local key.
const keys = await keysFromEnv(config);
if (!keys) console.warn('No encryption keys configured: linking email conversations is disabled.');
const ai = aiFromEnv();
const aiProviders = aiProvidersFromEnv();
// Electronic ID: a restricted Stripe key with Identity permissions; the stand-in only for local runs (APP_ENV=dev).
const stripeIdentity = process.env.STRIPE_IDENTITY_FAKE === '1' && config.appEnv === 'dev' ? fakeStripeIdentity(config.appOrigin)
  : process.env.STRIPE_IDENTITY_SECRET_KEY ? stripeIdentityClient(process.env.STRIPE_IDENTITY_SECRET_KEY) : undefined;
const mailer = resendMailer(config);
if (!mailer) console.warn('RESEND_API_KEY is not set: reminders stay in the app and are not emailed.');
const vault = s3Vault();
if (!vault) console.warn('VAULT_S3_BUCKET / VAULT_S3_REGION are not set: signed paperwork is kept in the database only.');
const app = buildApp({ config, appPool, authPool, authenticate, google, keys, ai, aiProviders, stripeIdentity, mailer, vault });
await app.listen({ port: config.port, host: '0.0.0.0' });
startBackgroundJobs({ config, appPool, authPool, authenticate, google, keys, mailer, vault });
