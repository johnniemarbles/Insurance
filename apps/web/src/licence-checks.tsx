// Licence checks against the regulators (roadmap Phase 3, feature 12) on the Compliance page. Hidden unless the server
// has LICENCE_CHECKS_ENABLED on (404) and the viewer is compliance or a tenant admin (403).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;
const toB64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

const T = {
  en: {
    title: 'Licence checks', help: (d: number) => `Check each partner's licence on the regulator's public register every ${d} days. Open the register, save the result as a PDF or screenshot, and upload it here: PII reads it and compares it with the licence on file. A suspended, revoked, lapsed or missing licence stops the partner being cleared to transact.`,
    none: 'No licences on file in Ontario or British Columbia yet.', due: 'Due', notDue: 'Next', adverse: 'Problem', never: 'Never checked', other: 'Other province: not checked here', open: 'Open the register', check: 'Check', cancel: 'Cancel',
    upload: 'Saved register result (PDF, PNG or JPEG)', read: 'Read it', reading: 'Reading…', found: 'What the register shows', holder: 'Name', number: 'Licence number', klass: 'Class', expiry: 'Expires', conditions: 'Conditions', discipline: 'Discipline',
    nameOk: 'Name matches the file', numberOk: 'Number matches the file', status: 'Status', note: 'Note (required for a problem)', save: 'Record the check', manual: 'No Gemini key on this server: record the result by hand and attach the saved page.',
    st: { active: 'Active', active_conditions: 'Active with conditions', suspended: 'Suspended', revoked: 'Revoked', lapsed: 'Lapsed', not_found: 'Not found', unclear: 'Unclear' } as Record<string, string>,
    concerns: { name_mismatch: 'Name differs from the file', number_mismatch: 'Number differs from the file', discipline: 'Discipline shown', expiry_differs: 'Expiry differs from the file', status_suspended: 'Suspended', status_revoked: 'Revoked', status_lapsed: 'Lapsed', status_not_found: 'Not found on the register' } as Record<string, string>,
    last: (s: string, d: string, by: string) => `Last check ${d}: ${s}, by ${by}`, saved: 'Check recorded.',
  },
  'fr-CA': {
    title: 'Vérification des permis', help: (d: number) => `Vérifiez le permis de chaque partenaire au registre public de l’organisme de réglementation tous les ${d} jours. Ouvrez le registre, enregistrez le résultat en PDF ou en capture d’écran et téléversez-le ici : PII le lit et le compare au permis au dossier. Un permis suspendu, révoqué, échu ou introuvable retire l’autorisation de transiger.`,
    none: 'Aucun permis de l’Ontario ou de la Colombie-Britannique au dossier.', due: 'À faire', notDue: 'Prochaine', adverse: 'Problème', never: 'Jamais vérifié', other: 'Autre province : non vérifié ici', open: 'Ouvrir le registre', check: 'Vérifier', cancel: 'Annuler',
    upload: 'Résultat du registre enregistré (PDF, PNG ou JPEG)', read: 'Lire', reading: 'Lecture…', found: 'Ce que montre le registre', holder: 'Nom', number: 'Numéro de permis', klass: 'Catégorie', expiry: 'Expire le', conditions: 'Conditions', discipline: 'Mesures disciplinaires',
    nameOk: 'Le nom concorde avec le dossier', numberOk: 'Le numéro concorde avec le dossier', status: 'Statut', note: 'Note (obligatoire en cas de problème)', save: 'Consigner la vérification', manual: 'Aucune clé Gemini sur ce serveur : consignez le résultat à la main et joignez la page enregistrée.',
    st: { active: 'Actif', active_conditions: 'Actif avec conditions', suspended: 'Suspendu', revoked: 'Révoqué', lapsed: 'Échu', not_found: 'Introuvable', unclear: 'Incertain' } as Record<string, string>,
    concerns: { name_mismatch: 'Le nom diffère du dossier', number_mismatch: 'Le numéro diffère du dossier', discipline: 'Mesures disciplinaires', expiry_differs: 'L’échéance diffère du dossier', status_suspended: 'Suspendu', status_revoked: 'Révoqué', status_lapsed: 'Échu', status_not_found: 'Introuvable au registre' } as Record<string, string>,
    last: (s: string, d: string, by: string) => `Dernière vérification ${d} : ${s}, par ${by}`, saved: 'Vérification consignée.',
  },
};
const ADVERSE = ['suspended', 'revoked', 'lapsed', 'not_found'];
interface Lic { id: string; partner: string; label: string; number: string | null; jurisdiction: string | null; expiresOn: string | null; regulator: string; regulatorName: string | null; register: string | null; due: boolean; adverse: boolean; latest: { status: string; checkedOn: string; nextDueOn: string; checkedBy: string } | null }
interface Read { read: { holderName: string | null; licenceNumber: string | null; licenceClass: string | null; expiryDate: string | null; conditions: string[]; disciplinaryActions: string[] }; status: string; nameMatches: boolean | null; numberMatches: boolean | null; disciplineFound: boolean; concerns: string[] }

