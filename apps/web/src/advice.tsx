import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Adv { id: string; kind: string; title: string; body: string; tier: 'builtin' | 'vendor'; status: 'draft' | 'awaiting_signature' | 'signed'; clientName: string; clientEmail: string | null; contentHash: string | null; signedAt: string | null; signedMethod: string | null; vendorName: string | null; vendorRef: string | null; createdBy: string }
interface Kind { kind: string; tier: string; label: Record<Locale, string> }
interface Doc { id: string; name: string }

const T = {
  'en': { tab: 'Advice', h: 'Advice records', help: 'The advice you gave this client, kept as a permanent record. A signed record can never be changed.', none: 'No advice recorded yet.', add: 'New advice record', kind: 'Kind', title: 'Title', body: 'What you advised and why', client: 'Client name', email: 'Client email', save: 'Save draft', cancel: 'Cancel',
    draft: 'Draft', awaiting: 'Waiting for the client’s code', signed: 'Signed', builtin: 'Signed with a one-time code', vendor: 'Needs a certified e-signature vendor', send: 'Send code to client', code: '6-digit code', confirm: 'Confirm signature', sent: 'Code sent. It expires in 15 minutes.', del: 'Remove draft', edit: 'Edit',
    vendorHelp: 'Sign this with your certified e-signature vendor, upload the completed document on the Files tab, then record it here.', vendorName: 'Vendor (for example DocuSign)', vendorRef: 'Vendor reference or envelope ID', doc: 'Completed document', record: 'Record vendor signature', by: 'by', via: 'via', hash: 'Fingerprint' },
  'fr-CA': { tab: 'Conseils', h: 'Dossiers de conseil', help: 'Les conseils donnés à ce client, conservés comme dossier permanent. Un dossier signé ne peut jamais être modifié.', none: 'Aucun conseil consigné.', add: 'Nouveau dossier de conseil', kind: 'Type', title: 'Titre', body: 'Ce que vous avez conseillé et pourquoi', client: 'Nom du client', email: 'Courriel du client', save: 'Enregistrer le brouillon', cancel: 'Annuler',
    draft: 'Brouillon', awaiting: 'En attente du code du client', signed: 'Signé', builtin: 'Signature par code à usage unique', vendor: 'Exige un fournisseur de signature électronique certifié', send: 'Envoyer le code au client', code: 'Code à 6 chiffres', confirm: 'Confirmer la signature', sent: 'Code envoyé. Il expire dans 15 minutes.', del: 'Retirer le brouillon', edit: 'Modifier',
    vendorHelp: 'Faites signer avec votre fournisseur de signature électronique certifié, téléversez le document final dans l’onglet Fichiers, puis consignez-le ici.', vendorName: 'Fournisseur (p. ex. DocuSign)', vendorRef: 'Référence ou ID d’enveloppe', doc: 'Document final', record: 'Consigner la signature du fournisseur', by: 'par', via: 'via', hash: 'Empreinte' },
};
const when = (iso: string, locale: Locale) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** Advice records on a record: draft, sign with a one-time code or record a vendor signature, and keep for good. */
export function AdviceTab({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale];
  const [list, setList] = useState<Adv[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [form, setForm] = useState<{ kind: string; title: string; body: string; clientName: string; clientEmail: string } | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [vend, setVend] = useState<Record<string, { vendorName: string; vendorRef: string; documentId: string }>>({});
  const load = () => Promise.all([call('GET', `/v1/boxes/${boxId}/advice`), call('GET', `/v1/boxes/${boxId}/documents`)]).then(([a, d]) => { setList(a.advice); setKinds(a.kinds); setDocs(d.documents); }, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [boxId]);
  const go = async (fn: () => Promise<unknown>, msg = '') => { setErr(''); setOk(''); try { await fn(); await load(); setOk(msg); } catch (e) { setErr((e as Error).message); } };
  const label = (k: string) => kinds.find((y) => y.kind === k)?.label[locale] ?? k;
  return (
    <div class="rec-form">
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {ok && <div role="status" style={{ background: '#e6f4ea', color: '#137333', padding: '8px 10px', borderRadius: '8px', margin: '8px 0', fontWeight: 600 }}>{ok}</div>}
      {canEdit && !form && <button class="btn quiet" onClick={() => setForm({ kind: kinds[0]?.kind ?? 'needs_analysis', title: '', body: '', clientName: '', clientEmail: '' })}>{x.add}</button>}
      {form && (
        <form class="rec-form" onSubmit={(e) => { e.preventDefault(); void go(async () => { await call('POST', `/v1/boxes/${boxId}/advice`, { ...form, ...(form.clientEmail ? {} : { clientEmail: undefined }) }); setForm(null); }); }}>
          <label class="fld">{x.kind}<select value={form.kind} onChange={(e) => setForm({ ...form, kind: (e.target as HTMLSelectElement).value })}>{kinds.map((k) => <option value={k.kind}>{k.label[locale]}</option>)}</select></label>
          <label class="fld">{x.title}<input required maxLength={200} value={form.title} onInput={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })} /></label>
          <label class="fld">{x.body}<textarea required rows={6} value={form.body} onInput={(e) => setForm({ ...form, body: (e.target as HTMLTextAreaElement).value })} /></label>
          <label class="fld">{x.client}<input required value={form.clientName} onInput={(e) => setForm({ ...form, clientName: (e.target as HTMLInputElement).value })} /></label>
          <label class="fld">{x.email}<input type="email" value={form.clientEmail} onInput={(e) => setForm({ ...form, clientEmail: (e.target as HTMLInputElement).value })} /></label>
          <button class="btn">{x.save}</button> <button type="button" class="btn quiet" onClick={() => setForm(null)}>{x.cancel}</button>
        </form>
      )}
      {list.length === 0 && !form && <p class="muted">{x.none}</p>}
      {list.map((a) => (
        <div class="ev" key={a.id}>
          <strong>{a.title}</strong> <small>{label(a.kind)} · {a.clientName} · {a.status === 'signed' ? x.signed : a.status === 'awaiting_signature' ? x.awaiting : x.draft}</small>
          <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{a.body}</div>
          {a.status === 'signed' && <small style={{ display: 'block' }}>✓ {a.signedMethod === 'vendor' ? `${x.via} ${a.vendorName} (${a.vendorRef})` : x.builtin} · {a.signedAt ? when(a.signedAt, locale) : ''} · {x.hash} {a.contentHash?.slice(0, 12)}…</small>}
          {canEdit && a.status !== 'signed' && a.tier === 'builtin' && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
              <button class="btn quiet" onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/send-code`), x.sent)}>{x.send}</button>
              {a.status === 'awaiting_signature' && <>
                <input aria-label={x.code} placeholder={x.code} inputMode="numeric" maxLength={6} value={codes[a.id] ?? ''} onInput={(e) => setCodes({ ...codes, [a.id]: (e.target as HTMLInputElement).value })} style={{ width: '110px' }} />
                <button class="btn" disabled={(codes[a.id] ?? '').length !== 6} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/confirm`, { code: codes[a.id] }), `✓ ${x.signed}`)}>{x.confirm}</button></>}
              {a.status === 'draft' && <button class="ib danger" aria-label={x.del} onClick={() => void go(() => call('DELETE', `/v1/advice/${a.id}`))}>✕</button>}
            </div>
          )}
          {canEdit && a.status !== 'signed' && a.tier === 'vendor' && (
            <div style={{ marginTop: '4px' }}>
              <p class="muted">{x.vendorHelp}</p>
              <input aria-label={x.vendorName} placeholder={x.vendorName} value={vend[a.id]?.vendorName ?? ''} onInput={(e) => setVend({ ...vend, [a.id]: { vendorName: (e.target as HTMLInputElement).value, vendorRef: vend[a.id]?.vendorRef ?? '', documentId: vend[a.id]?.documentId ?? '' } })} />{' '}
              <input aria-label={x.vendorRef} placeholder={x.vendorRef} value={vend[a.id]?.vendorRef ?? ''} onInput={(e) => setVend({ ...vend, [a.id]: { vendorName: vend[a.id]?.vendorName ?? '', vendorRef: (e.target as HTMLInputElement).value, documentId: vend[a.id]?.documentId ?? '' } })} />{' '}
              <select aria-label={x.doc} value={vend[a.id]?.documentId ?? ''} onChange={(e) => setVend({ ...vend, [a.id]: { vendorName: vend[a.id]?.vendorName ?? '', vendorRef: vend[a.id]?.vendorRef ?? '', documentId: (e.target as HTMLSelectElement).value } })}>
                <option value="">{x.doc}</option>{docs.map((d) => <option value={d.id}>{d.name}</option>)}
              </select>{' '}
              <button class="btn" disabled={!vend[a.id]?.vendorName || !vend[a.id]?.vendorRef || !vend[a.id]?.documentId} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/vendor-signed`, vend[a.id]), `✓ ${x.signed}`)}>{x.record}</button>{' '}
              {a.status === 'draft' && <button class="ib danger" aria-label={x.del} onClick={() => void go(() => call('DELETE', `/v1/advice/${a.id}`))}>✕</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
export const adviceTabLabel = (locale: Locale) => T[locale].tab;
