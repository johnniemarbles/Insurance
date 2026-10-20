// Families, Gate D: pure helpers for the family import (CSV reading and row checks), family email tokens, and the
// extension version check for the left-panel item. No database access, so each can be tested on its own.

/** RFC 4180 CSV: commas, double quotes (with "" inside), CR/LF line ends. Returns rows of cells, without empty rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, i = 0;
  const s = text.replace(/^﻿/, '');
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === ',') { endCell(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (quoted) throw new Error('A quoted value is not closed');
  if (cell !== '' || row.length) endRow();
  return rows;
}

export const IMPORT_COLUMNS = ['family', 'family_id', 'role', 'client_id', 'full_name', 'email', 'phone', 'date_of_birth', 'preferred_language', 'same_name_ok'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
const ALIASES: Record<string, ImportColumn> = {
  family: 'family', family_name: 'family', household: 'family', family_id: 'family_id', role: 'role', family_role: 'role',
  client_id: 'client_id', contact_id: 'client_id', name: 'full_name', full_name: 'full_name', email: 'email', e_mail: 'email', email_address: 'email',
  phone: 'phone', date_of_birth: 'date_of_birth', dob: 'date_of_birth', birth_date: 'date_of_birth', preferred_language: 'preferred_language', language: 'preferred_language',
  same_name_ok: 'same_name_ok',
};
export const ROLE_WORDS: Record<string, string> = {
  head: 'head', spouse: 'spouse_partner', partner: 'spouse_partner', spouse_partner: 'spouse_partner', 'spouse or partner': 'spouse_partner',
  child: 'child', dependent: 'dependent', dependant: 'dependent', other: 'other',
};

/** Map a header row to known columns. Unknown columns are reported, never guessed. */
export function mapHeader(header: string[]): { columns: (ImportColumn | null)[]; unknown: string[]; missing: string[] } {
  const columns = header.map((h) => ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null);
  const unknown = header.filter((_, i) => columns[i] === null).map((h) => h.trim()).filter(Boolean);
  const missing: string[] = [];
  if (!columns.includes('role')) missing.push('role');
  if (!columns.includes('family') && !columns.includes('family_id')) missing.push('family or family_id');
  if (!columns.includes('full_name') && !columns.includes('email') && !columns.includes('client_id')) missing.push('full_name, email or client_id');
  return { columns, unknown, missing };
}

export type ImportRow = Partial<Record<ImportColumn, string>> & { line: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The checks one row can pass or fail by itself. Checks that need the database come later. */
export function checkRow(r: ImportRow, today: string): { errors: string[]; role: string | null } {
  const errors: string[] = [];
  const role = ROLE_WORDS[(r.role ?? '').trim().toLowerCase()] ?? null;
  if (!role) errors.push(`Role "${r.role ?? ''}" is not one of: head, spouse or partner, child, dependent, other`);
  if (!r.family?.trim() && !r.family_id?.trim()) errors.push('Give a family name (to create one) or a family_id (to add to one)');
  if (r.family_id && !UUID.test(r.family_id.trim())) errors.push('family_id is not a valid id');
  if (r.client_id && !UUID.test(r.client_id.trim())) errors.push('client_id is not a valid id');
  if (!r.client_id?.trim() && !r.full_name?.trim() && !r.email?.trim()) errors.push('Give a full_name or email for a new client, or a client_id for an existing one');
  if (r.email?.trim() && !EMAIL.test(r.email.trim())) errors.push(`"${r.email}" is not an email address`);
  if (r.full_name && r.full_name.trim().length > 200) errors.push('full_name is longer than 200 characters');
  if (r.phone && r.phone.trim().length > 40) errors.push('phone is longer than 40 characters');
  if (r.date_of_birth?.trim()) {
    const d = r.date_of_birth.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) errors.push(`date_of_birth "${d}" is not a date (use YYYY-MM-DD)`);
    else if (d > today) errors.push('date_of_birth is in the future');
    else if (d < '1900-01-01') errors.push('date_of_birth is before 1900');
  }
  if (r.preferred_language && (r.preferred_language.trim().length < 2 || r.preferred_language.trim().length > 20)) errors.push('preferred_language should be 2 to 20 characters');
  if (r.same_name_ok && !['yes', 'no', ''].includes(r.same_name_ok.trim().toLowerCase())) errors.push('same_name_ok should be yes or no');
  return { errors, role };
}

/** Tokens a family email may use, besides the usual ones. Each is a fact cleared for the one person receiving it. */
export const FAMILY_TOKENS = ['familyName', 'salutation', 'myPolicies', 'nextRenewal'] as const;

/** Whether the extension that asked is at least `min` (x.y.z). Unknown or malformed versions are treated as older. */
export function versionAtLeast(v: string | undefined, min: string): boolean {
  if (!v || !/^\d+\.\d+\.\d+$/.test(v)) return false;
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i]! > b[i]!) return true; if (a[i]! < b[i]!) return false; }
  return true;
}
export const FAMILIES_NAV_MIN_EXTENSION = '1.6.0';

/** Words compared for a surname suggestion: the last word of a name, lower case, letters only. */
export const surnameOf = (name: string | null | undefined): string | null => {
  const w = (name ?? '').trim().split(/\s+/).pop()?.toLowerCase().replace(/[^\p{L}'-]/gu, '') ?? '';
  return w.length >= 2 ? w : null;
};
