import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { ComposeApi, Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Merge { id: string; name: string; subject: string; body: string; status: 'draft' | 'running' | 'paused' | 'done' | 'cancelled'; total: number; sent: number; failed: number; skipped: number; unsubscribed: number; createdAt: string; recipients?: Rec[] }
interface Rec { id: string; email: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; error: string | null; unsubscribedAt: string | null; boxName: string | null }

const X = {
  'en': {
    title: 'Mail merge', none: 'No mail merges yet. Select records in a list, then choose Mail merge.', newMerge: 'New mail merge', name: 'Name', subject: 'Subject', message: 'Message', back: 'Back', create: 'Create', fields: 'Insert a field',
    statuses: { draft: 'Draft', running: 'Sending', paused: 'Paused', done: 'Done', cancelled: 'Cancelled' } as Record<string, string>, rstatus: { pending: 'Waiting', sending: 'Sending…', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' } as Record<string, string>,
    recipients: (n: number) => (n === 1 ? '1 recipient' : `${n} recipients`), progress: (s: number, t: number) => `${s} of ${t} sent`,
    start: 'Start sending', pause: 'Pause', resume: 'Resume', cancel: 'Cancel merge', retry: 'Retry failed', confirmCancel: 'Cancel this merge? Messages not yet sent will not go out.',
    preview: 'Preview', previewing: 'First recipient', unknown: (l: string) => `Unknown field: ${l}`, emptyF: (l: string) => `Empty for this recipient: ${l}`, ok: 'Looks good.',
    help: 'Each person gets their own message from your Gmail, one at a time. Keep this Gmail tab open while it sends.', needGmail: 'Open PII inside Gmail (with the extension) to send. You can still create and review merges here.',
    law: 'Include {{unsubscribe}} in the message. Canadian anti-spam law requires a way to opt out, and people who opt out are never emailed again.', sending: 'Sending from this tab…', capped: 'Daily limit reached. It will continue tomorrow.',
    skippedNote: (s: { noEmail: number; optedOut: number; duplicate: number }) => [s.noEmail && `${s.noEmail} without an email address`, s.optedOut && `${s.optedOut} unsubscribed`, s.duplicate && `${s.duplicate} duplicates`].filter(Boolean).join(', '),
    defaultSubject: 'Hello {{firstName|there}}', defaultBody: 'Hi {{firstName|there}},\n\n\n\nBest regards,\n{{myName}}\n{{company}}\n\n{{unsubscribe}}', unsub: 'unsubscribed',
    tokens: [['firstName', 'First name'], ['lastName', 'Last name'], ['name', 'Full name'], ['box', 'Record name'], ['stage', 'Stage'], ['value', 'Value'], ['owner', 'Owner'], ['myName', 'My name'], ['company', 'Company'], ['unsubscribe', 'Unsubscribe link']] as [string, string][],
  },
  'fr-CA': {
    title: 'Publipostage', none: 'Aucun publipostage. Sélectionnez des dossiers dans une liste, puis choisissez Publipostage.', newMerge: 'Nouveau publipostage', name: 'Nom', subject: 'Objet', message: 'Message', back: 'Retour', create: 'Créer', fields: 'Insérer un champ',
    statuses: { draft: 'Brouillon', running: 'Envoi en cours', paused: 'En pause', done: 'Terminé', cancelled: 'Annulé' } as Record<string, string>, rstatus: { pending: 'En attente', sending: 'Envoi…', sent: 'Envoyé', failed: 'Échec', skipped: 'Ignoré' } as Record<string, string>,
    recipients: (n: number) => (n === 1 ? '1 destinataire' : `${n} destinataires`), progress: (s: number, t: number) => `${s} sur ${t} envoyés`,
    start: 'Commencer l’envoi', pause: 'Pause', resume: 'Reprendre', cancel: 'Annuler le publipostage', retry: 'Réessayer les échecs', confirmCancel: 'Annuler ce publipostage? Les messages non envoyés ne partiront pas.',
    preview: 'Aperçu', previewing: 'Premier destinataire', unknown: (l: string) => `Champ inconnu : ${l}`, emptyF: (l: string) => `Vide pour ce destinataire : ${l}`, ok: 'Tout est bon.',
    help: 'Chaque personne reçoit son propre message depuis votre Gmail, un à la fois. Gardez cet onglet Gmail ouvert pendant l’envoi.', needGmail: 'Ouvrez PII dans Gmail (avec l’extension) pour envoyer. Vous pouvez quand même créer et réviser ici.',
    law: 'Incluez {{unsubscribe}} dans le message. La loi canadienne anti-pourriel exige un moyen de se désabonner, et les personnes désabonnées ne reçoivent plus jamais de courriel.', sending: 'Envoi depuis cet onglet…', capped: 'Limite quotidienne atteinte. L’envoi reprendra demain.',
    skippedNote: (s: { noEmail: number; optedOut: number; duplicate: number }) => [s.noEmail && `${s.noEmail} sans adresse courriel`, s.optedOut && `${s.optedOut} désabonnés`, s.duplicate && `${s.duplicate} doublons`].filter(Boolean).join(', '),
    defaultSubject: 'Bonjour {{firstName|}}', defaultBody: 'Bonjour {{firstName|}},\n\n\n\nCordialement,\n{{myName}}\n{{company}}\n\n{{unsubscribe}}', unsub: 'désabonné',
    tokens: [['firstName', 'Prénom'], ['lastName', 'Nom de famille'], ['name', 'Nom complet'], ['box', 'Nom du dossier'], ['stage', 'Étape'], ['value', 'Valeur'], ['owner', 'Responsable'], ['myName', 'Mon nom'], ['company', 'Entreprise'], ['unsubscribe', 'Lien de désabonnement']] as [string, string][],
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mail merge: personal messages to many records, sent one at a time from the person's own Gmail. */
export function MergePanel({ call, locale, compose, boxIds, onClose, onOpenBox }: { call: Call; locale: Locale; compose?: ComposeApi; boxIds: string[]; onClose: () => void; onOpenBox: (id: string) => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const x = X[locale];
  const [view, setView] = useState<'list' | 'new' | 'detail'>(boxIds.length ? 'new' : 'list');
  const [list, setList] = useState<Merge[]>([]);
  const [cur, setCur] = useState<Merge | null>(null);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState(x.defaultSubject);
  const [body, setBody] = useState(x.defaultBody);
  const [pv, setPv] = useState<{ to: string; subject: string; html: string; empty: string[]; unknown: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const stop = useRef(false);

  const loadList = () => call('GET', '/v1/merges').then((r) => setList(r.merges), (e) => setErr((e as Error).message));
  const loadOne = async (id: string) => { const m = (await call('GET', `/v1/merges/${id}`)) as Merge; setCur(m); return m; };
  useEffect(() => { if (view === 'list') void loadList(); }, [view]);
  useEffect(() => () => { stop.current = true; }, []);

  // live preview for the first selected record while writing
  useEffect(() => {
    if (view !== 'new') return;
    const h = setTimeout(() => { call('POST', '/v1/merges/preview', { subject: subject || ' ', body: body || ' ', ...(boxIds[0] ? { boxId: boxIds[0] } : {}) }).then(setPv, () => setPv(null)); }, 350);
    return () => clearTimeout(h);
  }, [view, subject, body]);

  const insert = (tok: string) => {
    const ta = bodyRef.current; const text = `{{${tok}}}`;
    if (!ta) { setBody((b) => b + text); return; }
    const a = ta.selectionStart, z = ta.selectionEnd;
    setBody(body.slice(0, a) + text + body.slice(z));
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = a + text.length; }, 0);
  };
  const act = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); } catch (e) { setErr((e as Error).message); } };

  const create = () => act(async () => {
    const r = await call('POST', '/v1/merges', { name: name.trim() || subject.slice(0, 60), subject: subject.trim(), body, boxIds });
    const m = await loadOne(r.id);
    setInfo(`${x.recipients(r.recipients)}${x.skippedNote(r.skipped) ? ` · ${x.skippedNote(r.skipped)}` : ''}`);
    setView('detail'); void m;
  });

  async function runLoop(id: string) {
    if (!compose || sending) return;
    stop.current = false; setSending(true);
    try {
      while (!stop.current) {
        let n: any;
        try { n = await call('POST', `/v1/merges/${id}/next`); } catch (e) { setErr(/limit/i.test((e as Error).message) ? x.capped : (e as Error).message); break; }
        if (n.idle || n.done) { await loadOne(id); break; }
        if (n.wait) { await sleep(4000); continue; }
        const res = await compose.send({ to: n.to, subject: n.subject, html: n.html });
        await call('POST', `/v1/merges/${id}/recipients/${n.recipientId}/result`, res.ok ? { ok: true, ...(res.threadId ? { threadId: res.threadId } : {}) } : { ok: false, error: res.error ?? 'Could not send' });
        await loadOne(id);
        await sleep(6000 + Math.random() * 6000); // a human pace keeps Gmail from flagging bulk sending
      }
    } finally { setSending(false); }
  }
  useEffect(() => { if (view === 'detail' && cur?.status === 'running' && compose && !sending) void runLoop(cur.id); }, [view, cur?.id, cur?.status]);

  const setStatus = (status: 'running' | 'paused' | 'cancelled') => act(async () => {
    if (status === 'cancelled' && !confirm(x.confirmCancel)) return;
    if (status !== 'running') stop.current = true;
    await call('PATCH', `/v1/merges/${cur!.id}`, { status });
    await loadOne(cur!.id);
    if (status === 'cancelled') setView('list');
  });

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.title}>
      <h2>{x.title}</h2>
      {err && <div class="err" role="alert">{err}</div>}

      {view === 'list' && (
        <>
          {list.length === 0 && <p class="muted">{x.none}</p>}
          {list.map((m) => (
            <button class="rcard" key={m.id} onClick={() => { setInfo(''); void loadOne(m.id).then(() => setView('detail')); }}>
              <b>{m.name}</b><span>{x.progress(m.sent, m.total)}{m.failed ? ` · ${m.failed} ✕` : ''}{m.unsubscribed ? ` · ${m.unsubscribed} ${x.unsub}` : ''}</span>
              <em class={`rbadge ${m.status === 'running' ? '' : 'zapier'}`}>{x.statuses[m.status]}</em>
            </button>
          ))}
        </>
      )}

      {view === 'new' && (
        <>
          <p class="muted">{x.recipients(boxIds.length)} · {x.help}</p>
          <label for="mn">{x.name}</label><input id="mn" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <label for="ms">{x.subject}</label><input id="ms" value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} />
          <label for="mb">{x.message}</label>
          <div class="gchips" aria-label={x.fields}>{x.tokens.map(([k, l]) => <button class="gchip" type="button" onClick={() => insert(k)}>{l}</button>)}</div>
          <textarea id="mb" ref={bodyRef} rows={10} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
          <p class="muted">{x.law}</p>
          {pv && (
            <section class="icard">
              <h3>{x.previewing}: {pv.to}</h3>
              <b>{pv.subject}</b>
              <div class="pvbody" dangerouslySetInnerHTML={{ __html: pv.html }} />
              {pv.unknown.map((u) => <div class="bad">{x.unknown(u)}</div>)}
              {pv.empty.filter((e) => e !== 'unsubscribe').map((u) => <div class="muted">{x.emptyF(u)}</div>)}
              {!pv.unknown.length && !pv.empty.length && <div class="muted">{x.ok}</div>}
            </section>
          )}
          <div class="actions"><button class="btn" disabled={!subject.trim() || !body.trim() || boxIds.length === 0} onClick={() => void create()}>{x.create}</button><button class="btn quiet" onClick={() => (boxIds.length ? onClose() : setView('list'))}>{x.back}</button></div>
        </>
      )}

      {view === 'detail' && cur && (
        <>
          <button class="btn quiet" onClick={() => { stop.current = true; setView('list'); }}>← {x.back}</button>
          <h3>{cur.name} <em class="rbadge zapier">{x.statuses[cur.status]}</em></h3>
          {info && <p class="muted">{info}</p>}
          <p><b>{x.progress(cur.sent, cur.total)}</b>{cur.failed ? ` · ${cur.failed} ✕` : ''}{cur.unsubscribed ? ` · ${cur.unsubscribed} ${x.unsub}` : ''}</p>
          <progress max={cur.total || 1} value={cur.sent + cur.failed + cur.skipped} style="width:100%" />
          {!compose && (cur.status === 'draft' || cur.status === 'running' || cur.status === 'paused') && <p class="muted">{x.needGmail}</p>}
          {sending && <p role="status" class="muted">{x.sending}</p>}
          <div class="actions">
            {(cur.status === 'draft' || cur.status === 'paused') && <button class="btn" onClick={() => void setStatus('running')}>{cur.status === 'draft' ? x.start : x.resume}</button>}
            {cur.status === 'running' && <button class="btn quiet" onClick={() => void setStatus('paused')}>{x.pause}</button>}
            {cur.failed > 0 && cur.status !== 'cancelled' && <button class="btn quiet" onClick={() => void act(async () => { await call('POST', `/v1/merges/${cur.id}/retry-failed`); await loadOne(cur.id); })}>{x.retry}</button>}
            {cur.status !== 'done' && <button class="btn quiet danger" onClick={() => void setStatus('cancelled')}>{x.cancel}</button>}
          </div>
          <p class="muted">{x.help}</p>
          {(cur.recipients ?? []).map((r) => (
            <div class="erow" key={r.id}><span>{r.boxName ? <button class="linkbtn" onClick={() => onOpenBox(r.id && r.boxName ? r.id : '')}>{r.boxName}</button> : null} <small class="muted">{r.email}</small>{r.error && <small class="bad"> · {r.error}</small>}</span><span class="spacer" /><small class={r.status === 'failed' ? 'bad' : 'muted'}>{r.unsubscribedAt ? x.unsub : x.rstatus[r.status]}</small></div>
          ))}
        </>
      )}
      <div class="actions">
        {view === 'list' && <button class="btn quiet" onClick={onClose}>{locale === 'fr-CA' ? 'Fermer' : 'Close'}</button>}
        {view !== 'list' && <button class="btn quiet" onClick={onClose}>{locale === 'fr-CA' ? 'Fermer' : 'Close'}</button>}
      </div>
    </aside>
  );
}
