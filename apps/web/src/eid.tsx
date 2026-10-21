// Electronic ID check (roadmap Phase 2, feature 7) on a deal's ID & AML tab, and the company's choice in Settings.
// Hidden unless the server has EID_ENABLED on (a 404 hides it) and the company switched at least one route on.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;
const toB64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

const T = {
  en: {
    title: 'Electronic ID check', help: 'Check a client\'s driver\'s licence and a selfie. PII keeps the outcome only: never the licence number, the photos, or what was read from the card.',
    client: 'Client', noClients: 'Add the client to this deal first.', noDob: 'No date of birth on file: the birth date check will go to compliance.',
    stripe: 'Send a Stripe Identity link', stripeHelp: 'Send this link to the client. On their phone they photograph their driver\'s licence and take a selfie on Stripe\'s page. The result appears here.',
    copy: 'Copy link', copied: 'Copied',
    own: 'Check photos here', ownHelp: 'Upload the licence photo and selfie the client gave you. PII\'s Google Gemini reads them once; nothing is stored. Only the photos are sent, no client details.',
    licence: 'Front of the driver\'s licence', selfie: 'Selfie of the client', consent: 'The client agreed to this ID check and gave me these photos', read: 'Read the licence', reading: 'Reading the photos…',
    result: 'What the check found', readName: 'Name on the licence', readDob: 'Date of birth', readExpiry: 'Expires', concerns: 'Concerns',
    looked: (n: string) => `I looked at the licence and the selfie, and they show ${n}`, confirm: 'Confirm', allClear: 'Everything matches. Confirming records the client as verified.', notClear: 'Something does not match. Confirming sends this check to compliance to decide.',
    history: 'Checks on this deal', cancel: 'Cancel', by: 'by', decided: 'Decided by', note: 'Decision note (at least 10 characters, no ID numbers)', accept: 'Accept as verified', reject: 'Reject',
    name_matches: 'Name matches the file', dob_matches: 'Date of birth matches', not_expired: 'Not expired', selfie_matches: 'Selfie matches the photo', looks_genuine: 'Looks genuine',
    route_stripe: 'Stripe Identity', route_own_check: 'PII check', redacted: 'Stripe\'s copy deleted',
    st: { link_sent: 'Link sent', processing: 'Stripe is checking', needs_input: 'Client must try again', needs_confirmation: 'Waiting for your confirmation', needs_review: 'Waiting for compliance', verified: 'Verified', failed: 'Failed', canceled: 'Cancelled' } as Record<string, string>,
    reasons: { name_mismatch: 'Name differs from the file', name_not_read: 'Name could not be read', name_missing_on_record: 'No name on file', dob_mismatch: 'Birth date differs from the file', dob_not_read: 'Birth date could not be read', dob_missing_on_record: 'No birth date on file', expiry_not_read: 'Expiry could not be read', document_expired: 'Licence has expired', selfie_mismatch: 'Selfie does not match', selfie_unclear: 'Selfie unclear', document_doubtful: 'Licence may not be genuine', genuineness_unclear: 'Could not tell if genuine', not_a_drivers_licence: 'Not a driver\'s licence' } as Record<string, string>,
    stripeReason: 'Stripe:',
    settings: 'Electronic ID', settingsHelp: 'How your company checks a client\'s driver\'s licence and selfie. Either way, PII keeps the outcome only.',
    useStripe: 'Stripe Identity (the client uses a link on their phone)', useOwn: 'PII\'s own check (an advisor uploads the photos; Google Gemini reads them; compliance decides mismatches)',
    redact: 'Ask Stripe to delete the photos and personal data once PII has the outcome', notOnServer: 'not set up on this server', save: 'Save', saved: 'Saved',
  },
  'fr-CA': {
    title: 'Vérification d’identité électronique', help: 'Vérifiez le permis de conduire et un égoportrait du client. PII ne conserve que le résultat : jamais le numéro du permis, les photos ni ce qui a été lu sur la carte.',
    client: 'Client', noClients: 'Ajoutez d’abord le client à cette affaire.', noDob: 'Aucune date de naissance au dossier : la vérification de la date ira à la conformité.',
    stripe: 'Envoyer un lien Stripe Identity', stripeHelp: 'Envoyez ce lien au client. Sur son téléphone, il photographie son permis de conduire et prend un égoportrait sur la page de Stripe. Le résultat s’affiche ici.',
    copy: 'Copier le lien', copied: 'Copié',
    own: 'Vérifier les photos ici', ownHelp: 'Téléversez la photo du permis et l’égoportrait fournis par le client. Google Gemini de PII les lit une fois; rien n’est conservé. Seules les photos sont envoyées, aucun renseignement sur le client.',
    licence: 'Recto du permis de conduire', selfie: 'Égoportrait du client', consent: 'Le client a accepté cette vérification et m’a remis ces photos', read: 'Lire le permis', reading: 'Lecture des photos…',
    result: 'Résultat de la vérification', readName: 'Nom sur le permis', readDob: 'Date de naissance', readExpiry: 'Expire le', concerns: 'Points à vérifier',
    looked: (n: string) => `J’ai regardé le permis et l’égoportrait, et ils montrent ${n}`, confirm: 'Confirmer', allClear: 'Tout concorde. La confirmation inscrit le client comme vérifié.', notClear: 'Un élément ne concorde pas. La confirmation envoie cette vérification à la conformité.',
    history: 'Vérifications de cette affaire', cancel: 'Annuler', by: 'par', decided: 'Décidé par', note: 'Note de décision (au moins 10 caractères, aucun numéro de pièce)', accept: 'Accepter comme vérifié', reject: 'Refuser',
    name_matches: 'Le nom concorde avec le dossier', dob_matches: 'La date de naissance concorde', not_expired: 'Non expiré', selfie_matches: 'L’égoportrait correspond à la photo', looks_genuine: 'Semble authentique',
    route_stripe: 'Stripe Identity', route_own_check: 'Vérification PII', redacted: 'Copie de Stripe supprimée',
    st: { link_sent: 'Lien envoyé', processing: 'Vérification par Stripe', needs_input: 'Le client doit recommencer', needs_confirmation: 'En attente de votre confirmation', needs_review: 'En attente de la conformité', verified: 'Vérifié', failed: 'Échoué', canceled: 'Annulé' } as Record<string, string>,
    reasons: { name_mismatch: 'Le nom diffère du dossier', name_not_read: 'Nom illisible', name_missing_on_record: 'Aucun nom au dossier', dob_mismatch: 'La date de naissance diffère du dossier', dob_not_read: 'Date de naissance illisible', dob_missing_on_record: 'Aucune date de naissance au dossier', expiry_not_read: 'Date d’expiration illisible', document_expired: 'Le permis est expiré', selfie_mismatch: 'L’égoportrait ne correspond pas', selfie_unclear: 'Égoportrait peu clair', document_doubtful: 'Le permis pourrait ne pas être authentique', genuineness_unclear: 'Authenticité incertaine', not_a_drivers_licence: 'Ce n’est pas un permis de conduire' } as Record<string, string>,
    stripeReason: 'Stripe :',
    settings: 'Identité électronique', settingsHelp: 'Comment votre entreprise vérifie le permis de conduire et l’égoportrait d’un client. Dans les deux cas, PII ne conserve que le résultat.',
    useStripe: 'Stripe Identity (le client utilise un lien sur son téléphone)', useOwn: 'Vérification de PII (un conseiller téléverse les photos; Google Gemini les lit; la conformité tranche les écarts)',
    redact: 'Demander à Stripe de supprimer les photos et les renseignements personnels une fois le résultat reçu', notOnServer: 'non configuré sur ce serveur', save: 'Enregistrer', saved: 'Enregistré',
  },
};
type X = (typeof T)['en'];
const CHECKS = ['name_matches', 'dob_matches', 'not_expired', 'selfie_matches', 'looks_genuine'] as const;
const mark = (v: boolean | null | undefined) => (v === true ? '✓' : v === false ? '✗' : '?');
const reasonText = (x: X, r: string) => (r.startsWith('stripe:') ? `${x.stripeReason} ${r.slice(7).replace(/_/g, ' ')}` : x.reasons[r] ?? r);

