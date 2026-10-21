// Conduct risk flags (roadmap Phase 3, feature 11) on the Compliance page, and the complaints log on a deal's Files tab.
// Hidden unless the server has CONDUCT_FLAGS_ENABLED on (a 404 hides it).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number, l: Locale) => `$${Math.round(v).toLocaleString(l)}`;

const T = {
  en: {
    title: 'Conduct risk flags', help: 'Patterns a supervisor should look at, worked out from PII\'s own records with plain rules. Each flag says why. Record what you decided; the flag stays quiet until its numbers change.',
    none: 'No open flags.', showAll: 'Show reviewed flags too', high: 'High', medium: 'Medium', low: 'Low', advisor: 'Advisor', client: 'Client', deal: 'Deal',
    why: {
      replacement_churn: (n: Record<string, number>) => `${n.replacements} of ${n.recommendations} recommendations in the last 12 months replaced existing cover (${pct(n.share!)}).`,
      early_lapse: (n: Record<string, number>) => `${n.early} of ${n.issued} policies issued lapsed or were cancelled within 24 months (${pct(n.rate!)}).`,
      many_policies: (n: Record<string, number>) => `On ${n.policies} policies that started in the last 24 months.`,
      premium_to_income: (n: Record<string, number>, l: Locale) => `Annual premium ${money(n.annualPremium!, l)} is ${pct(n.share!)} of household income ${money(n.income!, l)}.`,
      complaints: (n: Record<string, number>) => `${n.complaints} complaints in the last 12 months.`,
      complaint_unresolved: (n: Record<string, number>) => `${n.open} complaint${n.open === 1 ? '' : 's'} open for more than 30 days.`,
      missing_review: (n: Record<string, number>) => `Owns ${n.policies} polic${n.policies === 1 ? 'y' : 'ies'} more than a year old, with no signed needs analysis in 24 months.`,
    } as Record<string, (n: Record<string, number>, l: Locale) => string>,
    names: { replacement_churn: 'Replacement churn', early_lapse: 'Early lapses', many_policies: 'Many policies', premium_to_income: 'Premium high for income', complaints: 'Complaints', complaint_unresolved: 'Complaint not resolved', missing_review: 'No recent review' } as Record<string, string>,
    note: 'What you found (at least 10 characters)', noConcern: 'No concern', action: 'Action taken', last: (d: string, by: string, n: string) => `Last decision: ${d} by ${by}: ${n}`, changed: 'Numbers have changed since.',
    decisions: { no_concern: 'no concern', action_taken: 'action taken' } as Record<string, string>,
    cTitle: 'Complaints', cHelp: 'Log every complaint about this client\'s file, however it arrived. Compliance resolves it.', cNone: 'No complaints.', received: 'Received', channel: 'How', category: 'About', summary: 'What the client says (at least 10 characters)', add: 'Log complaint',
    open: 'Open', resolved: 'Resolved', outcome: 'Outcome (at least 10 characters)', resolve: 'Resolve', by: 'by',
    channels: { email: 'Email', phone: 'Phone', letter: 'Letter', in_person: 'In person', regulator: 'From the regulator', carrier: 'From the insurer', other: 'Other' } as Record<string, string>,
    categories: { advice: 'Advice', service: 'Service', disclosure: 'Disclosure', claims: 'Claims', premium: 'Premium', privacy: 'Privacy', conduct: 'Conduct', other: 'Other' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Signaux de risque de conduite', help: 'Situations qu’un superviseur devrait examiner, calculées à partir des dossiers de PII selon des règles simples. Chaque signal explique pourquoi. Consignez votre décision; le signal reste silencieux tant que ses chiffres ne changent pas.',
    none: 'Aucun signal ouvert.', showAll: 'Afficher aussi les signaux examinés', high: 'Élevé', medium: 'Moyen', low: 'Faible', advisor: 'Conseiller', client: 'Client', deal: 'Affaire',
    why: {
      replacement_churn: (n: Record<string, number>) => `${n.replacements} recommandations sur ${n.recommendations} des 12 derniers mois ont remplacé une garantie existante (${pct(n.share!)}).`,
      early_lapse: (n: Record<string, number>) => `${n.early} polices sur ${n.issued} sont tombées en déchéance ou ont été annulées en moins de 24 mois (${pct(n.rate!)}).`,
      many_policies: (n: Record<string, number>) => `Partie à ${n.policies} polices entrées en vigueur ces 24 derniers mois.`,
      premium_to_income: (n: Record<string, number>, l: Locale) => `La prime annuelle de ${money(n.annualPremium!, l)} représente ${pct(n.share!)} du revenu du ménage de ${money(n.income!, l)}.`,
      complaints: (n: Record<string, number>) => `${n.complaints} plaintes ces 12 derniers mois.`,
      complaint_unresolved: (n: Record<string, number>) => `${n.open} plainte(s) ouverte(s) depuis plus de 30 jours.`,
      missing_review: (n: Record<string, number>) => `Titulaire de ${n.policies} police(s) de plus d’un an, sans analyse des besoins signée depuis 24 mois.`,
    } as Record<string, (n: Record<string, number>, l: Locale) => string>,
    names: { replacement_churn: 'Remplacements fréquents', early_lapse: 'Déchéances précoces', many_policies: 'Nombreuses polices', premium_to_income: 'Prime élevée par rapport au revenu', complaints: 'Plaintes', complaint_unresolved: 'Plainte non réglée', missing_review: 'Aucune revue récente' } as Record<string, string>,
    note: 'Ce que vous avez constaté (au moins 10 caractères)', noConcern: 'Aucune préoccupation', action: 'Mesures prises', last: (d: string, by: string, n: string) => `Dernière décision : ${d} par ${by} : ${n}`, changed: 'Les chiffres ont changé depuis.',
    decisions: { no_concern: 'aucune préoccupation', action_taken: 'mesures prises' } as Record<string, string>,
    cTitle: 'Plaintes', cHelp: 'Consignez toute plainte concernant ce dossier, peu importe sa provenance. La conformité la règle.', cNone: 'Aucune plainte.', received: 'Reçue le', channel: 'Moyen', category: 'Sujet', summary: 'Ce que dit le client (au moins 10 caractères)', add: 'Consigner la plainte',
    open: 'Ouverte', resolved: 'Réglée', outcome: 'Issue (au moins 10 caractères)', resolve: 'Régler', by: 'par',
    channels: { email: 'Courriel', phone: 'Téléphone', letter: 'Lettre', in_person: 'En personne', regulator: 'De l’organisme de réglementation', carrier: 'De l’assureur', other: 'Autre' } as Record<string, string>,
    categories: { advice: 'Conseils', service: 'Service', disclosure: 'Divulgation', claims: 'Réclamations', premium: 'Prime', privacy: 'Vie privée', conduct: 'Conduite', other: 'Autre' } as Record<string, string>,
  },
};
const COLOR = { high: 'var(--danger, #b42318)', medium: 'var(--warn, #b54708)', low: 'var(--muted, #6b7280)' } as Record<string, string>;
interface Flag { subjectType: string; subjectId: string; subjectName: string; code: string; severity: string; numbers: Record<string, number>; fingerprint: string; open: boolean; lastReview: { decision: string; note: string; by: string; at: string; sameNumbers: boolean } | null }

export function ConductFlagsPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ flags: Flag[]; open: number } | null>(null);
  const [all, setAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/conduct/flags').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const key = (f: Flag) => `${f.subjectType}:${f.subjectId}:${f.code}`;
  const shown = d.flags.filter((f) => all || f.open);
  const decide = (f: Flag, decision: string) => { setErr(''); call('POST', '/v1/conduct/flags/review', { subjectType: f.subjectType, subjectId: f.subjectId, code: f.code, fingerprint: f.fingerprint, decision, note: notes[key(f)] }).then(() => load(), (e) => setErr(msg(e))); };
  const box = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  return (
    <section class="hcard rec-form" aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.title} ({d.open})</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      <label style={box}><input type="checkbox" style={{ width: 'auto', margin: 0, minHeight: 0 }} checked={all} onChange={() => setAll(!all)} />{x.showAll}</label>
      {shown.length === 0 && <p class="muted">{x.none}</p>}
      {shown.map((f) => <div class="ev" key={key(f)} style={{ opacity: f.open ? 1 : 0.65 }}>
        <strong>{x.names[f.code] ?? f.code}</strong> <small style={{ color: COLOR[f.severity] }}>● {x[f.severity as 'high']}</small> <small class="muted">· {x[f.subjectType as 'advisor']}: {f.subjectName}</small>
        <div><small>{x.why[f.code]?.(f.numbers, locale) ?? ''}</small></div>
        {f.lastReview && <div><small class="muted">{x.last(new Date(f.lastReview.at).toLocaleDateString(locale), f.lastReview.by, `${x.decisions[f.lastReview.decision]}, ${f.lastReview.note}`)}{f.lastReview.sameNumbers ? '' : ` ${x.changed}`}</small></div>}
        {f.open && <div>
          <label class="fld">{x.note}<textarea aria-label={`${x.note}: ${x.names[f.code]} ${f.subjectName}`} rows={2} style={{ display: 'block', width: '100%' }} value={notes[key(f)] ?? ''} onInput={(e) => setNotes({ ...notes, [key(f)]: (e.target as HTMLTextAreaElement).value })} /></label>
          <div class="actions" style={{ gap: '8px' }}>
            <button type="button" class="btn quiet" disabled={(notes[key(f)] ?? '').trim().length < 10} onClick={() => decide(f, 'no_concern')}>{x.noConcern}</button>
            <button type="button" class="btn" disabled={(notes[key(f)] ?? '').trim().length < 10} onClick={() => decide(f, 'action_taken')}>{x.action}</button>
          </div>
        </div>}
      </div>)}
    </section>
  );
}

