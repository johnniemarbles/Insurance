import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Req { id: string; kind: 'access' | 'withdraw' | 'erase'; note: string | null; status: 'open' | 'done' | 'declined'; resolution: string | null; createdAt: string; dueAt: string; userId: string; personName: string }

const X = {
  'en': {
    title: 'Your privacy', intro: 'What this product holds about you, a copy you can keep, and ways to ask us to stop or delete.',
    where: (r: string) => `Your data is stored in ${r.startsWith('ca') ? 'Canada (Québec)' : r.startsWith('eu') ? 'the European Union' : r.toUpperCase()}.`,
    held: 'What is held about you', notes: 'Notes you wrote', tasks: 'Tasks assigned to you', notifications: 'Notifications', settings: 'Your settings', consents: 'Consents you gave',
    ai: (on: boolean) => on ? 'Your company has switched on the AI assistant. When you ask it, the record you ask about is sent to the AI provider, which processes it outside Québec.' : 'The AI assistant is off for your company. Nothing is sent to an AI provider.',
    download: 'Download my data (JSON)', downloading: 'Preparing…',
    ask: 'Make a request', note: 'Anything we should know (optional)',
    withdraw: 'Withdraw my consent', erase: 'Delete my personal data', access: 'Send me a formal copy',
    hint: 'A company administrator must answer within 30 days. Records your colleagues own stay with the company.',
    sent: 'Request sent.', already: 'You already have an open request of that kind.',
    mine: 'Your requests', none: 'No requests yet.', kind: { access: 'Copy', withdraw: 'Withdraw consent', erase: 'Delete data' }, status: { open: 'Open', done: 'Done', declined: 'Declined' },
    due: 'Answer due', queue: 'Requests waiting for you', markDone: 'Mark done', decline: 'Decline', resolution: 'Note to the person (optional)',
  },
  'fr-CA': {
    title: 'Votre vie privée', intro: 'Ce que ce produit détient à votre sujet, une copie à conserver et des façons de nous demander d’arrêter ou de supprimer.',
    where: (r: string) => `Vos données sont hébergées ${r.startsWith('ca') ? 'au Canada (Québec)' : r.startsWith('eu') ? 'dans l’Union européenne' : r.toUpperCase()}.`,
    held: 'Ce qui est détenu à votre sujet', notes: 'Notes que vous avez écrites', tasks: 'Tâches qui vous sont confiées', notifications: 'Notifications', settings: 'Vos paramètres', consents: 'Consentements donnés',
    ai: (on: boolean) => on ? 'Votre entreprise a activé l’assistant IA. Lorsque vous l’utilisez, le dossier concerné est transmis au fournisseur d’IA, qui le traite hors du Québec.' : 'L’assistant IA est désactivé pour votre entreprise. Rien n’est transmis à un fournisseur d’IA.',
    download: 'Télécharger mes données (JSON)', downloading: 'Préparation…',
    ask: 'Faire une demande', note: 'Précisions utiles (facultatif)',
    withdraw: 'Retirer mon consentement', erase: 'Supprimer mes renseignements personnels', access: 'M’envoyer une copie officielle',
    hint: 'Un administrateur de l’entreprise doit répondre dans les 30 jours. Les dossiers appartenant à vos collègues restent à l’entreprise.',
    sent: 'Demande envoyée.', already: 'Vous avez déjà une demande ouverte de ce type.',
    mine: 'Vos demandes', none: 'Aucune demande pour l’instant.', kind: { access: 'Copie', withdraw: 'Retrait du consentement', erase: 'Suppression' }, status: { open: 'Ouverte', done: 'Terminée', declined: 'Refusée' },
    due: 'Réponse attendue le', queue: 'Demandes qui vous attendent', markDone: 'Marquer comme traitée', decline: 'Refuser', resolution: 'Message à la personne (facultatif)',
  },
};

export function PrivacyTab({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale];
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const load = () => call('GET', '/v1/privacy').then(setD, (e) => setMsg((e as Error).message));
  useEffect(() => { void load(); }, []);

  const download = async () => {
    setBusy(true);
    try {
      const doc = await call('GET', '/v1/privacy/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
      a.download = 'my-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const send = async (kind: string) => {
    try {
      const r = await call('POST', '/v1/privacy/requests', { kind, ...(note.trim() ? { note: note.trim() } : {}) });
      setMsg(r?.duplicate ? x.already : x.sent); setNote(''); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const resolve = async (id: string, status: 'done' | 'declined') => {
    try { await call('PATCH', `/v1/privacy/requests/${id}`, { status, ...(reply[id]?.trim() ? { resolution: reply[id]!.trim() } : {}) }); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  if (!d) return <p class="muted">{msg || '…'}</p>;
  const fmt = (s: string) => new Date(s).toLocaleDateString(locale);
  return (
    <div class="privacy">
      <p class="muted">{x.intro}</p>
      <p>{x.where(d.region)}</p>
      <div class="hcard">
        <h3>{x.held}</h3>
        <ul class="plain">
          <li>{x.notes}: <b>{d.held.notes}</b></li><li>{x.tasks}: <b>{d.held.tasks}</b></li><li>{x.notifications}: <b>{d.held.notifications}</b></li>
          <li>{x.settings}: <b>{d.held.settings}</b></li><li>{x.consents}: <b>{d.held.consents}</b></li>
        </ul>
        <p class="muted">{x.ai(d.aiEnabled)}</p>
        <button class="primary" disabled={busy} onClick={() => void download()}>{busy ? x.downloading : x.download}</button>
      </div>
      <div class="hcard">
        <h3>{x.ask}</h3>
        <textarea rows={2} placeholder={x.note} aria-label={x.note} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        <div class="row">
          <button onClick={() => void send('access')}>{x.access}</button>
          <button onClick={() => void send('withdraw')}>{x.withdraw}</button>
          <button onClick={() => void send('erase')}>{x.erase}</button>
        </div>
        <p class="muted">{x.hint}</p>
        {msg && <p role="status">{msg}</p>}
      </div>
      <div class="hcard">
        <h3>{x.mine}</h3>
        {d.requests.length === 0 && <p class="muted">{x.none}</p>}
        {d.requests.map((r: Req) => <div class="ev">{x.kind[r.kind]} · <span class={`chip ${r.status === 'open' ? 'warn' : ''}`}>{x.status[r.status]}</span><small>{fmt(r.createdAt)}{r.resolution ? ` · ${r.resolution}` : ''}</small></div>)}
      </div>
      {d.queue.length > 0 && (
        <div class="hcard">
          <h3>{x.queue}</h3>
          {d.queue.map((r: Req) => (
            <div class="ev">
              <b>{r.personName}</b> · {x.kind[r.kind]}<small>{x.due} {fmt(r.dueAt)}{r.note ? ` · “${r.note}”` : ''}</small>
              <input placeholder={x.resolution} aria-label={x.resolution} value={reply[r.id] ?? ''} onInput={(e) => setReply({ ...reply, [r.id]: (e.target as HTMLInputElement).value })} />
              <div class="row"><button class="primary" onClick={() => void resolve(r.id, 'done')}>{x.markDone}</button><button onClick={() => void resolve(r.id, 'declined')}>{x.decline}</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
