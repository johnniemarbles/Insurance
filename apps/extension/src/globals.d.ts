declare const __API_BASE__: string;
/** Deployments the extension can talk to, by country id (for example { ca: 'https://…', us: 'https://…' }). Empty: just __API_BASE__. */
declare const __REGIONS__: Record<string, string>;
declare const __INBOXSDK_APP_ID__: string;
/** True in development builds (PII_DEV_BUILD=1): only they honour a typed server address in Options. */
declare const __DEV_BUILD__: boolean;