export function ComplaintsCard({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ complaints: { id: string; receivedOn: string; channel: string; category: string; summary: string; recordedBy: string; status: string; outcome: string | null; resolvedOn: string | null; resolvedBy: string | null }[]; canResolve: boolean } | null>(null);
  const [f, setF] = useState({ receivedOn: new Date().toISOString().slice(0, 10), channel: 'email', category: 'advice', summary: '' });
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/complaints`).then(setD, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  if (!d) return null;
  const can = canEdit || d.canResolve;
  return (
    <section class="rec-form" aria-label={x.cTitle} style={{ marginTop: '16px' }}>
      <h3>{x.cTitle}</h3>
      <p class="muted">{x.cHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.complaints.length === 0 && <p class="muted">{x.cNone}</p>}
      {d.complaints.map((c) => <div class="ev" key={c.id}>
        <strong>{c.status === 'open' ? x.open : x.resolved}: {x.categories[c.category]}</strong> <small>· {x.received} {c.receivedOn} · {x.channels[c.channel]} · {x.by} {c.recordedBy}</small>
        <div><small>{c.summary}</small></div>
        {c.outcome && <div><small><strong>{x.resolved} {c.resolvedOn} ({c.resolvedBy}):</strong> {c.outcome}</small></div>}
        {c.status === 'open' && d.canResolve && <div>
          <label class="fld">{x.outcome}<textarea aria-label={x.outcome} rows={2} style={{ display: 'block', width: '100%' }} value={outcomes[c.id] ?? ''} onInput={(e) => setOutcomes({ ...outcomes, [c.id]: (e.target as HTMLTextAreaElement).value })} /></label>
          <div class="actions"><button type="button" class="btn quiet" disabled={(outcomes[c.id] ?? '').trim().length < 10} onClick={() => { setErr(''); call('POST', `/v1/complaints/${c.id}/resolve`, { outcome: outcomes[c.id] }).then(() => load(), (e) => setErr(msg(e))); }}>{x.resolve}</button></div>
        </div>}
      </div>)}
      {can && <div class="hcard" style={{ marginTop: '8px' }}>
        <div class="two">
          <label class="fld">{x.received}<input aria-label={x.received} type="date" value={f.receivedOn} onInput={(e) => setF({ ...f, receivedOn: (e.target as HTMLInputElement).value })} /></label>
          <label class="fld">{x.channel}<select aria-label={x.channel} value={f.channel} onChange={(e) => setF({ ...f, channel: (e.target as HTMLSelectElement).value })}>{Object.keys(x.channels).map((k) => <option key={k} value={k}>{x.channels[k]}</option>)}</select></label>
        </div>
        <label class="fld">{x.category}<select aria-label={x.category} value={f.category} onChange={(e) => setF({ ...f, category: (e.target as HTMLSelectElement).value })}>{Object.keys(x.categories).map((k) => <option key={k} value={k}>{x.categories[k]}</option>)}</select></label>
        <label class="fld">{x.summary}<textarea aria-label={x.summary} rows={2} style={{ display: 'block', width: '100%' }} value={f.summary} onInput={(e) => setF({ ...f, summary: (e.target as HTMLTextAreaElement).value })} /></label>
        <div class="actions"><button type="button" class="btn quiet" disabled={f.summary.trim().length < 10} onClick={() => { setErr(''); call('POST', `/v1/boxes/${boxId}/complaints`, f).then(() => { setF({ ...f, summary: '' }); void load(); }, (e) => setErr(msg(e))); }}>{x.add}</button></div>
      </div>}
    </section>
  );
}
