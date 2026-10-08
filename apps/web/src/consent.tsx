import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const T = {
  'en': { tab: 'Consent', h: 'Client consents', help: 'What the client agreed to, in which wording and how. A withdrawal is recorded, never erased, and it re-opens any paperwork gate that relied on it.', draft: 'Wording is a draft until counsel approves it.', none: 'No consent recorded yet.', add: 'Record consent', kind: 'Consent', channel: 'How it was given', in_person: 'In person', phone: 'Phone', email: 'Email', esign: 'E-signature', note: 'Note (optional)', save: 'Record', active: 'Active', withdrawn: 'Withdrawn', withdraw: 'Record withdrawal', why: 'Reason (optional)', by: 'by',
    hold: 'Legal hold', holdHelp: 'A hold keeps every record on this file from being purged, whatever its retention period.', holdOn: 'Under legal hold', place: 'Place hold', release: 'Release hold', reason: 'Reason (at least 10 characters)', relNote: 'Release note (optional)' },
  'fr-CA': { tab: 'Consentement', h: 'Consentements du client', help: 'Ce à quoi le client a consenti, dans quel libellé et comment. Un retrait est consigné, jamais effacé, et il rouvre toute exigence de documents qui en dépendait.', draft: 'Le libellé est un projet tant que le conseiller juridique ne l’a pas approuvé.', none: 'Aucun consentement consigné.', add: 'Consigner un consentement', kind: 'Consentement', channel: 'Mode d’obtention', in_person: 'En personne', phone: 'Téléphone', email: 'Courriel', esign: 'Signature électronique', note: 'Note (facultatif)', save: 'Consigner', active: 'Actif', withdrawn: 'Retiré', withdraw: 'Consigner le retrait', why: 'Motif (facultatif)', by: 'par',
    hold: 'Gel juridique', holdHelp: 'Un gel empêche la destruction de tous les documents de ce dossier, quelle que soit la durée de conservation.', holdOn: 'Sous gel juridique', place: 'Mettre sous gel', release: 'Lever le gel', reason: 'Motif (au moins 10 caractères)', relNote: 'Note de levée (facultatif)' },
};
interface C { id: string; kind: string; wordingVersion: string; channel: string; grantedOn: string; recordedBy: string; note: string | null; withdrawnAt: string | null; withdrawnBy: string | null; withdrawnNote: string | null }
interface D { consents: C[]; active: string[]; wording: { version: string; draft: boolean; kinds: { kind: string; text: Record<Locale, string> }[] }; hold: { id: string; reason: string; placedBy: string } | null; canHold: boolean }

/** Client consents with withdrawal, and the legal hold for one record. */
export function ConsentTab({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] as Record<string, string>;
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ kind: 'collection_use', channel: 'in_person', note: '' });
  const [wd, setWd] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(''); const [relNote, setRelNote] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/consents`).then(setD, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [boxId]);
  const go = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!d) return <div class="rec-form">{err && <div class="err" role="alert">{err}</div>}</div>;
  const text = (k: string) => d.wording.kinds.find((w) => w.kind === k)?.text[locale] ?? '';
  return (
    <div class="rec-form">
      {err && <div class="err" role="alert">{err}</div>}
      <h3>{x.h}</h3>
      <p class="muted">{x.help} {d.wording.draft ? x.draft : ''}</p>
      {d.consents.length === 0 && <p class="muted">{x.none}</p>}
      {d.consents.map((c) => (
        <div class="ev" key={c.id}>
          <strong>{text(c.kind)}</strong> <small>{c.withdrawnAt ? x.withdrawn : x.active} · {x[c.channel]} · {c.grantedOn} · {x.by} {c.recordedBy} · {c.wordingVersion}</small>
          {c.withdrawnAt && <small style={{ display: 'block' }}>{x.withdrawn}: {new Date(c.withdrawnAt).toLocaleDateString(locale)} {x.by} {c.withdrawnBy}{c.withdrawnNote ? ` — ${c.withdrawnNote}` : ''}</small>}
          {canEdit && !c.withdrawnAt && <div style={{ marginTop: '4px' }}>
            <input aria-label={x.why} placeholder={x.why} value={wd[c.id] ?? ''} onInput={(e) => setWd({ ...wd, [c.id]: (e.target as HTMLInputElement).value })} />{' '}
            <button class="btn quiet" onClick={() => void go(() => call('POST', `/v1/consents/${c.id}/withdraw`, { note: wd[c.id] ?? '' }))}>{x.withdraw}</button></div>}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); void go(async () => { await call('POST', `/v1/boxes/${boxId}/consents`, { kind: f.kind, channel: f.channel, ...(f.note ? { note: f.note } : {}) }); setF({ ...f, note: '' }); }); }}>
          <label class="fld">{x.kind}<select value={f.kind} onChange={(e) => setF({ ...f, kind: (e.target as HTMLSelectElement).value })}>{d.wording.kinds.map((w) => <option value={w.kind} disabled={d.active.includes(w.kind)}>{w.text[locale]}</option>)}</select></label>
          <label class="fld">{x.channel}<select value={f.channel} onChange={(e) => setF({ ...f, channel: (e.target as HTMLSelectElement).value })}>{['in_person', 'phone', 'email', 'esign'].map((c) => <option value={c}>{x[c]}</option>)}</select></label>
          <label class="fld">{x.note}<input value={f.note} onInput={(e) => setF({ ...f, note: (e.target as HTMLInputElement).value })} /></label>
          <button class="btn quiet" disabled={d.active.includes(f.kind)}>{x.save}</button>
        </form>
      )}
      {d.canHold && (
        <div style={{ marginTop: '14px' }}>
          <h3>{x.hold}</h3><p class="muted">{x.holdHelp}</p>
          {d.hold ? <div class="banner warn"><strong>{x.holdOn}</strong>: {d.hold.reason} ({x.by} {d.hold.placedBy})<div style={{ marginTop: '4px' }}>
            <input aria-label={x.relNote} placeholder={x.relNote} value={relNote} onInput={(e) => setRelNote((e.target as HTMLInputElement).value)} />{' '}
            <button class="btn quiet" onClick={() => void go(() => call('POST', `/v1/legal-holds/${d.hold!.id}/release`, { note: relNote }))}>{x.release}</button></div></div>
            : <div><input aria-label={x.reason} placeholder={x.reason} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} style={{ width: '60%' }} />{' '}
              <button class="btn quiet" disabled={reason.trim().length < 10} onClick={() => void go(async () => { await call('POST', `/v1/boxes/${boxId}/legal-hold`, { reason }); setReason(''); })}>{x.place}</button></div>}
        </div>
      )}
    </div>
  );
}
export const consentTabLabel = (locale: Locale) => T[locale].tab;
