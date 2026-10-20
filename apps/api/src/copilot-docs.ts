// Co-pilot step 2: reading uploaded rulebook documents into passages, building the rulebook search, and the pieces
// letter drafts are made from. Pure helpers (no database), so each can be tested on its own.
import { unzipSync, strFromU8 } from 'fflate';

export const RULEBOOK_MIMES: Record<string, 'pdf' | 'docx' | 'text'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text', 'text/markdown': 'text',
};

/** The text of a PDF, a Word (.docx) file or a plain-text / Markdown file. Scanned PDFs without text return ''. */
export async function documentText(kind: 'pdf' | 'docx' | 'text', data: Buffer): Promise<string> {
  if (kind === 'text') return data.toString('utf8').replace(/^﻿/, '');
  if (kind === 'docx') {
    let xml: string;
    try { xml = strFromU8(unzipSync(new Uint8Array(data), { filter: (f) => f.name === 'word/document.xml' })['word/document.xml']!); }
    catch { throw new Error('That Word file could not be opened'); }
    // A heading paragraph (style Heading1..9 or Title) becomes a Markdown heading so passages keep their section names.
    return xml.split(/<w:p[ >]/).slice(1).map((p) => {
      const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? m[1] : m[0] === '<w:tab/>' ? '\t' : '\n')).join('');
      const decoded = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      return /<w:pStyle w:val="(Heading\d|Title)"/.test(p) && decoded.trim() ? `# ${decoded.trim()}` : decoded;
    }).join('\n');
  }
  const { extractText } = await import('unpdf');
  const r = await extractText(new Uint8Array(data), { mergePages: false });
  return (r.text as string[]).join('\n\n');
}

export interface Passage { ord: number; heading: string | null; body: string }
const HEADING = /^(#{1,6}\s+.+|(?:section|part|chapter|article|policy|schedule|appendix)\s+[\w.]+.*|\d+(?:\.\d+){0,3}[.)]?\s+[A-Z][^.]{2,120})$/i;

/**
 * Split a document into passages of about 600 to 1,800 characters, each under the nearest heading above it. Blank
 * lines separate paragraphs; a heading starts a new passage; a very long paragraph is cut at sentence ends.
 */
export function splitPassages(text: string, max = 1800): Passage[] {
  const out: Passage[] = [];
  let heading: string | null = null, buf = '';
  const flush = () => { const b = buf.trim(); if (b) out.push({ ord: out.length + 1, heading, body: b }); buf = ''; };
  const paras = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').split(/\n{2,}/);
  for (const raw of paras) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // A one-line paragraph that looks like a heading starts a new passage under that name.
    if (lines.length === 1 && lines[0]!.length <= 160 && HEADING.test(lines[0]!)) { flush(); heading = lines[0]!.replace(/^#+\s*/, '').slice(0, 300); continue; }
    // A heading on the first line of a paragraph (common in PDFs).
    if (lines.length > 1 && lines[0]!.length <= 120 && HEADING.test(lines[0]!)) { flush(); heading = lines.shift()!.replace(/^#+\s*/, '').slice(0, 300); }
    let p = lines.join(' ');
    while (p.length > max) {
      const cutAt = Math.max(p.lastIndexOf('. ', max), p.lastIndexOf('; ', max), max * 0.6);
      if (buf) flush();
      buf = p.slice(0, cutAt + 1); flush();
      p = p.slice(cutAt + 1).trim();
    }
    if (buf.length + p.length + 2 > max) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return out;
}

/** A Postgres 'simple' tsquery matching any of the search words (prefix match), or null when there are none. */
export function orQuery(terms: string[]): string | null {
  const clean = terms.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= 3);
  return clean.length ? [...new Set(clean)].map((t) => `${t}:*`).join(' | ') : null;
}

/** The references an answer cited, in order, keeping only those that exist (R1, A2, …). */
export function cited<T extends { ref: string }>(answer: string, items: T[], prefix: string): T[] {
  const by = new Map(items.map((s) => [s.ref, s]));
  const out: T[] = [];
  for (const m of answer.matchAll(new RegExp(`\\[(${prefix}\\d{1,3})\\]`, 'g'))) { const s = by.get(m[1]!); if (s && !out.includes(s)) out.push(s); }
  return out;
}

export const LETTER_KINDS = ['reason_why', 'replacement_disclosure', 'annual_review', 'follow_up'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
/** What each letter is built from: the signed advice records it needs (none = notes and deal details only). */
export const LETTER_NEEDS: Record<LetterKind, string[]> = {
  reason_why: ['needs_analysis', 'recommendation'],
  replacement_disclosure: ['needs_analysis', 'replacement_disclosure'],
  annual_review: [],
  follow_up: [],
};
export const LETTER_TASK: Record<LetterKind, string> = {
  reason_why: 'a reason-why letter to the client: what they asked for, what was recommended, and why it fits the needs analysis. Note anything the client chose not to do.',
  replacement_disclosure: 'a letter explaining the replacement of existing coverage: what is being replaced, what changes, what the client may lose (for example new waiting or contestability periods), and why the recommendation was made.',
  annual_review: 'a short letter inviting the client to their annual review, summarising what is on file and what has changed since the last review.',
  follow_up: 'a short follow-up letter after the latest meeting: what was discussed and the agreed next steps.',
};

export interface MeetingNotes { summary: string; followUps: { title: string; dueInDays: number | null }[]; needsChanges: string[]; complianceNotes: string[] }
/** The model's meeting JSON, checked and trimmed; a reply that is not JSON becomes a summary with no lists. */
export function parseMeeting(raw: string): MeetingNotes {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let j: Record<string, unknown> = {};
  try { const start = text.indexOf('{'), end = text.lastIndexOf('}'); j = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as Record<string, unknown>; }
  catch { return { summary: text.slice(0, 4000), followUps: [], needsChanges: [], complianceNotes: [] }; }
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 300)).slice(0, n) : []);
  const follow = Array.isArray(j.followUps) ? j.followUps.flatMap((f) => {
    const o = f as { title?: unknown; dueInDays?: unknown };
    if (typeof o?.title !== 'string' || !o.title.trim()) return [];
    const d = typeof o.dueInDays === 'number' && Number.isFinite(o.dueInDays) ? Math.min(365, Math.max(0, Math.round(o.dueInDays))) : null;
    return [{ title: o.title.trim().slice(0, 300), dueInDays: d }];
  }).slice(0, 20) : [];
  return { summary: typeof j.summary === 'string' ? j.summary.trim().slice(0, 4000) : '', followUps: follow, needsChanges: strs(j.needsChanges, 20), complianceNotes: strs(j.complianceNotes, 20) };
}
