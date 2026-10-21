// File review sampling (roadmap Phase 3, feature 10): the officer's monthly sample on the Compliance page, and the
// findings on a deal's Files tab. Hidden unless the server has FILE_REVIEWS_ENABLED on (a 404 hides it).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;

const T = {
  en: {
    title: 'File reviews', help: (n: number) => `Your sample of deals to review this month (${n} a month, drawn on the 1st): the riskiest first, the rest at random. Work the checklist, then pass the file or record findings with a fix-by date.`,
    draw: 'Draw this month\'s sample', none: 'Nothing to review. Draw the sample, or it will be drawn on the 1st.', review: 'Review', hide: 'Hide',
    reasons: { risk: 'Picked for risk', random: 'Picked at random', requested: 'Added by compliance' } as Record<string, string>,
    risk: { screening_hit: 'open screening hit', replacement: 'replacement', large_amount: 'large amount', cash: 'large cash', new_advisor: 'new advisor', past_findings: 'past findings', no_id: 'no ID record', no_privacy_consent: 'no privacy consent', advice_flags: 'advice flags' } as Record<string, string>,
    st: { open: 'To review', passed: 'Passed', findings: 'Findings to fix', fixed: 'Fixed: check it', closed: 'Closed' } as Record<string, string>,
    items: { id_on_file: 'Client ID on file', privacy_consent: 'Privacy consent on file', needs_analysis_current: 'Signed needs analysis is current', recommendation_linked: 'Signed recommendation answers it',
      replacement_disclosure: 'Replacement disclosure (if replacing)', suitability_decided: 'Suitability check decided', screening_clear: 'Screening done and clear', meeting_notes: 'Meeting notes on file',
      advice_explained: 'Advice and its reasons are explained', documents_legible: 'Documents complete and legible', client_communications: 'Client communications appropriate' } as Record<string, string>,
    yes: 'Yes', no: 'No', na: 'N/A', suggested: 'PII suggests', findings: 'Findings (at least 10 characters)', fixBy: 'Fix by', pass: 'Pass the file', record: 'Record findings',
    advisor: 'Advisor', fixedNote: 'Advisor\'s fix', close: 'Close', reopen: 'Not fixed: reopen', reopenNote: 'What is still not fixed', late: 'Late',
    deal: 'Compliance file reviews', dealHelp: 'Compliance reviewed this deal. Fix any findings by the date shown, then say what you did.', fixNote: 'What you fixed (at least 10 characters)', markFixed: 'Mark fixed', by: 'by',
  },
  'fr-CA': {
    title: 'Revues de dossiers', help: (n: number) => `Votre échantillon d’affaires à revoir ce mois-ci (${n} par mois, tiré le 1er) : les plus risquées d’abord, le reste au hasard. Remplissez la liste de contrôle, puis approuvez le dossier ou consignez les constats avec une date limite.`,
    draw: 'Tirer l’échantillon du mois', none: 'Rien à revoir. Tirez l’échantillon, ou il sera tiré le 1er.', review: 'Revoir', hide: 'Masquer',
    reasons: { risk: 'Choisi selon le risque', random: 'Choisi au hasard', requested: 'Ajouté par la conformité' } as Record<string, string>,
    risk: { screening_hit: 'correspondance de vérification', replacement: 'remplacement', large_amount: 'montant élevé', cash: 'espèces importantes', new_advisor: 'nouveau conseiller', past_findings: 'constats antérieurs', no_id: 'aucune pièce d’identité', no_privacy_consent: 'aucun consentement', advice_flags: 'signalements' } as Record<string, string>,
    st: { open: 'À revoir', passed: 'Approuvé', findings: 'Constats à corriger', fixed: 'Corrigé : à vérifier', closed: 'Fermé' } as Record<string, string>,
    items: { id_on_file: 'Pièce d’identité au dossier', privacy_consent: 'Consentement à la vie privée au dossier', needs_analysis_current: 'Analyse des besoins signée et à jour', recommendation_linked: 'Recommandation signée qui y répond',
      replacement_disclosure: 'Divulgation de remplacement (s’il y a lieu)', suitability_decided: 'Examen de convenance tranché', screening_clear: 'Vérification faite et sans correspondance', meeting_notes: 'Notes de rencontre au dossier',
      advice_explained: 'Conseils et raisons expliqués', documents_legible: 'Documents complets et lisibles', client_communications: 'Communications appropriées avec le client' } as Record<string, string>,
    yes: 'Oui', no: 'Non', na: 'S.O.', suggested: 'Suggestion de PII', findings: 'Constats (au moins 10 caractères)', fixBy: 'À corriger d’ici le', pass: 'Approuver le dossier', record: 'Consigner les constats',
    advisor: 'Conseiller', fixedNote: 'Correction du conseiller', close: 'Fermer', reopen: 'Non corrigé : rouvrir', reopenNote: 'Ce qui n’est pas corrigé', late: 'En retard',
    deal: 'Revues de conformité du dossier', dealHelp: 'La conformité a revu cette affaire. Corrigez les constats d’ici la date indiquée, puis expliquez ce que vous avez fait.', fixNote: 'Ce que vous avez corrigé (au moins 10 caractères)', markFixed: 'Marquer corrigé', by: 'par',
  },
};
type X = (typeof T)['en'];
interface Rev { id: string; boxId: string; dealName: string; reviewer: string; advisor: string | null; reason: string; riskScore: number; riskReasons: string[]; status: string; checklist: Record<string, string>; findings: string | null; fixBy: string | null; late: boolean; fixedNote: string | null; fixedBy: string | null; closedNote: string | null }
const inWeek = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

