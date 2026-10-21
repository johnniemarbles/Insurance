// Network evidence packs (roadmap Phase 3, feature 13) on the Compliance page. Hidden unless the server has
// EVIDENCE_PACKS_ENABLED on (404) and the viewer is compliance or a tenant admin (403).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;

const T = {
  en: {
    title: 'Evidence packs', help: 'One download for a partner, a carrier, or a regulator\'s request: the registers for the period, each partner\'s compliance file and each client file, with a SHA-256 manifest. PII keeps a record of every pack, so anyone holding one can check it is unchanged.',
    scope: 'Pack for', partner: 'A partner', carrier: 'A carrier', regulator: 'A regulator request', which: 'Which', ref: 'Request reference (e.g. the regulator\'s letter number)', from: 'From', to: 'To',
    deals: 'Client files to include (optional, one deal name per line as shown in PII)', make: 'Make the pack', making: 'Building the pack…',
    done: (d: number, f: string) => `Downloaded: ${d} client file${d === 1 ? '' : 's'}. Fingerprint ${f.slice(0, 16)}…`, history: 'Packs issued', none: 'None yet.',
    verify: 'Check a pack', verifyHelp: 'Paste the fingerprint: the SHA-256 of the pack\'s manifest.json (it is also in its README).', check: 'Check', issued: (l: string, d: string, by: string) => `Issued by PII: ${l}, ${d}, by ${by}.`, notIssued: 'PII did not issue a pack with this fingerprint. The pack may have been changed.',
    scopes: { partner: 'Partner', carrier: 'Carrier', regulator: 'Regulator' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Dossiers de preuves', help: 'Un seul téléchargement pour un partenaire, un assureur ou une demande d’un organisme de réglementation : les registres de la période, le dossier de conformité de chaque partenaire et chaque dossier client, avec un manifeste SHA-256. PII consigne chaque dossier émis; quiconque en détient un peut vérifier qu’il est inchangé.',
    scope: 'Dossier pour', partner: 'Un partenaire', carrier: 'Un assureur', regulator: 'Une demande d’un organisme de réglementation', which: 'Lequel', ref: 'Référence de la demande (p. ex. le numéro de la lettre)', from: 'Du', to: 'Au',
    deals: 'Dossiers clients à inclure (facultatif, un nom d’affaire par ligne, tel qu’il figure dans PII)', make: 'Créer le dossier', making: 'Création du dossier…',
    done: (d: number, f: string) => `Téléchargé : ${d} dossier(s) client. Empreinte ${f.slice(0, 16)}…`, history: 'Dossiers émis', none: 'Aucun pour l’instant.',
    verify: 'Vérifier un dossier', verifyHelp: 'Collez l’empreinte : le SHA-256 du manifest.json du dossier (elle figure aussi dans le README).', check: 'Vérifier', issued: (l: string, d: string, by: string) => `Émis par PII : ${l}, ${d}, par ${by}.`, notIssued: 'PII n’a émis aucun dossier avec cette empreinte. Le dossier a peut-être été modifié.',
    scopes: { partner: 'Partenaire', carrier: 'Assureur', regulator: 'Organisme de réglementation' } as Record<string, string>,
  },
};
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export function EvidencePacksPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [o, setO] = useState<{ partners: { id: string; name: string }[]; carriers: { id: string; name: string }[]; history: { id: string; scope: string; scopeLabel: string; from: string; to: string; dealCount: number; manifestSha256: string; exportedBy: string; createdAt: string }[] } | null>(null);
  const [f, setF] = useState({ scope: 'partner', partnerId: '', carrierId: '', requestReference: '', from: yearStart(), to: today(), deals: '' });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const [err, setErr] = useState('');
  const [fp, setFp] = useState('');
  const [vr, setVr] = useState('');
  const load = () => call('GET', '/v1/evidence-packs/options').then((r) => { setO(r); setF((s) => ({ ...s, partnerId: s.partnerId || r.partners[0]?.id || '', carrierId: s.carrierId || r.carriers[0]?.id || '' })); }, () => setO(null));
  useEffect(() => { void load(); }, []);
  if (!o) return null;
  const make = async () => {
    setBusy(true); setErr(''); setOk('');
    try {
      const dealNames = f.scope === 'regulator' ? f.deals.split('\n').map((v) => v.trim()).filter(Boolean) : [];
      const r = await call('POST', '/v1/evidence-packs', { scope: f.scope, from: f.from, to: f.to, ...(f.scope === 'partner' ? { partnerId: f.partnerId } : f.scope === 'carrier' ? { carrierId: f.carrierId } : { requestReference: f.requestReference, ...(dealNames.length ? { dealNames } : {}) }) });
      const a = document.createElement('a');
      a.href = `data:${r.mime};base64,${r.dataBase64}`; a.download = r.filename; document.body.append(a); a.click(); a.remove();
      setOk(x.done(r.deals, r.fingerprint)); void load();
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <section class="hcard rec-form" aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.title}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      <div class="two">
        <label class="fld">{x.scope}<select aria-label={x.scope} value={f.scope} onChange={(e) => setF({ ...f, scope: (e.target as HTMLSelectElement).value })}>{(['partner', 'carrier', 'regulator'] as const).map((s) => <option key={s} value={s}>{x[s]}</option>)}</select></label>
        {f.scope === 'partner' && <label class="fld">{x.which}<select aria-label={x.which} value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: (e.target as HTMLSelectElement).value })}>{o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {f.scope === 'carrier' && <label class="fld">{x.which}<select aria-label={x.which} value={f.carrierId} onChange={(e) => setF({ ...f, carrierId: (e.target as HTMLSelectElement).value })}>{o.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        {f.scope === 'regulator' && <label class="fld">{x.ref}<input aria-label={x.ref} maxLength={200} value={f.requestReference} onInput={(e) => setF({ ...f, requestReference: (e.target as HTMLInputElement).value })} /></label>}
      </div>
      <div class="two">
        <label class="fld">{x.from}<input aria-label={x.from} type="date" value={f.from} onInput={(e) => setF({ ...f, from: (e.target as HTMLInputElement).value })} /></label>
        <label class="fld">{x.to}<input aria-label={x.to} type="date" value={f.to} onInput={(e) => setF({ ...f, to: (e.target as HTMLInputElement).value })} /></label>
      </div>
      {f.scope === 'regulator' && <label class="fld">{x.deals}<textarea aria-label={x.deals} rows={2} style={{ display: 'block', width: '100%' }} value={f.deals} onInput={(e) => setF({ ...f, deals: (e.target as HTMLTextAreaElement).value })} /></label>}
      <div class="actions"><button type="button" class="btn" disabled={busy || (f.scope === 'regulator' && !f.requestReference.trim()) || (f.scope === 'partner' && !f.partnerId) || (f.scope === 'carrier' && !f.carrierId)} onClick={() => void make()}>{busy ? x.making : x.make}</button></div>
      {ok && <p role="status">{ok}</p>}
      <h4 style={{ margin: '14px 0 4px' }}>{x.history}</h4>
      {o.history.length === 0 && <p class="muted">{x.none}</p>}
      {o.history.map((h) => <div class="ev" key={h.id}><strong>{x.scopes[h.scope]}: {h.scopeLabel}</strong> <small>· {h.from} → {h.to} · {h.dealCount} · {new Date(h.createdAt).toLocaleString(locale)} · {h.exportedBy}</small><div><small class="muted" style={{ fontFamily: 'monospace' }}>{h.manifestSha256}</small></div></div>)}
      <h4 style={{ margin: '14px 0 4px' }}>{x.verify}</h4>
      <p class="muted" style={{ margin: '0 0 4px' }}>{x.verifyHelp}</p>
      <div style={{ display: 'flex', gap: '8px' }}><input aria-label={x.verify} value={fp} onInput={(e) => { setFp((e.target as HTMLInputElement).value.trim()); setVr(''); }} style={{ fontFamily: 'monospace' }} />
        <button type="button" class="btn quiet" disabled={!/^[0-9a-fA-F]{64}$/.test(fp)} onClick={() => { call('POST', '/v1/evidence-packs/verify', { fingerprint: fp }).then((r) => setVr(r.issued ? x.issued(r.scopeLabel, new Date(r.createdAt).toLocaleString(locale), r.exportedBy) : x.notIssued), (e) => setErr(msg(e))); }}>{x.check}</button></div>
      {vr && <p role="status">{vr}</p>}
    </section>
  );
}
