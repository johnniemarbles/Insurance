// Co-pilot step 2 screens: the company rulebook (compliance uploads; everyone asks), letter drafts on a deal, and the
// audit-ready score. Each hides itself when the server answers 404 (switched off).
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;
const MIMES: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' };
const toB64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

const R = {
  en: { title: 'Company rulebook', help: 'Your own compliance manual, AML policy and carrier guides. The co-pilot answers rule questions from these documents only, quoting the section. Client records are never sent with these questions.',
    none: 'No documents yet.', title2: 'Title', file: 'PDF, Word (.docx), text or Markdown file', add: 'Add to the rulebook', remove: 'Remove', passages: (n: number) => `${n} ${n === 1 ? 'passage' : 'passages'}`, by: 'added by', adding: 'Reading the file…' },
  'fr-CA': { title: 'Recueil de règles de l’entreprise', help: 'Votre manuel de conformité, votre politique LCB et les guides des assureurs. Le copilote répond aux questions sur les règles à partir de ces documents seulement, en citant la section. Aucun dossier client n’est envoyé avec ces questions.',
    none: 'Aucun document pour l’instant.', title2: 'Titre', file: 'Fichier PDF, Word (.docx), texte ou Markdown', add: 'Ajouter au recueil', remove: 'Retirer', passages: (n: number) => `${n} passage${n === 1 ? '' : 's'}`, by: 'ajouté par', adding: 'Lecture du fichier…' },
};

/** Settings card: the rulebook's documents; compliance and company admins add and remove them. */
export function RulebookCard({ call, locale }: { call: Call; locale: Locale }) {
  const x = R[locale] ?? R.en;
  const [d, setD] = useState<{ documents: { id: string; title: string; passages: number; uploadedBy: string; uploadedAt: string }[]; canManage: boolean } | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => { call('GET', '/v1/copilot/rulebook').then(setD, () => setD(null)); }, [call]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const add = async () => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    setBusy(true); setErr('');
    try { await call('POST', '/v1/copilot/rulebook', { title: title.trim() || file.name.replace(/\.[^.]+$/, ''), fileName: file.name, mime: MIMES[ext] ?? file.type, dataBase64: await toB64(file) }); setTitle(''); setFile(null); load(); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <section class="srow" aria-label={x.title}>
      <div><h3>{x.title}</h3><p class="muted">{x.help}</p></div>
      <div>
        {d.documents.length === 0 ? <p class="muted">{x.none}</p> : <ul class="maplist">{d.documents.map((doc) => (
          <li key={doc.id}><strong>{doc.title}</strong> <span class="muted">· {x.passages(doc.passages)} · {x.by} {doc.uploadedBy}</span>
            {d.canManage && <button type="button" class="linkbtn" style={{ marginLeft: '8px', fontSize: '12.5px' }} onClick={async () => { try { await call('DELETE', `/v1/copilot/rulebook/${doc.id}`); load(); } catch (e) { setErr(msg(e)); } }}>{x.remove}</button>}</li>
        ))}</ul>}
        {d.canManage && (
          <div class="hcard" style={{ marginTop: '8px' }}>
            <label>{x.title2}</label><input aria-label={x.title2} maxLength={200} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            <label>{x.file}</label><input aria-label={x.file} type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
            {busy && <p class="muted" role="status">{x.adding}</p>}
            {err && <p class="err" role="alert">{err}</p>}
            <div class="actions"><button type="button" class="btn" disabled={!file || busy} onClick={() => void add()}>{x.add}</button></div>
          </div>
        )}
      </div>
    </section>
  );
}

const LT = {
  en: { title: 'Letter drafts', help: 'Drafted from this deal\'s signed records and recent notes. Read it, fill in anything marked TO CONFIRM, then save it to the deal. PII does not send it.',
    kind: 'Letter', kinds: { reason_why: 'Reason-why letter', replacement_disclosure: 'Replacement letter', annual_review: 'Annual review invitation', follow_up: 'Meeting follow-up' } as Record<string, string>,
    extra: 'Anything to add (optional)', draft: 'Draft it', drafting: 'Drafting…', sources: 'Drawn from', confirm: 'Still to confirm', save: 'Save to the deal', saved: 'Saved to the deal as a note.', fr: 'Write in French' },
  'fr-CA': { title: 'Ébauches de lettres', help: 'Rédigées à partir des documents signés et des notes récentes de cette affaire. Lisez-la, complétez tout ce qui est marqué TO CONFIRM, puis enregistrez-la dans l’affaire. PII ne l’envoie pas.',
    kind: 'Lettre', kinds: { reason_why: 'Lettre de justification', replacement_disclosure: 'Lettre de remplacement', annual_review: 'Invitation à la revue annuelle', follow_up: 'Suivi de rencontre' } as Record<string, string>,
    extra: 'Précisions (facultatif)', draft: 'Rédiger', drafting: 'Rédaction…', sources: 'Tiré de', confirm: 'À confirmer', save: 'Enregistrer dans l’affaire', saved: 'Enregistrée dans l’affaire comme note.', fr: 'Rédiger en français' },
};