function Work({ x, call, r, keys, onDone }: { x: X; call: Call; r: Rev; keys: string[]; onDone: () => void }) {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState('');
  const [fixBy, setFixBy] = useState(inWeek());
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', `/v1/file-reviews/${r.id}`).then((d) => { setS(d.suggested); setAnswers({ ...d.suggested, ...d.checklist }); }, (e) => setErr(msg(e))); }, [r.id]);
  if (!s) return err ? <div class="err" role="alert">{err}</div> : null;
  const go = (body: unknown, path = 'decide') => { setErr(''); call('POST', `/v1/file-reviews/${r.id}/${path}`, body).then(onDone, (e) => setErr(msg(e))); };
  const anyNo = Object.values(answers).includes('no');
  const complete = keys.every((k) => answers[k]);
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      {err && <div class="err" role="alert">{err}</div>}
      {r.status === 'open' && <>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}><tbody>{keys.map((k) => (
          <tr key={k} style={{ borderBottom: '1px solid var(--line, #eee)' }}>
            <td style={{ padding: '4px 0' }}>{x.items[k] ?? k}{s[k] ? <small class="muted"> · {x.suggested}: {x[s[k] as 'yes']}</small> : null}</td>
            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} role="radiogroup" aria-label={x.items[k] ?? k}>{(['yes', 'no', 'na'] as const).map((v) => (
              <label key={v} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', marginLeft: '10px', fontWeight: 400 }}><input type="radio" style={{ width: 'auto', margin: 0, minHeight: 0 }} name={`${r.id}-${k}`} checked={answers[k] === v} onChange={() => setAnswers({ ...answers, [k]: v })} />{x[v]}</label>))}</td>
          </tr>))}</tbody></table>
        <label class="fld">{x.findings}<textarea aria-label={x.findings} rows={3} style={{ display: 'block', width: '100%' }} value={findings} onInput={(e) => setFindings((e.target as HTMLTextAreaElement).value)} /></label>
        {anyNo && <label class="fld">{x.fixBy}<input aria-label={x.fixBy} type="date" value={fixBy} onInput={(e) => setFixBy((e.target as HTMLInputElement).value)} /></label>}
        <div class="actions" style={{ gap: '8px' }}>
          {!anyNo && <button type="button" class="btn" disabled={!complete || findings.trim().length < 10} onClick={() => go({ checklist: answers, outcome: 'passed', findings })}>{x.pass}</button>}
          <button type="button" class={anyNo ? 'btn' : 'btn quiet'} disabled={!complete || findings.trim().length < 10} onClick={() => go({ checklist: answers, outcome: 'findings', findings, fixBy })}>{x.record}</button>
        </div>
      </>}
      {r.status === 'fixed' && <>
        <p style={{ margin: 0 }}><strong>{x.fixedNote}</strong> ({r.fixedBy}): {r.fixedNote}</p>
        <label class="fld">{x.reopenNote}<textarea aria-label={x.reopenNote} rows={2} style={{ display: 'block', width: '100%' }} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>
        <div class="actions" style={{ gap: '8px' }}>
          <button type="button" class="btn" onClick={() => go({ action: 'close', ...(note.trim() ? { note } : {}) }, 'close')}>{x.close}</button>
          <button type="button" class="btn quiet" disabled={note.trim().length < 10} onClick={() => go({ action: 'reopen', note, fixBy: inWeek() }, 'close')}>{x.reopen}</button>
        </div>
      </>}
    </div>
  );
}