interface Check { id: string; contactId: string; clientName: string; route: 'stripe' | 'own_check'; status: string; issuingRegion: string | null; checks: Record<string, boolean | null>; reasons: string[]; requestedBy: string; requestedById: string; decidedBy: string | null; decisionNote: string | null; redactedAtStripe: boolean; createdAt: string }
interface Data { stripeOn: boolean; ownCheckOn: boolean; clients: { id: string; name: string; hasDob: boolean }[]; checks: Check[]; canReview: boolean }
interface Own { id: string; checks: Record<string, boolean | null>; reasons: string[]; allClear: boolean; read: { fullName: string | null; dateOfBirth: string | null; expiryDate: string | null; concerns: string[] } }

function CheckList({ x, checks }: { x: X; checks: Record<string, boolean | null> }) {
  return <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0' }}>{CHECKS.filter((k) => k in checks).map((k) => <li key={k}><span aria-hidden="true" style={{ display: 'inline-block', width: '1.4em', color: checks[k] === true ? 'var(--ok)' : checks[k] === false ? 'var(--danger, #b42318)' : 'inherit' }}>{mark(checks[k])}</span>{x[k]}</li>)}</ul>;
}

/** The electronic ID check on a deal's ID & AML tab. */
export function EidCard({ boxId, call, locale, canEdit, onChange }: { boxId: string; call: Call; locale: Locale; canEdit: boolean; onChange?: () => void }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<Data | null>(null);
  const [contact, setContact] = useState('');
  const [err, setErr] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'none' | 'own'>('none');
  const [files, setFiles] = useState<{ licence: File | null; selfie: File | null }>({ licence: null, selfie: null });
  const [urls, setUrls] = useState<{ licence?: string; selfie?: string }>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState<Own | null>(null);
  const [looked, setLooked] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = () => call('GET', `/v1/boxes/${boxId}/eid`).then((r: Data) => { setD(r); setContact((c) => c || r.clients[0]?.id || ''); }, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  useEffect(() => () => { Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)); }, [urls]);
  if (!d || (!d.stripeOn && !d.ownCheckOn && !d.checks.length)) return null;
  const go = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); onChange?.(); } catch (e) { setErr(msg(e)); } };
  const client = d.clients.find((c) => c.id === contact);
  const pick = (k: 'licence' | 'selfie', f: File | null) => {
    setFiles({ ...files, [k]: f });
    if (urls[k]) URL.revokeObjectURL(urls[k]!);
    setUrls({ ...urls, [k]: f ? URL.createObjectURL(f) : undefined });
    setOwn(null); setLooked(false);
  };
  const read = async () => {
    if (!files.licence || !files.selfie) return;
    setBusy(true); setErr('');
    try {
      const r = await call('POST', `/v1/boxes/${boxId}/eid/own-check`, { contactId: contact, consentConfirmed: consent,
        licence: { mime: files.licence.type || 'image/jpeg', dataBase64: await toB64(files.licence) }, selfie: { mime: files.selfie.type || 'image/jpeg', dataBase64: await toB64(files.selfie) } });
      setOwn(r); await load();
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const reset = () => { setMode('none'); setOwn(null); setLooked(false); setConsent(false); pick('licence', null); setFiles({ licence: null, selfie: null }); setUrls({}); };
  const box = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  const cb = { width: 'auto', margin: 0, minHeight: 0 } as const;
  const thumb = { maxWidth: '220px', maxHeight: '150px', borderRadius: '6px', border: '1px solid var(--line, #ddd)', display: 'block', marginTop: '4px' } as const;
  return (
    <section aria-label={x.title} style={{ marginBottom: '16px' }}>
      <h3>{x.title}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {canEdit && (d.stripeOn || d.ownCheckOn) && (
        d.clients.length === 0 ? <p class="muted">{x.noClients}</p> : <div>
          <label class="fld">{x.client}<select aria-label={x.client} value={contact} onChange={(e) => { setContact((e.target as HTMLSelectElement).value); setLink(null); reset(); }}>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {client && !client.hasDob && <p class="muted">{x.noDob}</p>}
          <div class="actions" style={{ gap: '8px' }}>
            {d.stripeOn && <button type="button" class="btn quiet" onClick={() => void go(async () => { const r = await call('POST', `/v1/boxes/${boxId}/eid/stripe`, { contactId: contact }); setLink(r.url); setCopied(false); })}>{x.stripe}</button>}
            {d.ownCheckOn && mode === 'none' && <button type="button" class="btn quiet" onClick={() => { setMode('own'); setLink(null); }}>{x.own}</button>}
          </div>
          {link && <div class="hcard" style={{ marginTop: '8px' }}>
            <p class="muted" style={{ marginTop: 0 }}>{x.stripeHelp}</p>
            <div style={{ display: 'flex', gap: '8px' }}><input aria-label="Stripe Identity link" readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
              <button type="button" class="btn quiet" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined); }}>{copied ? x.copied : x.copy}</button></div>
          </div>}
          {mode === 'own' && <div class="hcard" style={{ marginTop: '8px' }}>
            <p class="muted" style={{ marginTop: 0 }}>{x.ownHelp}</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {(['licence', 'selfie'] as const).map((k) => <label key={k} class="fld" style={{ flex: '1 1 220px' }}>{x[k]}<input aria-label={x[k]} type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={(e) => pick(k, (e.target as HTMLInputElement).files?.[0] ?? null)} />{urls[k] && <img src={urls[k]} alt={x[k]} style={thumb} />}</label>)}
            </div>
            <label style={box}><input type="checkbox" style={cb} checked={consent} onChange={() => setConsent(!consent)} />{x.consent}</label>
            {!own && <div class="actions"><button type="button" class="btn" disabled={!files.licence || !files.selfie || !consent || busy} onClick={() => void read()}>{x.read}</button> <button type="button" class="btn quiet" onClick={reset}>{x.cancel}</button></div>}
            {busy && <p class="muted" role="status">{x.reading}</p>}
            {own && <div aria-label={x.result}>
              <h4 style={{ margin: '10px 0 2px' }}>{x.result}</h4>
              <CheckList x={x} checks={own.checks} />
              <p class="muted" style={{ margin: '4px 0' }}>{x.readName}: <strong>{own.read.fullName ?? '?'}</strong> · {x.readDob}: <strong>{own.read.dateOfBirth ?? '?'}</strong> · {x.readExpiry}: <strong>{own.read.expiryDate ?? '?'}</strong></p>
              {own.reasons.length > 0 && <p style={{ margin: '4px 0' }}>{own.reasons.map((r) => reasonText(x, r)).join(' · ')}</p>}
              {own.read.concerns.length > 0 && <p class="muted" style={{ margin: '4px 0' }}>{x.concerns}: {own.read.concerns.join('; ')}</p>}
              <p role="status" style={{ margin: '6px 0' }}>{own.allClear ? x.allClear : x.notClear}</p>
              <label style={box}><input type="checkbox" style={cb} checked={looked} onChange={() => setLooked(!looked)} />{x.looked(client?.name ?? '')}</label>
              <div class="actions"><button type="button" class="btn" disabled={!looked} onClick={() => void go(async () => { await call('POST', `/v1/eid/${own.id}/confirm`, { lookedAtPhotos: true }); reset(); })}>{x.confirm}</button></div>
            </div>}
          </div>}
        </div>
      )}
      {d.checks.length > 0 && <div style={{ marginTop: '10px' }}>
        <h4 style={{ margin: '0 0 4px' }}>{x.history}</h4>
        {d.checks.map((c) => <div class="ev" key={c.id}>
          <strong>{c.clientName}: {x.st[c.status] ?? c.status}</strong> <small>{c.route === 'stripe' ? x.route_stripe : x.route_own_check}{c.issuingRegion ? ` (${c.issuingRegion})` : ''} · {new Date(c.createdAt).toLocaleDateString(locale)} · {x.by} {c.requestedBy}{c.redactedAtStripe ? ` · ${x.redacted}` : ''}</small>
          {Object.keys(c.checks).length > 0 && <CheckList x={x} checks={c.checks} />}
          {c.reasons.length > 0 && <div><small>{c.reasons.map((r) => reasonText(x, r)).join(' · ')}</small></div>}
          {c.decidedBy && <div><small>{x.decided} {c.decidedBy}{c.decisionNote ? `: ${c.decisionNote}` : ''}</small></div>}
          {canEdit && ['link_sent', 'processing', 'needs_input'].includes(c.status) && <button type="button" class="link" onClick={() => void go(() => call('POST', `/v1/eid/${c.id}/cancel`))}>{x.cancel}</button>}
          {d.canReview && c.status === 'needs_review' && <div style={{ marginTop: '4px' }}>
            <label class="fld">{x.note}<textarea aria-label={x.note} rows={2} value={notes[c.id] ?? ''} onInput={(e) => setNotes({ ...notes, [c.id]: (e.target as HTMLTextAreaElement).value })} /></label>
            <div class="actions" style={{ gap: '8px' }}>
              <button type="button" class="btn" disabled={(notes[c.id] ?? '').trim().length < 10} onClick={() => void go(() => call('POST', `/v1/eid/${c.id}/review`, { decision: 'verified', note: notes[c.id] }))}>{x.accept}</button>
              <button type="button" class="btn quiet" disabled={(notes[c.id] ?? '').trim().length < 10} onClick={() => void go(() => call('POST', `/v1/eid/${c.id}/review`, { decision: 'failed', note: notes[c.id] }))}>{x.reject}</button>
            </div>
          </div>}
        </div>)}
      </div>}
    </section>
  );
}

