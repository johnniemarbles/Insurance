import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const T = {
  'en': { tab: 'ID & AML', id: 'Client identity', idHelp: 'Record how you verified who the client is. Name the document type and issuer only, never the number.', method: 'Method', in_person: 'In person (government photo ID)', credit_file: 'Credit file', dual_process: 'Dual process', docs: 'Documents seen (one per line)', result: 'Result', verified: 'Verified', failed: 'Failed', note: 'Note (optional)', save: 'Save',
    scr: 'PEP and sanctions screening', list: 'List', pep: 'Politically exposed person', sanctions: 'Sanctions', clear: 'Clear', hit: 'Hit', cleared_after_review: 'Cleared after review', review: 'Review note (at least 10 characters)', hitOpen: 'Open hit: this file cannot move to a gated stage until the compliance role clears it.', clearIt: 'Clear after review',
    cash: 'Large cash transactions', cashHelp: 'Cash of $10,000 or more needs a report to FINTRAC, filed outside PII. Record the entry and the reference you were given.', amount: 'Amount', date: 'Date', add: 'Add entry', due: 'Report due', ref: 'Report reference', noteRef: 'Record reference', filed: 'Filed', none: 'Nothing recorded yet.', by: 'by' },
  'fr-CA': { tab: 'Identité et LBA', id: 'Identité du client', idHelp: 'Consignez comment vous avez vérifié l’identité du client. Indiquez le type de document et l’émetteur seulement, jamais le numéro.', method: 'Méthode', in_person: 'En personne (pièce d’identité avec photo)', credit_file: 'Dossier de crédit', dual_process: 'Double processus', docs: 'Documents vus (un par ligne)', result: 'Résultat', verified: 'Vérifiée', failed: 'Échec', note: 'Note (facultatif)', save: 'Enregistrer',
    scr: 'Vérification PPE et sanctions', list: 'Liste', pep: 'Personne politiquement vulnérable', sanctions: 'Sanctions', clear: 'Aucun résultat', hit: 'Correspondance', cleared_after_review: 'Levée après examen', review: 'Note d’examen (au moins 10 caractères)', hitOpen: 'Correspondance ouverte : ce dossier ne peut pas passer à une étape contrôlée avant que la conformité la lève.', clearIt: 'Lever après examen',
    cash: 'Opérations importantes en espèces', cashHelp: 'Une somme de 10 000 $ ou plus exige une déclaration à CANAFE, produite hors de PII. Consignez l’entrée et la référence reçue.', amount: 'Montant', date: 'Date', add: 'Ajouter', due: 'Déclaration à produire', ref: 'Référence de la déclaration', noteRef: 'Consigner la référence', filed: 'Produite', none: 'Rien de consigné.', by: 'par' },
};
interface Aml {
  idRecords: { id: string; method: string; documentsSeen: string[]; result: string; verifiedOn: string; verifier: string; note: string | null }[];
  screenings: { id: string; list: string; result: string; screenedOn: string; reviewer: string; note: string | null }[];
  cash: { id: string; amount: number; currency: string; occurredOn: string; reportRequired: boolean; reportRef: string | null; reportedAt: string | null }[];
  country?: 'CA' | 'US'; canReview: boolean; status: { idVerified: boolean; openHits: string[]; reportsDue: number };
}

