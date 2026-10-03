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
  currentKeyId: string;
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
  return {
    appEnv,
    region,
    productName: env.PRODUCT_NAME ?? 'PII',
    productDisplayName: env.PRODUCT_DISPLAY_NAME ?? 'PII by Punjab Insurance',
    appOrigin: env.APP_ORIGIN ?? 'https://app.punjabinsurance.net',
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: req(env, 'DATABASE_URL'),
    appDatabaseUrl: req(env, 'APP_DATABASE_URL'),
    authDatabaseUrl: req(env, 'AUTH_DATABASE_URL'),
    devAuth,
    localKeys,
    currentKeyId: env.CURRENT_KEY_ID ?? 'local-1',
  };
}