/** Settings: which routes the company uses. Only a tenant admin or compliance can change it. */
export function EidSettingsCard({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [s, setS] = useState<{ stripeEnabled: boolean; ownCheckEnabled: boolean; redactAtStripe: boolean; stripeAvailable: boolean; ownCheckAvailable: boolean; canChange: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', '/v1/eid/settings').then(setS, () => setS(null)); }, [call]);
  if (!s || !s.canChange) return null;
  const box = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  const cb = { width: 'auto', margin: 0, minHeight: 0 } as const;
  const set = (k: 'stripeEnabled' | 'ownCheckEnabled' | 'redactAtStripe') => { setS({ ...s, [k]: !s[k] }); setSaved(false); };
  return (
    <section class="hcard" aria-label={x.settings} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.settings}</h3>
      <p class="muted">{x.settingsHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      <label style={box}><input type="checkbox" style={cb} disabled={!s.stripeAvailable} checked={s.stripeEnabled} onChange={() => set('stripeEnabled')} />{x.useStripe}{!s.stripeAvailable && <span class="muted"> ({x.notOnServer})</span>}</label>
      {s.stripeEnabled && <label style={{ ...box, marginLeft: '24px' }}><input type="checkbox" style={cb} checked={s.redactAtStripe} onChange={() => set('redactAtStripe')} />{x.redact}</label>}
      <label style={box}><input type="checkbox" style={cb} disabled={!s.ownCheckAvailable} checked={s.ownCheckEnabled} onChange={() => set('ownCheckEnabled')} />{x.useOwn}{!s.ownCheckAvailable && <span class="muted"> ({x.notOnServer})</span>}</label>
      <div class="actions">{saved ? <span role="status">{x.saved}</span> : <button type="button" class="btn quiet" onClick={() => { setErr(''); call('PUT', '/v1/eid/settings', { stripeEnabled: s.stripeEnabled, ownCheckEnabled: s.ownCheckEnabled, redactAtStripe: s.redactAtStripe }).then((r) => { setS(r); setSaved(true); }, (e) => setErr(msg(e))); }}>{x.save}</button>}</div>
    </section>
  );
}
