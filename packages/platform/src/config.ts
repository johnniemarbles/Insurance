export type AppEnv = 'dev' | 'test' | 'staging' | 'prod';
export type RegionCode = 'ca-qc' | 'us';

export interface Config {
  appEnv: AppEnv;
  region: RegionCode;
  productName: string;
  /** Shown to people and in notices, e.g. "PII by Punjab Insurance". */
  productDisplayName: string;
  appOrigin: string;
  /** The same product for the other country (its own app and database), linked from the head office. Optional. */
  otherRegionUrl?: string;
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
  supportEmail: string;
  supportUrl: string;
  termsUrl: string;
  /** Country of the servers that hold the data, stated to people in the notices. */
  dataCountry: 'US' | 'CA';
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
  // Safety rails: the header-trusting dev sign-in must never reach production or staging.
  // LOCAL_KEYS (keys derived from LOCAL_KEY_SECRET) is allowed there until a cloud KMS is plugged in, but needs a strong secret.
  if ((appEnv === 'prod' || appEnv === 'staging') && devAuth) {
    throw new Error('DEV_AUTH is not allowed when APP_ENV is staging or prod');
  }
  if ((appEnv === 'prod' || appEnv === 'staging') && localKeys && (env.LOCAL_KEY_SECRET ?? '').length < 32) {
    throw new Error('LOCAL_KEY_SECRET must be 32+ characters when APP_ENV is staging or prod');
  }
  if (localKeys && (env.LOCAL_KEY_SECRET ?? '').length < 16) throw new Error('LOCAL_KEY_SECRET (16+ characters) is required with LOCAL_KEYS');
  const googleClientId = env.GOOGLE_CLIENT_ID || undefined;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || undefined;
  const cookieSecret = env.COOKIE_SECRET || undefined;
  if (googleClientId && (!googleClientSecret || !cookieSecret || cookieSecret.length < 32)) {
    throw new Error('GOOGLE_CLIENT_SECRET and a COOKIE_SECRET of at least 32 characters are required with GOOGLE_CLIENT_ID');
  }
  const appOrigin = env.APP_ORIGIN ?? 'https://app.punjabinsurance.co';
  // Privacy and support live on the country's own website: .ca for Canada, .com for the USA.
  const site = region === 'us' ? 'punjabinsurance.com' : 'punjabinsurance.ca';
  // Residency country follows the deployment region. An explicit DATA_COUNTRY may only match the region
  // (staging/prod refuse a mismatch so notices cannot claim the wrong country).
  const dataCountryFromRegion: 'US' | 'CA' = region === 'us' ? 'US' : 'CA';
  let dataCountry = dataCountryFromRegion;
  if (env.DATA_COUNTRY === 'CA' || env.DATA_COUNTRY === 'US') {
    dataCountry = env.DATA_COUNTRY;
    if (dataCountry !== dataCountryFromRegion && (appEnv === 'prod' || appEnv === 'staging')) {
      throw new Error(`DATA_COUNTRY=${dataCountry} conflicts with REGION=${region} (expected ${dataCountryFromRegion})`);
    }
  }
  return {
    extensionOrigins: (env.EXTENSION_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    googleClientId,
    googleClientSecret,
    cookieSecret,
    privacyEmail: env.PRIVACY_EMAIL ?? 'privacy-officer@punjabinsurance.com',
    policyUrl: env.POLICY_URL ?? `https://${site}/privacy`,
    supportEmail: env.SUPPORT_EMAIL ?? 'support.crm@punjabinsurance.com',
    supportUrl: env.SUPPORT_URL ?? `https://${site}/support`,
    termsUrl: env.TERMS_URL ?? `https://${site}/terms`,
    dataCountry,
    appEnv,
    region,
    productName: env.PRODUCT_NAME ?? 'PII',
    productDisplayName: env.PRODUCT_DISPLAY_NAME ?? 'PII by Punjab Insurance',
    appOrigin,
    otherRegionUrl: env.OTHER_REGION_URL || undefined,
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