/** Client identity checks, PEP/sanctions screening and the large-cash log for one record. */
export function AmlTab({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const base = T[locale] as Record<string, string>;
  const [d, setD] = useState<Aml | null>(null);
  const us = d?.country === 'US';
  // The US server names FinCEN and Form 8300 and uses OFAC for sanctions; the PEP check is shown as enhanced due diligence.
  const x: Record<string, string> = us ? {
    ...base,
    cashHelp: locale === 'fr-CA' ? 'Une somme de 10 000 $ ou plus en espèces exige habituellement le formulaire 8300 (FinCEN), produit hors de PII dans les 15 jours. Consignez l’entrée et la référence reçue. À confirmer avec le conseiller juridique.' : 'Cash of $10,000 or more usually needs IRS/FinCEN Form 8300, filed outside PII within 15 days. Record the entry and the reference you were given. Counsel confirms the rule for your business.',
    scr: locale === 'fr-CA' ? 'Vérification OFAC et vigilance renforcée' : 'OFAC sanctions and enhanced due diligence',
    pep: locale === 'fr-CA' ? 'Personnalité exposée (vigilance renforcée)' : 'Politically exposed person (enhanced due diligence)',
    sanctions: locale === 'fr-CA' ? 'Sanctions OFAC' : 'OFAC sanctions',
  } : base;
  const [err, setErr] = useState('');
  const [idf, setIdf] = useState({ method: 'in_person', result: 'verified', docs: '', note: '' });
  const [sf, setSf] = useState({ list: 'pep', result: 'clear', note: '' });
  const [cf, setCf] = useState({ amount: '', date: new Date().toISOString().slice(0, 10) });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const load = () => call('GET', `/v1/boxes/${boxId}/aml`).then(setD, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [boxId]);
  const go = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!d) return <div class="rec-form">{err && <div class="err" role="alert">{err}</div>}</div>;
  return (
    <div class="rec-form">
      {err && <div class="err" role="alert">{err}</div>}
      <h3>{x.id} {d.status.idVerified ? '✓' : ''}</h3>
      <p class="muted">{x.idHelp}</p>
      {d.idRecords.map((r) => <div class="ev" key={r.id}><strong>{x[r.result]}</strong> <small>{x[r.method]} · {r.verifiedOn} · {x.by} {r.verifier}{r.documentsSeen.length ? ` · ${r.documentsSeen.join(', ')}` : ''}</small></div>)}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); void go(async () => { await call('POST', `/v1/boxes/${boxId}/id-records`, { method: idf.method, result: idf.result, documentsSeen: idf.docs.split('\n').map((s) => s.trim()).filter(Boolean), ...(idf.note ? { note: idf.note } : {}) }); setIdf({ ...idf, docs: '', note: '' }); }); }}>
          <label class="fld">{x.method}<select value={idf.method} onChange={(e) => setIdf({ ...idf, method: (e.target as HTMLSelectElement).value })}>{['in_person', 'credit_file', 'dual_process'].map((m) => <option value={m}>{x[m]}</option>)}</select></label>
          <label class="fld">{x.docs}<textarea rows={2} value={idf.docs} onInput={(e) => setIdf({ ...idf, docs: (e.target as HTMLTextAreaElement).value })} /></label>
          <label class="fld">{x.result}<select value={idf.result} onChange={(e) => setIdf({ ...idf, result: (e.target as HTMLSelectElement).value })}><option value="verified">{x.verified}</option><option value="failed">{x.failed}</option></select></label>
          <button class="btn quiet">{x.save}</button>
        </form>
      )}
      <h3 style={{ marginTop: '14px' }}>{x.scr}</h3>
      {d.status.openHits.length > 0 && <div class="err" role="alert">{x.hitOpen}</div>}
      {d.screenings.map((s) => <div class="ev" key={s.id}><strong>{x[s.list]}: {x[s.result]}</strong> <small>{s.screenedOn} · {x.by} {s.reviewer}{s.note ? ` · ${s.note}` : ''}</small></div>)}
      {(canEdit || d.canReview) && (
        <form onSubmit={(e) => { e.preventDefault(); void go(async () => { await call('POST', `/v1/boxes/${boxId}/screenings`, { list: sf.list, result: sf.result, ...(sf.note ? { note: sf.note } : {}) }); setSf({ ...sf, note: '' }); }); }}>
          <label class="fld">{x.list}<select value={sf.list} onChange={(e) => setSf({ ...sf, list: (e.target as HTMLSelectElement).value })}>{['pep', 'sanctions'].map((m) => <option value={m}>{x[m]}</option>)}</select></label>
          <label class="fld">{x.result}<select value={sf.result} onChange={(e) => setSf({ ...sf, result: (e.target as HTMLSelectElement).value })}>
            <option value="clear">{x.clear}</option><option value="hit">{x.hit}</option>{d.canReview && d.status.openHits.includes(sf.list) && <option value="cleared_after_review">{x.clearIt}</option>}</select></label>
          <label class="fld">{x.review}<input value={sf.note} onInput={(e) => setSf({ ...sf, note: (e.target as HTMLInputElement).value })} /></label>
          <button class="btn quiet">{x.save}</button>
        </form>
      )}
      <h3 style={{ marginTop: '14px' }}>{x.cash} {d.status.reportsDue > 0 ? `(${d.status.reportsDue} ${x.due})` : ''}</h3>
      <p class="muted">{x.cashHelp}</p>
      {d.cash.length === 0 && <p class="muted">{x.none}</p>}
      {d.cash.map((c) => (
        <div class="ev" key={c.id}><strong>{c.amount.toLocaleString(locale)} {c.currency}</strong> <small>{c.occurredOn}</small>
          {c.reportRequired && (c.reportedAt ? <small> · {x.filed}: {c.reportRef}</small> : canEdit && <span> <input aria-label={x.ref} placeholder={x.ref} value={refs[c.id] ?? ''} onInput={(e) => setRefs({ ...refs, [c.id]: (e.target as HTMLInputElement).value })} /> <button class="btn quiet" disabled={!refs[c.id]?.trim()} onClick={() => void go(() => call('POST', `/v1/cash/${c.id}/report`, { reference: refs[c.id] }))}>{x.noteRef}</button></span>)}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); void go(async () => { await call('POST', `/v1/boxes/${boxId}/cash`, { amount: Number(cf.amount), occurredOn: cf.date }); setCf({ ...cf, amount: '' }); }); }}>
          <input type="number" step="0.01" min="0.01" required aria-label={x.amount} placeholder={x.amount} value={cf.amount} onInput={(e) => setCf({ ...cf, amount: (e.target as HTMLInputElement).value })} />{' '}
          <input type="date" required aria-label={x.date} value={cf.date} onInput={(e) => setCf({ ...cf, date: (e.target as HTMLInputElement).value })} />{' '}
          <button class="btn quiet">{x.add}</button>
        </form>
      )}
    </div>
  );
}
export const amlTabLabel = (locale: Locale) => T[locale].tab;
