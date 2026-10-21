// File review sampling (roadmap Phase 3, feature 10): the risk score, the checklist and the sample draw. No database.
export const fileReviewsEnabled = (): boolean => ['1', 'true'].includes(String(process.env.FILE_REVIEWS_ENABLED ?? '').toLowerCase());

export interface DealRiskFacts {
  replacing: boolean; amount: number | null; adviceFlags: number; openHits: number; cashReports: number;
  newAdvisor: boolean; pastFindings: number; idVerified: boolean; privacyConsent: boolean;
}
const WEIGHTS: [keyof DealRiskFacts | 'large_amount', number][] = [
  ['openHits', 25], ['replacing', 20], ['large_amount', 15], ['cashReports', 15], ['newAdvisor', 15], ['pastFindings', 15], ['idVerified', 10], ['privacyConsent', 10],
];

/** 0 to 100, with the reasons, from facts PII already holds. Each reason is a short code the screen labels. */
export function riskScore(f: DealRiskFacts, largeAmount = 1_000_000): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (code: string, w: number) => { reasons.push(code); score += w; };
  for (const [k, w] of WEIGHTS) {
    if (k === 'large_amount') { if (f.amount != null && f.amount >= largeAmount) add('large_amount', w); continue; }
    if (k === 'idVerified') { if (!f.idVerified) add('no_id', w); continue; }
    if (k === 'privacyConsent') { if (!f.privacyConsent) add('no_privacy_consent', w); continue; }
    const v = f[k];
    if (v === true || (typeof v === 'number' && v > 0)) add(k === 'openHits' ? 'screening_hit' : k === 'replacing' ? 'replacement' : k === 'cashReports' ? 'cash' : k === 'newAdvisor' ? 'new_advisor' : 'past_findings', w);
  }
  if (f.adviceFlags > 0) add('advice_flags', Math.min(30, f.adviceFlags * 10));
  return { score: Math.min(100, score), reasons };
}

/** The checklist. "auto" items PII can suggest from the file; the reviewer confirms or changes every answer. */
export const CHECKLIST = [
  { key: 'id_on_file', auto: true }, { key: 'privacy_consent', auto: true }, { key: 'needs_analysis_current', auto: true },
  { key: 'recommendation_linked', auto: true }, { key: 'replacement_disclosure', auto: true }, { key: 'suitability_decided', auto: true },
  { key: 'screening_clear', auto: true }, { key: 'meeting_notes', auto: true },
  { key: 'advice_explained', auto: false }, { key: 'documents_legible', auto: false }, { key: 'client_communications', auto: false },
] as const;
export type Answer = 'yes' | 'no' | 'na';
export const CHECK_KEYS: readonly string[] = CHECKLIST.map((c) => c.key);

/** Keep only known items with known answers. */
export function cleanChecklist(raw: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (CHECK_KEYS.includes(k) && (v === 'yes' || v === 'no' || v === 'na')) out[k] = v;
  return out;
}

/**
 * The month's sample for one officer: up to half (rounded up) from the riskiest deals scoring 20 or more, the rest at
 * random from what is left. `rand` is injectable for tests.
 */
export function drawSample<T extends { id: string; score: number }>(candidates: T[], size: number, rand: () => number = Math.random): { pick: T; reason: 'risk' | 'random' }[] {
  if (size <= 0 || !candidates.length) return [];
  const byRisk = [...candidates].filter((c) => c.score >= 20).sort((a, b) => b.score - a.score);
  const risky = byRisk.slice(0, Math.ceil(size / 2));
  const chosen = new Set(risky.map((c) => c.id));
  const rest = candidates.filter((c) => !chosen.has(c.id));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j]!, rest[i]!]; }
  return [...risky.map((pick) => ({ pick, reason: 'risk' as const })), ...rest.slice(0, size - risky.length).map((pick) => ({ pick, reason: 'random' as const }))];
}

export const period = (d = new Date()) => d.toISOString().slice(0, 7);
