// Client self-intake (roadmap Phase 2, feature 6): the questions, their checking, and the mapping to a draft needs
// analysis. No database. Everything a client types is checked against this list; anything else is dropped.
import { OBJECTIVES } from '@pii/domain';

export const intakeEnabled = (): boolean => ['1', 'true'].includes(String(process.env.INTAKE_ENABLED ?? '').toLowerCase());

export const SECTIONS = ['about', 'situation', 'consents', 'documents', 'id_check'] as const;
export type Section = (typeof SECTIONS)[number];
export const INTAKE_CONSENTS = ['collection_use', 'electronic_comms', 'carrier_sharing'] as const;

type Field =
  | { key: string; type: 'text'; max: number; required?: boolean }
  | { key: string; type: 'date'; required?: boolean }
  | { key: string; type: 'money' }
  | { key: string; type: 'int'; max: number }
  | { key: string; type: 'bool' }
  | { key: string; type: 'choice'; options: readonly string[] }
  | { key: string; type: 'multi'; options: readonly string[] };

export const ABOUT: readonly Field[] = [
  { key: 'legalName', type: 'text', max: 200, required: true }, { key: 'dateOfBirth', type: 'date', required: true },
  { key: 'phone', type: 'text', max: 40 }, { key: 'address', type: 'text', max: 200 }, { key: 'city', type: 'text', max: 100 },
  { key: 'province', type: 'choice', options: ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT', 'other'] },
  { key: 'postalCode', type: 'text', max: 12 }, { key: 'occupation', type: 'text', max: 120 }, { key: 'employer', type: 'text', max: 120 },
  { key: 'preferredLanguage', type: 'choice', options: ['en', 'fr', 'pa', 'hi', 'other'] },
];
export const SITUATION: readonly Field[] = [
  { key: 'maritalStatus', type: 'choice', options: ['single', 'married', 'common_law', 'separated', 'divorced', 'widowed'] },
  { key: 'dependants', type: 'int', max: 20 },
  { key: 'annualIncome', type: 'money' }, { key: 'spouseIncome', type: 'money' }, { key: 'monthlyExpenses', type: 'money' },
  { key: 'liquidAssets', type: 'money' }, { key: 'mortgage', type: 'money' }, { key: 'otherDebts', type: 'money' },
  { key: 'existingIndividual', type: 'money' }, { key: 'existingGroup', type: 'money' }, { key: 'existingPolicies', type: 'text', max: 1000 },
  { key: 'replacing', type: 'bool' }, { key: 'replacingNote', type: 'text', max: 1000 },
  { key: 'objectives', type: 'multi', options: OBJECTIVES }, { key: 'objectivesNote', type: 'text', max: 1000 },
  { key: 'monthlyBudget', type: 'money' },
];

function cleanGroup(fields: readonly Field[], raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = src[f.key];
    if (v === undefined || v === null || v === '') continue;
    switch (f.type) {
      case 'text': if (typeof v === 'string' && v.trim()) out[f.key] = v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, f.max); break;
      case 'date': if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10)) out[f.key] = v; break;
      case 'money': { const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, '')); if (Number.isFinite(n) && n >= 0 && n <= 1e9) out[f.key] = Math.round(n); break; }
      case 'int': { const n = Number(v); if (Number.isInteger(n) && n >= 0 && n <= f.max) out[f.key] = n; break; }
      case 'bool': if (typeof v === 'boolean') out[f.key] = v; break;
      case 'choice': if (typeof v === 'string' && f.options.includes(v)) out[f.key] = v; break;
      case 'multi': if (Array.isArray(v)) { const l = [...new Set(v.filter((x): x is string => typeof x === 'string' && f.options.includes(x)))]; if (l.length) out[f.key] = l; } break;
    }
  }
  return out;
}

/** The client's answers, checked, keeping only the sections they were asked. */
export function cleanIntake(raw: unknown, sections: readonly string[]): { about: Record<string, unknown>; situation?: Record<string, unknown> } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { about: cleanGroup(ABOUT, src.about), ...(sections.includes('situation') ? { situation: cleanGroup(SITUATION, src.situation) } : {}) };
}

/** What still stops the client submitting. */
export function missingForSubmit(a: ReturnType<typeof cleanIntake>, sections: readonly string[], consents: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of ABOUT) if ('required' in f && f.required && a.about[f.key] === undefined) out.push(`about.${f.key}`);
  if (sections.includes('consents') && !consents.includes('collection_use')) out.push('consents.collection_use');
  return out;
}

/** A draft needs analysis from the client's answers. The advisor completes it with the client before it is signed. */
export function needsDraftFrom(a: ReturnType<typeof cleanIntake>): Record<string, unknown> {
  return { productLine: 'life_health', ...(a.situation ?? {}), ...(a.about.occupation ? { occupation: a.about.occupation } : {}) };
}

/** Differences between what the client entered and what the file has, for the fields PII can update on the contact. */
export function contactChanges(a: ReturnType<typeof cleanIntake>, c: { full_name: string | null; phone: string | null; date_of_birth: string | null; preferred_language: string | null }) {
  const out: { field: 'phone' | 'dateOfBirth' | 'preferredLanguage'; from: string | null; to: string }[] = [];
  if (typeof a.about.phone === 'string' && a.about.phone !== c.phone) out.push({ field: 'phone', from: c.phone, to: a.about.phone });
  if (typeof a.about.dateOfBirth === 'string' && a.about.dateOfBirth !== c.date_of_birth) out.push({ field: 'dateOfBirth', from: c.date_of_birth, to: a.about.dateOfBirth });
  const lang = a.about.preferredLanguage === 'fr' ? 'fr-CA' : a.about.preferredLanguage === 'en' ? 'en' : null;
  if (lang && lang !== c.preferred_language) out.push({ field: 'preferredLanguage', from: c.preferred_language, to: lang });
  return out;
}
