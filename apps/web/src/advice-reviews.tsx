// Compliance review of signed advice (PIA Compliance Manual §8 and §14): what is waiting, the decision with findings, and each advisor's
// needs-based selling at a glance.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Review { id: string; adviceId: string; boxId: string; boxName: string; kind: string; title: string; clientName: string; signedAt: string | null; advisor: string; ownFile: boolean; reason: string; flags: string[]; status: 'pending' | 'passed' | 'needs_action'; findings: string | null; reviewer: string | null; createdAt: string; reviewedAt: string | null }
interface Advisor { userId: string; name: string; email: string; needsSigned: number; recommendationsSigned: number; replacements: number; flagged: number; reviewsPending: number; reviewsPassed: number; reviewsNeedsAction: number; needsWaived: number }
interface Summary { advisors: Advisor[]; reviewsPending: number; expired: number; expiringSoon: number; legacyNeeds?: number; pipelinesWithoutGate: { id: string; name: string; owner: string }[] }

const T = {
  'en': {
    h: 'Needs analysis and advice reviews', help: 'Every flagged file and every file from a new advisor is reviewed; a share of the rest is sampled. The sampling rate and the new-advisor period are in Settings, Company rules.',
    waiting: 'Waiting for review', expired: 'Clients with an expired needs analysis', soon: 'Expiring in 30 days', noGate: 'Life pipelines with no needs-analysis gate', legacy: 'Free-text needs analyses still counted',
    queue: 'Review queue', show: 'Show', st: { pending: 'Waiting', passed: 'Passed', needs_action: 'Needs action', all: 'All' }, none: 'Nothing here.',
    why: { flagged: 'Flagged', new_advisor: 'New advisor', random: 'Random sample', requested: 'Requested' },
    flag: { below_need: 'Below the calculated need', over_budget: 'Over budget', replacement: 'Replacement', client_chose_less: 'Client chose less', need_overridden: 'Need set by advisor' },
    kind: { needs_analysis: 'Needs analysis', recommendation: 'Recommendation', beneficiary_designation: 'Beneficiary designation', replacement_disclosure: 'Replacement disclosure' },
    by: 'Advisor', client: 'Client', open: 'Record', findings: 'Findings (at least 10 characters)', pass: 'Passed', act: 'Needs action', own: 'This is your own advice; another compliance person must review it.',
    adv: 'By advisor (last 12 months)', cols: ['Advisor', 'Needs analyses', 'Recommendations', 'Replacements', 'Flagged', 'Waiting', 'Passed', 'Needs action', 'Needs analysis waived'], decided: 'Decided by',
  },
  'fr-CA': {
    h: 'Analyses des besoins et revues de conseils', help: 'Chaque dossier signalé et chaque dossier d’un nouveau conseiller est revu; une part des autres est échantillonnée. Le taux et la période sont dans Paramètres, Règles de l’entreprise.',
    waiting: 'En attente de revue', expired: 'Clients dont l’analyse des besoins est expirée', soon: 'Expirent dans 30 jours', noGate: 'Pipelines vie sans exigence d’analyse des besoins', legacy: 'Analyses en texte libre encore comptées',
    queue: 'File de revue', show: 'Afficher', st: { pending: 'En attente', passed: 'Réussies', needs_action: 'Mesures demandées', all: 'Toutes' }, none: 'Rien ici.',
    why: { flagged: 'Signalé', new_advisor: 'Nouveau conseiller', random: 'Échantillon aléatoire', requested: 'Demandée' },
    flag: { below_need: 'Inférieur au besoin calculé', over_budget: 'Au-dessus du budget', replacement: 'Remplacement', client_chose_less: 'Le client a choisi moins', need_overridden: 'Besoin fixé par le conseiller' },
    kind: { needs_analysis: 'Analyse des besoins', recommendation: 'Recommandation', beneficiary_designation: 'Désignation de bénéficiaire', replacement_disclosure: 'Divulgation de remplacement' },
    by: 'Conseiller', client: 'Client', open: 'Dossier', findings: 'Constats (au moins 10 caractères)', pass: 'Réussie', act: 'Mesures demandées', own: 'Il s’agit de votre propre conseil; une autre personne de la conformité doit le revoir.',
    adv: 'Par conseiller (12 derniers mois)', cols: ['Conseiller', 'Analyses des besoins', 'Recommandations', 'Remplacements', 'Signalés', 'En attente', 'Réussies', 'Mesures', 'Analyse levée'], decided: 'Décidé par',
  },
};