/** Compliance page: this month's sample for the officer. */
export function FileReviewsPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ reviews: Rev[]; sampleSize: number; checklist: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/file-reviews').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  return (
    <section class="hcard rec-form" aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.title}</h3>
      <p class="muted">{x.help(d.sampleSize)}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.reviews.length === 0 && <p class="muted">{x.none}</p>}
      {d.reviews.map((r) => <div class="ev" key={r.id}>
        <strong>{r.dealName}</strong> <small>· {x.st[r.status]}{r.late ? ` · ${x.late}` : ''} · {x.reasons[r.reason]}{r.riskReasons.length ? ` (${r.riskReasons.map((k) => x.risk[k] ?? k).join(', ')})` : ''}{r.advisor ? ` · ${x.advisor}: ${r.advisor}` : ''}</small>
        {r.findings && r.status !== 'open' && <div><small>{r.findings}{r.fixBy ? ` · ${x.fixBy} ${r.fixBy}` : ''}</small></div>}
        {['open', 'fixed'].includes(r.status) && <div class="actions" style={{ marginTop: '2px' }}><button type="button" class="link" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? x.hide : x.review}</button></div>}
        {open === r.id && <Work x={x} call={call} r={r} keys={d.checklist} onDone={() => { setOpen(null); void load(); }} />}
      </div>)}
      <div class="actions"><button type="button" class="btn quiet" onClick={() => { setErr(''); call('POST', '/v1/file-reviews/draw').then(() => load(), (e) => setErr(msg(e))); }}>{x.draw}</button></div>
    </section>
  );
}

/** A deal's Files tab: reviews of this deal and their findings. */
export function DealFileReviews({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ reviews: Rev[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/file-reviews`).then(setD, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  if (!d || !d.reviews.length) return null;
  return (
    <section class="rec-form" aria-label={x.deal} style={{ marginTop: '16px' }}>
      <h3>{x.deal}</h3>
      <p class="muted">{x.dealHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.reviews.map((r) => <div class="ev" key={r.id}>
        <strong>{x.st[r.status]}</strong>{r.late ? <strong class="err"> · {x.late}</strong> : null} <small>· {x.by} {r.reviewer}{r.fixBy && r.status === 'findings' ? ` · ${x.fixBy} ${r.fixBy}` : ''}</small>
        {r.findings && <div style={{ whiteSpace: 'pre-wrap' }}><small>{r.findings}</small></div>}
        {r.fixedNote && <div><small><strong>{x.fixedNote}:</strong> {r.fixedNote}</small></div>}
        {canEdit && r.status === 'findings' && <div>
          <label class="fld">{x.fixNote}<textarea aria-label={x.fixNote} rows={2} style={{ display: 'block', width: '100%' }} value={notes[r.id] ?? ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLTextAreaElement).value })} /></label>
          <div class="actions"><button type="button" class="btn quiet" disabled={(notes[r.id] ?? '').trim().length < 10} onClick={() => { setErr(''); call('POST', `/v1/file-reviews/${r.id}/fixed`, { note: notes[r.id] }).then(() => load(), (e) => setErr(msg(e))); }}>{x.markFixed}</button></div>
        </div>}
      </div>)}
    </section>
  );
}
