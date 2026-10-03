// Custom fields on boxes and contacts (PRD 6): defined per pipeline, validated here before saving.

export const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox', 'currency'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  type: FieldType;
  required: boolean;
  options?: string[] | null;
}

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value: Record<string, unknown>;
}

/** Checks values against the pipeline's field definitions. Unknown keys are rejected; null/'' clears a field. */
export function validateCustomValues(defs: FieldDef[], input: Record<string, unknown>, opts: { partial?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  const value: Record<string, unknown> = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [key, raw] of Object.entries(input)) {
    const d = byKey.get(key);
    if (!d) {
      errors.push(`Unknown field "${key}"`);
      continue;
    }
    if (raw === null || raw === '') {
      if (d.required) errors.push(`"${key}" is required`);
      continue;
    }
    switch (d.type) {
      case 'text':
        if (typeof raw !== 'string' || raw.length > 2000) errors.push(`"${key}" must be text up to 2000 characters`);
        else value[key] = raw;
        break;
      case 'number':
      case 'currency':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`"${key}" must be a number`);
        else value[key] = raw;
        break;
      case 'date':
        if (typeof raw !== 'string' || !isRealDate(raw)) errors.push(`"${key}" must be a date like 2026-10-31`);
        else value[key] = raw;
        break;
      case 'checkbox':
        if (typeof raw !== 'boolean') errors.push(`"${key}" must be true or false`);
        else value[key] = raw;
        break;
      case 'dropdown':
        if (typeof raw !== 'string' || !(d.options ?? []).includes(raw)) errors.push(`"${key}" must be one of: ${(d.options ?? []).join(', ')}`);
        else value[key] = raw;
        break;
    }
  }
  if (!opts.partial) {
    for (const d of defs) {
      if (d.required && value[d.key] === undefined) errors.push(`"${d.key}" is required`);
    }
  }
  return { ok: errors.length === 0, errors, value };
}
