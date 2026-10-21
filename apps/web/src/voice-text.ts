// Read aloud helpers, kept apart from the components so they can be tested on their own.
import type { Locale } from './types.ts';

export interface VoiceLike { lang: string; localService: boolean }

/** Text as it should sound: references like [C3] and markdown marks removed. */
export const speakable = (s: string) => s.replace(/\[(?:[A-Z]{1,2}\d+|TO CONFIRM:[^\]]*)\]/g, '').replace(/[*_#`>]+/g, '').replace(/[ \t]+/g, ' ').replace(/ +([.,;:!?])/g, '$1').trim();

/** A voice that runs on this device, in the person's language; Chrome's online voices are skipped so no text leaves it. */
export function localVoice<T extends VoiceLike>(voices: readonly T[], locale: Locale): T | null {
  const want = locale === 'fr-CA' ? ['fr-ca', 'fr'] : ['en-ca', 'en-us', 'en-gb', 'en'];
  const local = voices.filter((v) => v.localService);
  for (const w of want) { const v = local.find((x) => x.lang.toLowerCase().replace('_', '-').startsWith(w)); if (v) return v; }
  return null;
}