export function LicenceChecksPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ licences: Lic[]; days: number; readerAvailable: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Read | null>(null);
  const [status, setStatus] = useState('active');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const load = () => call('GET', '/v1/licence-checks').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const shown = d.licences.filter((l) => l.regulator !== 'other');
  const reset = () => { setOpen(null); setFile(null); setRes(null); setStatus('active'); setNote(''); };
  const evidence = async () => (file ? { filename: file.name.slice(0, 120), mime: file.type, dataBase64: await toB64(file) } : undefined);
  const read = async (id: string) => { setBusy(true); setErr(''); try { const r: Read = await call('POST', '/v1/licence-checks/read', { itemId: id, evidence: await evidence() }); setRes(r); setStatus(r.status); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const save = async (id: string) => {
    setBusy(true); setErr('');
    try {
      await call('POST', '/v1/licence-checks', { itemId: id, method: res ? 'register_read' : 'manual', status, ...(res ? { nameMatches: res.nameMatches, numberMatches: res.numberMatches, disciplineFound: res.disciplineFound, expiryRead: res.read.expiryDate } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(file ? { evidence: await evidence() } : {}) });
      reset(); setOk(x.saved); await load();
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const tick = (v: boolean | null) => (v === true ? '✓' : v === false ? '✗' : '?');
  return (
    <section class="hcard rec-form" aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.title}</h3>
      <p class="muted">{x.help(d.days)}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {ok && <p role="status">{ok}</p>}
      {shown.length === 0 && <p class="muted">{x.none}</p>}
      {shown.map((l) => <div class="ev" key={l.id}>
        <strong>{l.partner}</strong> <small>· {l.label}{l.number ? ` · ${l.number}` : ''} · {l.jurisdiction} · {l.regulatorName}</small>
        <div><small>
          {l.adverse ? <strong style={{ color: 'var(--danger, #b42318)' }}>{x.adverse}: {x.st[l.latest!.status]}</strong> : l.due ? <strong style={{ color: 'var(--warn, #b54708)' }}>{x.due}</strong> : <span class="muted">{x.notDue} {l.latest?.nextDueOn}</span>}
          {' · '}{l.latest ? x.last(x.st[l.latest.status] ?? l.latest.status, l.latest.checkedOn, l.latest.checkedBy) : x.never}
        </small></div>
        {open !== l.id ? <div class="actions" style={{ gap: '8px', marginTop: '2px' }}>
          {l.register && <a class="link" href={l.register} target="_blank" rel="noopener noreferrer">{x.open} ↗</a>}
          <button type="button" class="link" onClick={() => { reset(); setOk(''); setOpen(l.id); }}>{x.check}</button>
        </div> : <div class="hcard" style={{ marginTop: '6px' }}>
          {!d.readerAvailable && <p class="muted" style={{ marginTop: 0 }}>{x.manual}</p>}
          <label class="fld">{x.upload}<input aria-label={x.upload} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => { setFile((e.target as HTMLInputElement).files?.[0] ?? null); setRes(null); }} /></label>
          {d.readerAvailable && <div class="actions"><button type="button" class="btn quiet" disabled={!file || busy} onClick={() => void read(l.id)}>{busy && !res ? x.reading : x.read}</button></div>}
          {res && <div aria-label={x.found}>
            <h4 style={{ margin: '8px 0 4px' }}>{x.found}</h4>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 30%) 1fr', gap: '2px 12px', margin: 0 }}>
              <dt class="muted">{x.holder}</dt><dd style={{ margin: 0 }}>{res.read.holderName ?? '?'} <small>{tick(res.nameMatches)} {x.nameOk}</small></dd>
              <dt class="muted">{x.number}</dt><dd style={{ margin: 0 }}>{res.read.licenceNumber ?? '?'} <small>{tick(res.numberMatches)} {x.numberOk}</small></dd>
              <dt class="muted">{x.klass}</dt><dd style={{ margin: 0 }}>{res.read.licenceClass ?? '?'}</dd>
              <dt class="muted">{x.expiry}</dt><dd style={{ margin: 0 }}>{res.read.expiryDate ?? '?'}</dd>
              {res.read.conditions.length > 0 && <><dt class="muted">{x.conditions}</dt><dd style={{ margin: 0 }}>{res.read.conditions.join('; ')}</dd></>}
              {res.read.disciplinaryActions.length > 0 && <><dt class="muted">{x.discipline}</dt><dd style={{ margin: 0 }}>{res.read.disciplinaryActions.join('; ')}</dd></>}
            </dl>
            {res.concerns.length > 0 && <p class="err" style={{ margin: '6px 0' }}>{res.concerns.map((c) => x.concerns[c] ?? c).join(' · ')}</p>}
          </div>}
          <label class="fld">{x.status}<select aria-label={x.status} value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>{Object.keys(x.st).map((k) => <option key={k} value={k}>{x.st[k]}</option>)}</select></label>
          <label class="fld">{x.note}<textarea aria-label={x.note} rows={2} maxLength={500} style={{ display: 'block', width: '100%' }} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="actions" style={{ gap: '8px' }}>
            <button type="button" class="btn" disabled={busy || (ADVERSE.includes(status) && note.trim().length < 10) || (!res && !file && !note.trim())} onClick={() => void save(l.id)}>{x.save}</button>
            <button type="button" class="btn quiet" onClick={reset}>{x.cancel}</button>
          </div>
        </div>}
      </div>)}
    </section>
  );
}