export function AdviceReviewsPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale];
  const [sum, setSum] = useState<Summary | null>(null);
  const [status, setStatus] = useState<'pending' | 'passed' | 'needs_action' | 'all'>('pending');
  const [rows, setRows] = useState<Review[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(false);
  const load = () => Promise.all([call('GET', '/v1/compliance/needs-analysis/summary'), call('GET', `/v1/compliance/advice-reviews?status=${status}`)])
    .then(([s, r]) => { setSum(s); setRows(r.reviews); setHidden(false); }, () => setHidden(true)); // people without the compliance role see nothing
  useEffect(() => { void load(); }, [status]);
  const decide = async (id: string, outcome: 'passed' | 'needs_action') => {
    setErr('');
    try { await call('POST', `/v1/compliance/advice-reviews/${id}/decide`, { outcome, findings: (notes[id] ?? '').trim() }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
  if (hidden || (!sum && !err)) return null;
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {sum && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
        {([[x.waiting, sum.reviewsPending], [x.expired, sum.expired], [x.soon, sum.expiringSoon], [x.legacy, sum.legacyNeeds ?? 0], [x.noGate, sum.pipelinesWithoutGate.length]] as [string, number][]).map(([k, v]) => (
          <div key={k} class="hcard" style={{ minWidth: '140px', padding: '8px 12px' }}><div style={{ fontSize: '1.6em', fontWeight: 700, color: v > 0 ? '#b3261e' : undefined }}>{v}</div><small class="muted">{k}</small></div>
        ))}
      </div>}
      {sum && sum.pipelinesWithoutGate.length > 0 && <p class="muted">{x.noGate}: {sum.pipelinesWithoutGate.map((p) => `${p.name} (${p.owner})`).join(', ')}</p>}
      <h4>{x.queue}</h4>
      <label class="fld" style={{ maxWidth: '220px' }}>{x.show}<select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as typeof status)}>
        {(['pending', 'needs_action', 'passed', 'all'] as const).map((k) => <option value={k}>{x.st[k]}</option>)}
      </select></label>
      {rows.length === 0 && <p class="muted">{x.none}</p>}
      {rows.map((r) => (
        <div class="ev" key={r.id}>
          <strong>{x.kind[r.kind as keyof typeof x.kind] ?? r.kind}: {r.title}</strong> <small>{x.why[r.reason as keyof typeof x.why] ?? r.reason} · {x.by} {r.advisor} · {x.client} {r.clientName} · {when(r.createdAt)}</small>
          {r.flags.length > 0 && <small style={{ display: 'block', color: '#8a5a00' }}>⚑ {r.flags.map((f) => x.flag[f as keyof typeof x.flag] ?? f).join(' · ')}</small>}
          <small style={{ display: 'block' }}>{x.open}: {r.boxName}</small>
          {r.status !== 'pending' && <small style={{ display: 'block', color: r.status === 'passed' ? '#137333' : '#b3261e' }}>{x.st[r.status]} — {r.findings} ({x.decided} {r.reviewer}{r.reviewedAt ? `, ${when(r.reviewedAt)}` : ''})</small>}
          {r.status === 'pending' && (r.ownFile ? <small class="muted" style={{ display: 'block' }}>{x.own}</small> : (
            <div style={{ marginTop: '4px' }}>
              <textarea aria-label={x.findings} placeholder={x.findings} rows={2} style={{ width: '100%' }} value={notes[r.id] ?? ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLTextAreaElement).value })} />
              <button class="btn" disabled={(notes[r.id] ?? '').trim().length < 10} onClick={() => void decide(r.id, 'passed')}>✓ {x.pass}</button>{' '}
              <button class="btn quiet" disabled={(notes[r.id] ?? '').trim().length < 10} onClick={() => void decide(r.id, 'needs_action')}>⚠ {x.act}</button>
            </div>
          ))}
        </div>
      ))}
      {sum && sum.advisors.length > 0 && <>
        <h4>{x.adv}</h4>
        <div style={{ overflowX: 'auto' }}>
          <table class="obtable" style={{ minWidth: '640px' }}>
            <thead><tr>{x.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>{sum.advisors.map((a) => (
              <tr key={a.userId}><th scope="row">{a.name}</th><td>{a.needsSigned}</td><td>{a.recommendationsSigned}</td><td>{a.replacements}</td><td>{a.flagged}</td><td>{a.reviewsPending}</td><td>{a.reviewsPassed}</td><td style={{ color: a.reviewsNeedsAction ? '#b3261e' : undefined }}>{a.reviewsNeedsAction}</td><td>{a.needsWaived}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
