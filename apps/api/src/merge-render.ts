/** Fills {{fields}} in a message. Values are escaped; a field can have a fallback: {{firstName|there}}. */
const TOKEN = /\{\{\s*([A-Za-z0-9_.:-]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;
export const BASE_TOKENS = ['name', 'firstName', 'lastName', 'email', 'box', 'stage', 'value', 'owner', 'myName', 'myEmail', 'company', 'unsubscribe'];

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const tokensIn = (tpl: string): string[] => [...new Set([...tpl.matchAll(TOKEN)].map((m) => m[1]!))];

const lookup = (vars: Record<string, string>) => {
  const m = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  return (key: string, fallback?: string) => { const v = m.get(key.toLowerCase()); return v != null && v !== '' ? v : fallback ?? ''; };
};

/** Subjects are plain text. */
export function renderSubject(tpl: string, vars: Record<string, string>): string {
  const get = lookup(vars);
  return tpl.replace(TOKEN, (_m, k: string, fb?: string) => (k === 'unsubscribe' ? '' : get(k, fb))).replace(/\s+/g, ' ').trim();
}

/** Bodies are written as plain text; blank lines become paragraphs and web addresses become links. */
export function renderBody(tpl: string, vars: Record<string, string>, unsubscribeHtml: string): { html: string; empty: string[] } {
  const get = lookup(vars);
  const empty: string[] = [];
  let out = '', last = 0;
  const lit = (s: string) => escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  for (const m of tpl.matchAll(TOKEN)) {
    out += lit(tpl.slice(last, m.index));
    last = m.index! + m[0].length;
    const key = m[1]!;
    if (key === 'unsubscribe') { out += unsubscribeHtml; continue; }
    const v = get(key, m[2]);
    if (v === '') empty.push(key);
    out += escapeHtml(v);
  }
  out += lit(tpl.slice(last));
  const html = out.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`).join('');
  return { html, empty };
}
