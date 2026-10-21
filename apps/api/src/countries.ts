// The two country servers (Canada, United States) and the Chrome Web Store copy of the extension.
// Each server knows only its own users; these helpers just name the other server's address so a person can be sent there.

export type CountryId = 'ca' | 'us';
export const countryOf = (region: string): CountryId => (region === 'us' ? 'us' : 'ca');
export const COUNTRY_NAME: Record<CountryId, { en: string; 'fr-CA': string }> = {
  ca: { en: 'Canada', 'fr-CA': 'Canada' },
  us: { en: 'United States', 'fr-CA': 'États-Unis' },
};

const DEFAULT_ORIGIN: Record<CountryId, string> = { ca: 'https://ca.punjabinsurance.co', us: 'https://us.punjabinsurance.co' };
const envOrigin = (c: CountryId) => (c === 'ca' ? process.env.PII_ORIGIN_CA : process.env.PII_ORIGIN_US)?.trim().replace(/\/+$/, '') || null;

/** The other country's server, or null when this server is not one of the ca./us. pair (tests, local runs). */
export function otherOrigin(appOrigin: string, region: string): string | null {
  const other: CountryId = countryOf(region) === 'ca' ? 'us' : 'ca';
  const fromEnv = envOrigin(other);
  if (fromEnv) return fromEnv;
  const m = /^(https?:\/\/)(ca|us)\.([^/]+)$/.exec(appOrigin.replace(/\/+$/, ''));
  return m ? `${m[1]}${other}.${m[3]}` : null;
}

/** A country's server for links from the neutral home page. */
export function countryOrigin(c: CountryId): string {
  return envOrigin(c) ?? DEFAULT_ORIGIN[c];
}

/** The Chrome Web Store listing (PII_EXTENSION_URL), when it is set to an https address. */
export function storeUrl(): string | null {
  const u = process.env.PII_EXTENSION_URL?.trim();
  return u && /^https:\/\/\S+$/.test(u) ? u : null;
}

/** The store copy's extension ID, read from the listing address (…/detail/<name>/<id> or …/detail/<id>). */
export function storeExtensionId(): string | null {
  const m = /\/([a-p]{32})(?:[/?#]|$)/.exec(storeUrl() ?? '');
  return m ? m[1]! : null;
}

/** Where a sign-in may return to: only PII's own pages on this server, never another site. */
export function safeNext(n: unknown): string | null {
  if (typeof n !== 'string' || n.length > 200) return null;
  if (!/^\/(app|install|guide)(?:[/?#]|$)/.test(n)) return null;
  if (/[\\\s]/.test(n) || n.includes('//')) return null;
  return n;
}
