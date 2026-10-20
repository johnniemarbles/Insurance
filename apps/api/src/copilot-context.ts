// Ask PII: gathers the records a question is about, from what the asking person can already see (every query runs
// under their row-level security), and numbers them so the answer can cite them. Pure text building is separate
// from the database so it can be tested on its own.
import type { Tx } from '@pii/db';

export type RecordType = 'client' | 'deal' | 'note' | 'policy' | 'family' | 'task';
export interface Snippet { ref: string; type: RecordType; id: string; label: string; text: string }

const STOP = new Set(['the', 'and', 'for', 'with', 'what', 'who', 'whom', 'which', 'when', 'where', 'how', 'why', 'are', 'was', 'were', 'has', 'have', 'had',
  'does', 'did', 'can', 'could', 'should', 'would', 'will', 'any', 'all', 'about', 'from', 'this', 'that', 'these', 'those', 'there', 'their', 'them', 'they',
  'our', 'your', 'you', 'me', 'my', 'mine', 'his', 'her', 'its', 'is', 'of', 'to', 'in', 'on', 'at', 'by', 'an', 'a', 'or', 'not', 'no', 'yes', 'please',
  'tell', 'show', 'list', 'give', 'find', 'get', 'need', 'want', 'know', 'many', 'much', 'last', 'next', 'some', 'more', 'most', 'than', 'then', 'into',
  'client', 'clients', 'deal', 'deals', 'record', 'records', 'policy', 'policies', 'pii', 'les', 'des', 'une', 'pour', 'avec', 'quel', 'quels', 'quelle', 'qui', 'est', 'sont']);

/** Search words from a question: 3+ letters, not common words, at most six, longest first. */
export function searchTerms(q: string): string[] {
  const words = q.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}@.'-]{3,}/gu) ?? [];
  return [...new Set(words.map((w) => w.replace(/^['.-]+|['.-]+$/g, '')).filter((w) => w.length >= 3 && !STOP.has(w)))].sort((a, b) => b.length - a.length).slice(0, 6);
}

/** Questions about time-bound work get the matching list even without a name in them. */
export function intents(q: string): { renewals: boolean; tasks: boolean } {
  const s = q.toLowerCase();
  return { renewals: /renew|expir|échéan|renouvel/.test(s), tasks: /task|overdue|follow.?up|to.?do|today|tâche|retard|suivi/.test(s) };
}

