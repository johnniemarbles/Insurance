/** Turns what other tools post to a capture link into a name, contact details and a note. Understands Calendly, Typeform, Jotform and Google Forms, and falls back to sensible guesses for anything else (Zapier, Wufoo, Webflow …). */
export interface Inbound { name: string; email: string; phone: string; note: string; value: unknown; custom?: Record<string, unknown>; source: string | null; ignore?: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Pair = [label: string, value: string];

/** Flatten nested objects and question/answer lists into label–value pairs. */
function pairs(v: unknown, path = '', depth = 0, out: Pair[] = []): Pair[] {
  if (out.length > 200 || depth > 4 || v == null) return out;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) { if (path && v.length) out.push([path, v.map(String).join(', ')]); return out; }
    for (const x of v) {
      const o = x as Record<string, unknown>;
      if (o && typeof o === 'object') {
        const q = text(o.question ?? o.label ?? o.title ?? o.name ?? o.key), a = o.answer ?? o.value ?? o.text;
        if (q && a != null && typeof a !== 'object') { out.push([q, text(a)]); continue; }
      }
      pairs(x, path, depth + 1, out);
    }
    return out;
  }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) pairs(x, path ? `${path}.${k}` : k, depth + 1, out); return out; }
  const t = text(v);
  if (path && t) out.push([path, t]);
  return out;
}

export function normalizeInbound(body: Record<string, unknown>): Inbound {
  const b = body ?? {};
  // ---- Calendly (v2 webhook) ----
  const cal = (b.payload && typeof b.payload === 'object' ? b.payload : null) as Record<string, any> | null;
  if (typeof b.event === 'string' && b.event.startsWith('invitee.') && cal) {
    if (b.event !== 'invitee.created') return { name: '', email: '', phone: '', note: '', value: null, source: 'Calendly', ignore: true };
    const ev = (cal.scheduled_event ?? {}) as Record<string, any>;
    const lines = [`Booked “${text(ev.name) || 'a meeting'}”${ev.start_time ? ` for ${text(ev.start_time)}` : ''}`];
    const loc = ev.location as Record<string, any> | undefined;
    if (loc?.join_url || loc?.location) lines.push(`Where: ${text(loc.join_url ?? loc.location)}`);
    for (const q of Array.isArray(cal.questions_and_answers) ? cal.questions_and_answers : []) if (q?.question && q?.answer) lines.push(`${text(q.question)}: ${text(q.answer)}`);
    return { name: text(cal.name) || `${text(cal.first_name)} ${text(cal.last_name)}`.trim(), email: text(cal.email).toLowerCase(), phone: text(cal.text_reminder_number), note: clip(lines.join('\n'), 2000), value: null, source: 'Calendly' };
  }
  // ---- Typeform ----
  const tf = b.form_response as Record<string, any> | undefined;
  if (tf && Array.isArray(tf.answers)) {
    const titles = new Map<string, string>();
    for (const f of tf.definition?.fields ?? []) titles.set(text(f.id), text(f.title));
    let name = '', email = '', phone = '';
    const lines: string[] = [];
    for (const a of tf.answers) {
      const title = titles.get(text(a.field?.id)) || text(a.field?.ref);
      const val = a.type === 'email' ? text(a.email) : a.type === 'phone_number' ? text(a.phone_number) : a.type === 'choice' ? text(a.choice?.label ?? a.choice?.other)
        : a.type === 'choices' ? (a.choices?.labels ?? []).join(', ') : text(a[a.type]);
      if (!val) continue;
      if (a.type === 'email' && !email) email = val.toLowerCase();
      else if (a.type === 'phone_number' && !phone) phone = val;
      else if (!name && /\bname\b/i.test(title)) name = val;
      else lines.push(`${title || 'Answer'}: ${val}`);
    }
    return { name, email, phone, note: clip(lines.join('\n'), 2000), value: null, source: 'Typeform' };
  }
  // ---- Jotform sends its answers as a JSON string in rawRequest; Google Forms scripts send namedValues ----
  let source: string | null = null;
  let flat: Pair[];
  if (typeof b.rawRequest === 'string') {
    source = 'Jotform';
    try { flat = pairs(JSON.parse(b.rawRequest)); } catch { flat = pairs(b); }
  } else if (b.namedValues && typeof b.namedValues === 'object') {
    source = 'Google Forms';
    flat = Object.entries(b.namedValues as Record<string, unknown>).map(([k, v]) => [k, text(Array.isArray(v) ? v[0] : v)] as Pair).filter((p) => p[1]);
  } else flat = pairs(b);

  let name = '', email = '', phone = '', first = '', last = '';
  let value: unknown = null;
  const used = new Set<number>();
  const notes: Pair[] = [];
  flat.forEach(([label, v], i) => {
    const k = norm(label.split('.').slice(-2).join('')), leaf = norm(label.split('.').pop() ?? label);
    if (!email && (k.includes('email') || leaf.includes('email')) && EMAIL.test(v)) { email = v.toLowerCase(); used.add(i); }
    else if (!phone && /phone|mobile|tel|cell|whatsapp/.test(k) && !/hotel|tele(?!ph)/.test(k)) { phone = v; used.add(i); }
    else if (!name && /^(name|fullname|contactname|yourname|customername|clientname|invitee)$/.test(leaf)) { name = v; used.add(i); }
    else if (!first && /first/.test(leaf) && /name|^first$/.test(k)) { first = v; used.add(i); }
    else if (!last && /last|surname|family/.test(leaf) && /name|^last$/.test(k)) { last = v; used.add(i); }
    else if (value == null && /^(value|amount|dealvalue|price|total)$/.test(leaf) && Number.isFinite(Number(v))) { value = Number(v); used.add(i); }
    else if (/^(website|token|event|createdat|created|id|formid|submissionid)$/.test(leaf)) used.add(i);
    else notes.push([label, v]);
  });
  if (!name) name = `${first} ${last}`.trim();
  if (!email) { const hit = flat.find(([, v]) => EMAIL.test(v)); if (hit) email = hit[1].toLowerCase(); }
  if (!name) { const hit = flat.find(([l, v]) => /name/i.test(l) && !EMAIL.test(v)); if (hit) name = hit[1]; }
  // the sender's own note field keeps its place, other answers follow with their question
  const lines = notes.map(([l, v]) => (/^(note|notes|message|comment|comments)$/i.test(l.split('.').pop() ?? l) ? v : `${l.split('.').pop()}: ${v}`));
  const custom = b.custom && typeof b.custom === 'object' && !Array.isArray(b.custom) ? (b.custom as Record<string, unknown>) : undefined;
  return { name, email, phone, note: clip(lines.join('\n'), 2000), value, ...(custom ? { custom } : {}), source };
}
