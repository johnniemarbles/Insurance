// Country switcher for the head office (global overview). Canada and the USA are two apps with two databases. The link to the other
// country's app is configuration only: nothing about either country is read across the border.
import type { RegionCode } from '@pii/platform';

export interface CountrySwitch { toCountry: 'CA' | 'US'; url: string }

export function countrySwitchFor(region: RegionCode, otherUrl: string | undefined): CountrySwitch | null {
  if (!otherUrl) return null;
  let parsed: URL;
  try { parsed = new URL(otherUrl); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return region === 'us' ? { toCountry: 'CA', url: parsed.origin } : { toCountry: 'US', url: parsed.origin };
}
