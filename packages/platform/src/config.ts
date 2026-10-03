export type AppEnv = 'dev' | 'test' | 'staging' | 'prod';
export type RegionCode = 'ca-qc' | 'us';

export interface Config {
  appEnv: AppEnv;
  region: RegionCode;
  productName: string;
  /** Shown to people and in notices, e.g. "PII by Punjab Insurance". */
  productDisplayName: string;
  appOrigin: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  appDatabaseUrl: string;
  authDatabaseUrl: string;
  devAuth: boolean;
  localKeys: boolean;
  localKeySecret?: string;
  currentKeyId: string;
  googleClientId?: string;
  googleClientSecret?: string;
  cookieSecret?: string;
  privacyEmail: string;
  /** Extra origins allowed to make cookie-authenticated writes, e.g. chrome-extension://<id>. */
  extensionOrigins: string[];
  policyUrl: string;
}

function req(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const appEnv = (env.APP_ENV ?? 'dev') as AppEnv;
  if (!['dev', 'test', 'staging', 'prod'].includes(appEnv)) throw new Error(`Invalid APP_ENV ${appEnv}`);
  const region = req(env, 'REGION') as RegionCode;
  if (region !== 'ca-qc' && region !== 'us') throw new Error(`Invalid REGION ${region}`);
  const devAuth = env.DEV_AUTH === 'true';
  const localKeys = env.LOCAL_KEYS === 'true';
  // Safety rails: development shortcuts must never reach production or staging.
  if ((appEnv === 'prod' || appEnv === 'staging') && (devAuth || localKeys)) {
    throw new Error('DEV_AUTH and LOCAL_KEYS are not allowed when APP_ENV is staging or prod');
  }
  if (localKeys && (env.LOCAL_KEY_SECRET ?? '').length < 16) throw new Error('LOCAL_KEY_SECRET (16+ characters) is required with LOCAL_KEYS');
  const googleClientId = env.GOOGLE_CLIENT_ID || undefined;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || undefined;
  const cookieSecret = env.COOKIE_SECRET || undefined;
  if (googleClientId && (!googleClientSecret || !cookieSecret || cookieSecret.length < 32)) {
    throw new Error('GOOGLE_CLIENT_SECRET and a COOKIE_SECRET of at least 32 characters are required with GOOGLE_CLIENT_ID');
  }
  const appOrigin = env.APP_ORIGIN ?? 'https://app.punjabinsurance.net';
  return {
    extensionOrigins: (env.EXTENSION_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    googleClientId,
    googleClientSecret,
    cookieSecret,
    privacyEmail: env.PRIVACY_EMAIL ?? 'privacy-officer@punjabinsurance.com',
    policyUrl: env.POLICY_URL ?? `${appOrigin}/privacy`,
    appEnv,
    region,
    productName: env.PRODUCT_NAME ?? 'PII',
    productDisplayName: env.PRODUCT_DISPLAY_NAME ?? 'PII by Punjab Insurance',
    appOrigin,
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: req(env, 'DATABASE_URL'),
    appDatabaseUrl: req(env, 'APP_DATABASE_URL'),
    authDatabaseUrl: req(env, 'AUTH_DATABASE_URL'),
    devAuth,
    localKeys,
    localKeySecret: env.LOCAL_KEY_SECRET || undefined,
    currentKeyId: env.CURRENT_KEY_ID ?? 'local-1',
  };
}