/** On a deal's Advice tab: draft a letter from signed records, edit it, save it as a note. */
export function LetterDrafts({ call, locale, boxId, canEdit }: { call: Call; locale: Locale; boxId: string; canEdit: boolean }) {
  const x = LT[locale] ?? LT.en;
  const [on, setOn] = useState(false);
  const [kind, setKind] = useState('reason_why');
  const [extra, setExtra] = useState('');
  const [fr, setFr] = useState(locale === 'fr-CA');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [res, setRes] = useState<{ draft: string; sources: { ref: string; label: string }[]; toConfirm: string[] } | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { call('GET', '/v1/copilot/settings').then((s) => setOn(!!s?.allowedForMe && !!s?.using), () => setOn(false)); }, [call]);
  if (!on || !canEdit) return null;
  const draft = async () => {
    setBusy(true); setErr(''); setDone(false); setRes(null);
    try { const r = await call('POST', '/v1/copilot/letters', { boxId, kind, language: fr ? 'fr-CA' : 'en', ...(extra.trim() ? { instructions: extra.trim() } : {}) }); setRes(r); setText(r.draft); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const save = async () => { setErr(''); try { await call('POST', '/v1/copilot/letters/save', { boxId, kind, body: text }); setDone(true); } catch (e) { setErr(msg(e)); } };
  return (
    <section class="rec-form" aria-label={x.title} style={{ marginTop: '14px' }}>
      <h3>{x.title}</h3>
      <p class="muted">{x.help}</p>
      <label>{x.kind}</label>
      <select aria-label={x.kind} value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>{Object.entries(x.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label>{x.extra}</label><input aria-label={x.extra} maxLength={500} value={extra} onInput={(e) => setExtra((e.target as HTMLInputElement).value)} />
      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 }}><input type="checkbox" style={{ width: 'auto', margin: 0, minHeight: 0 }} checked={fr} onChange={() => setFr(!fr)} />{x.fr}</label>
      <div class="actions"><button type="button" class="btn" disabled={busy} onClick={() => void draft()}>{busy ? x.drafting : x.draft}</button></div>
      {err && <p class="err" role="alert">{err}</p>}
      {res && (
        <div>
          <textarea aria-label={x.title} rows={14} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          {res.toConfirm.length > 0 && <p class="err" style={{ fontSize: '12.5px' }}>{x.confirm}: {res.toConfirm.join(' · ')}</p>}
          <p class="muted" style={{ fontSize: '12.5px' }}>{x.sources}: {res.sources.map((s) => `[${s.ref}] ${s.label}`).join(' · ') || '—'}</p>
          {done ? <p role="status" class="hcard" style={{ borderColor: 'var(--ok)' }}>{x.saved}</p> : <div class="actions"><button type="button" class="btn" disabled={/\[TO CONFIRM:/i.test(text)} onClick={() => void save()}>{x.save}</button></div>}
        </div>
      )}
    </section>
  );
}

const AR = {
  en: { title: 'Audit-ready', help: 'Open deals scored on the paperwork their stages require. 100 means nothing is missing.', ready: (r: number, n: number) => `${r} of ${n} open deals have everything on file`,
    avg: 'Average', partner: 'By partner', missing: 'Missing', none: 'No open deals.', expired: (d: string) => `needs analysis expired ${d}`, more: (n: number) => `and ${n} more` },
  'fr-CA': { title: 'Prêt pour l’audit', help: 'Affaires ouvertes notées selon les documents exigés par leurs étapes. 100 signifie que rien ne manque.', ready: (r: number, n: number) => `${r} affaires ouvertes sur ${n} ont tout au dossier`,
    avg: 'Moyenne', partner: 'Par partenaire', missing: 'Manque', none: 'Aucune affaire ouverte.', expired: (d: string) => `analyse des besoins expirée le ${d}`, more: (n: number) => `et ${n} de plus` },
};
interface Deal { boxId: string; name: string; owner: string | null; score: number; required: number; missing: { type: string; label: string }[]; needsExpiredOn: string | null }

/** Compliance page: how audit-ready the open deals are, worst first, by partner for managers. */
export function AuditReadyPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = AR[locale] ?? AR.en;
  const [d, setD] = useState<{ summary: { deals: number; ready: number; average: number }; byPartner: { ownerNodeId: string; owner: string | null; deals: number; average: number }[]; deals: Deal[] } | null>(null);
  useEffect(() => { call('GET', '/v1/audit-ready').then(setD, () => setD(null)); }, [call]);
  if (!d) return null;
  const gaps = d.deals.filter((g) => g.score < 100);
  const tone = (s: number) => (s === 100 ? 'var(--ok)' : s >= 50 ? 'var(--warn)' : 'var(--err, #b3261e)');
  return (
    <section class="rec-form" aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3>{x.title}</h3>
      <p class="muted">{x.help}</p>
      {d.summary.deals === 0 ? <p class="muted">{x.none}</p> : <>
        <p role="status"><strong style={{ fontSize: '1.4em', color: tone(d.summary.average) }}>{d.summary.average}</strong> <span class="muted">{x.avg}</span> · {x.ready(d.summary.ready, d.summary.deals)}</p>
        {d.byPartner.length > 1 && <p class="muted" style={{ fontSize: '12.5px' }}>{x.partner}: {d.byPartner.map((p) => `${p.owner ?? '—'} ${p.average}`).join(' · ')}</p>}
        <ul class="maplist">{gaps.slice(0, 12).map((g) => (
          <li key={g.boxId}><strong style={{ color: tone(g.score), minWidth: '2.5em', display: 'inline-block' }}>{g.score}</strong> {g.name} <span class="muted">· {g.owner ?? ''} · {x.missing}: {g.missing.map((m) => m.label).join(', ')}{g.needsExpiredOn ? ` · ${x.expired(g.needsExpiredOn)}` : ''}</span></li>
        ))}</ul>
        {gaps.length > 12 && <p class="muted">{x.more(gaps.length - 12)}</p>}
      </>}
    </section>
  );
}