const like = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const day = (d: string | Date | null | undefined) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : '');
const cut = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** At most `max` records, each at most a few hundred characters, deduplicated, numbered C1, C2, … */
export async function gatherContext(tx: Tx, question: string, max = 30): Promise<Snippet[]> {
  const terms = searchTerms(question);
  const want = intents(question);
  const out: Omit<Snippet, 'ref'>[] = [];
  const seen = new Set<string>();
  const add = (s: Omit<Snippet, 'ref'>) => { const k = `${s.type}:${s.id}`; if (!seen.has(k) && out.length < max) { seen.add(k); out.push(s); } };
  for (const t of terms) {
    const p = like(t);
    for (const c of (await tx.query<{ id: string; full_name: string | null; email: string | null; phone: string | null; dob: string | null; family: string | null }>(
      `SELECT c.id, c.full_name, c.email::text AS email, c.phone, c.date_of_birth::text AS dob,
              (SELECT f.display_name FROM family_memberships m JOIN families f ON f.id = m.family_id WHERE m.contact_id = c.id AND m.ended_at IS NULL) AS family
         FROM contacts c WHERE c.full_name ILIKE $1 OR c.email::text ILIKE $1 LIMIT 6`, [p])).rows) {
      add({ type: 'client', id: c.id, label: c.full_name ?? c.email ?? 'Client', text: [`Client ${c.full_name ?? ''}`, c.email, c.phone, c.dob && `born ${c.dob}`, c.family && `family: ${c.family}`].filter(Boolean).join('; ') });
      for (const b of (await tx.query<{ id: string; name: string; stage: string; value: string | null; currency: string; close: string | null }>(
        `SELECT b.id, b.name, s.name AS stage, b.value_amount::text AS value, b.currency, b.close_date::text AS close
           FROM box_contacts bc JOIN boxes b ON b.id = bc.box_id JOIN stages s ON s.id = b.stage_id WHERE bc.contact_id = $1 ORDER BY b.updated_at DESC NULLS LAST LIMIT 4`, [c.id])).rows) {
        add({ type: 'deal', id: b.id, label: b.name, text: [`Deal "${b.name}" for ${c.full_name ?? 'this client'}`, `stage ${b.stage}`, b.value && `value ${b.value} ${b.currency}`, b.close && `expected close ${b.close}`].filter(Boolean).join('; ') });
      }
    }
    for (const b of (await tx.query<{ id: string; name: string; stage: string; value: string | null; currency: string; close: string | null }>(
      `SELECT b.id, b.name, s.name AS stage, b.value_amount::text AS value, b.currency, b.close_date::text AS close
         FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE b.name ILIKE $1 LIMIT 5`, [p])).rows) {
      add({ type: 'deal', id: b.id, label: b.name, text: [`Deal "${b.name}"`, `stage ${b.stage}`, b.value && `value ${b.value} ${b.currency}`, b.close && `expected close ${b.close}`].filter(Boolean).join('; ') });
    }
    for (const n of (await tx.query<{ id: string; body: string; created_at: Date; box: string }>(
      `SELECT n.id, n.body, n.created_at, b.name AS box FROM notes n JOIN boxes b ON b.id = n.box_id WHERE n.body ILIKE $1 ORDER BY n.created_at DESC LIMIT 5`, [p])).rows) {
      add({ type: 'note', id: n.id, label: `Note on ${n.box}`, text: `Note on deal "${n.box}" (${day(n.created_at)}): ${cut(n.body, 400)}` });
    }
    for (const f of (await tx.query<{ id: string; name: string; members: string | null }>(
      `SELECT f.id, f.display_name AS name,
              (SELECT string_agg(c.full_name || ' (' || replace(m.role, '_', ' ') || ')', ', ') FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
                WHERE m.family_id = f.id AND m.ended_at IS NULL) AS members
         FROM families f WHERE f.status = 'active' AND f.display_name ILIKE $1 LIMIT 3`, [p])).rows) {
      add({ type: 'family', id: f.id, label: f.name, text: `Family "${f.name}": ${f.members ?? 'no members'}` });
    }
    for (const r of await policies(tx, `(p.policy_number ILIKE $1 OR p.plan_name ILIKE $1 OR p.carrier_id ILIKE $1
         OR EXISTS (SELECT 1 FROM policy_parties pp JOIN contacts c ON c.id = pp.contact_id WHERE pp.policy_id = p.id AND pp.ended_at IS NULL AND c.full_name ILIKE $1))`, [p], 5)) add(r);
  }
  if (want.renewals) {
    for (const r of await policies(tx, `p.expiry_date BETWEEN current_date AND current_date + 90 AND p.status IN ('active', 'reinstated', 'pending')`, [], 10, 'p.expiry_date')) add(r);
    for (const b of (await tx.query<{ id: string; name: string; rd: string }>(
      `SELECT b.id, b.name, b.custom->>'renewal_date' AS rd FROM boxes b
        WHERE b.custom->>'renewal_date' ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (b.custom->>'renewal_date')::date BETWEEN current_date AND current_date + 90
        ORDER BY (b.custom->>'renewal_date')::date LIMIT 10`)).rows) {
      add({ type: 'deal', id: b.id, label: b.name, text: `Deal "${b.name}" renews on ${b.rd}` });
    }
  }
  if (want.tasks) {
    for (const k of (await tx.query<{ id: string; title: string; due: string | null; box: string | null }>(
      `SELECT t.id, t.title, t.due_at::date::text AS due, b.name AS box FROM tasks t LEFT JOIN boxes b ON b.id = t.box_id
        WHERE t.done_at IS NULL AND t.assignee_id = app_user_id() ORDER BY t.due_at NULLS LAST LIMIT 10`)).rows) {
      add({ type: 'task', id: k.id, label: k.title, text: `Open task "${cut(k.title, 160)}"${k.due ? `, due ${k.due}` : ''}${k.box ? `, on deal "${k.box}"` : ''}` });
    }
  }
  return out.map((s, i) => ({ ...s, ref: `C${i + 1}` }));
}

async function policies(tx: Tx, where: string, args: unknown[], limit: number, order = 'p.plan_name'): Promise<Omit<Snippet, 'ref'>[]> {
  const rows = (await tx.query<{ id: string; carrier: string; plan: string; num: string; status: string; premium: number | null; expiry: string | null; people: string | null }>(
    `SELECT p.id, coalesce(cd.display_name, p.carrier_id) AS carrier, p.plan_name AS plan, p.policy_number AS num, p.status, p.annual_premium_cents AS premium,
            p.expiry_date::text AS expiry,
            (SELECT string_agg(DISTINCT c.full_name || ' (' || replace(pp.role, '_', ' ') || ')', ', ') FROM policy_parties pp JOIN contacts c ON c.id = pp.contact_id
              WHERE pp.policy_id = p.id AND pp.ended_at IS NULL) AS people
       FROM policy_records p LEFT JOIN carrier_directory cd ON cd.id = p.carrier_id
      WHERE policy_visible(p.id) AND ${where} ORDER BY ${order} LIMIT ${limit}`, args)).rows;
  return rows.map((r) => ({ type: 'policy' as const, id: r.id, label: `${r.carrier} · ${r.plan}`, text: [`Policy ${r.num}, ${r.carrier} ${r.plan}`, `status ${r.status}`, r.premium != null && `annual premium ${(r.premium / 100).toFixed(2)}`, r.expiry && `expires ${r.expiry}`, r.people && `people: ${r.people}`].filter(Boolean).join('; ') }));
}

/** The record lines sent to the AI service. */
export const contextBlock = (snips: Snippet[]) => snips.map((s) => `[${s.ref}] ${s.text}`).join('\n');

/** Which records the answer cited, in order of first mention; refs that do not exist are dropped. */
export function citedRefs(answer: string, snips: Snippet[]): Snippet[] {
  const by = new Map(snips.map((s) => [s.ref, s]));
  const out: Snippet[] = [];
  for (const m of answer.matchAll(/\[(C\d{1,3})\]/g)) { const s = by.get(m[1]!); if (s && !out.includes(s)) out.push(s); }
  return out;
}
