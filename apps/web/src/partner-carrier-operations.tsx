import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Contract = { id: string; nodeId: string; carrierName: string; jurisdiction: string; state: string; effectiveState?: string; appointmentReference?: string | null; appointmentEffectiveOn?: string | null; appointmentExpiresOn?: string | null; updatedAt?: string };
type Submission = { id: string; contractId: string; submissionMode: string; status: string; submittedAt?: string; responseReference?: string | null };
type Event = { id: string; contractId: string; toState: string; actorName?: string | null; recordedAt: string };
function formatDate(d?: string | null, loc: Locale = 'en', includeTime = false) {
  if (!d) return '—';
  try {
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? d : (includeTime ? parsed.toLocaleString(loc) : parsed.toLocaleDateString(loc));
  } catch {
    return d;
  }
}

export function PartnerCarrierOperations({ call, locale, partnerId, openCarrierDashboard }: {
  call: Call; locale: Locale; partnerId: string; openCarrierDashboard: () => void;
}) {
  const fr = locale === 'fr-CA';
  const [cases, setCases] = useState<Contract[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const refresh = () => {
    setLoading(true); setError('');
    void call('GET', '/v1/compliance/carrier-dashboard').then(r => {
      const scoped = ((r.cases ?? []) as Contract[]).filter(c => c.nodeId === partnerId);
      const ids = new Set(scoped.map(c => c.id));
      setCases(scoped);
      setSubmissions(((r.submissions ?? []) as Submission[]).filter(s => ids.has(s.contractId)));
      setEvents(((r.auditEvents ?? []) as Event[]).filter(e => ids.has(e.contractId)));
      setLoading(false);
    }, () => { setError(fr ? 'Les données de contrats ne sont pas disponibles pour ce rôle.' : 'Contracting data is unavailable for this role.'); setLoading(false); });
  };
  useEffect(() => { refresh(); }, [call, partnerId, locale]);
  return <section class="pd-carrier-ops">
    <div class="pd-heading"><div><h3>{fr ? 'Contrats et nominations' : 'Contracting & appointments'}</h3>
      <p class="muted">{fr ? 'Dossiers de cet organisme uniquement.' : 'Contract cases for this partner only.'}</p></div>
      <button class="btn" type="button" disabled={loading} onClick={refresh}>{fr ? 'Actualiser' : 'Refresh'}</button>
    </div>
    {loading ? <p role="status">{fr ? 'Chargement…' : 'Loading contracting cases…'}</p> : error ? <p role="alert">{error}</p> : <>
      <div class="pd-profile-facts">
        <div><small>{fr ? 'Dossiers' : 'Cases'}</small><strong>{cases.length}</strong></div>
        <div><small>{fr ? 'Envois enregistrés' : 'Recorded submissions'}</small><strong>{submissions.length}</strong></div>
      </div>
      {cases.length === 0 ? <p class="muted">{fr ? 'Aucun dossier de contrat enregistré.' : 'No carrier contracting cases recorded for this partner.'}</p> :
        cases.map(c => <article class="pd-ops-case" key={c.id}>
          <div class="pd-profile-line"><div><strong>{c.carrierName || 'Carrier'}</strong><p class="muted">{c.jurisdiction || '—'}</p></div>
            <span class="pt-pill">{c.effectiveState || c.state || '—'}</span></div>
          <div class="pd-profile-line"><span>{fr ? 'Dernière modification' : 'Last updated'}</span><span>{formatDate(c.updatedAt, locale)}</span></div>
          <button class="btn quiet" type="button" aria-expanded={expanded === c.id} onClick={() => setExpanded(v => v === c.id ? null : c.id)}>
            {expanded === c.id ? (fr ? 'Masquer les détails' : 'Hide details') : (fr ? 'Voir les détails' : 'View details')}
          </button>
          {expanded === c.id && <div>
            <div class="pd-profile-line"><span>{fr ? 'Référence de nomination' : 'Appointment reference'}</span><strong>{c.appointmentReference || '—'}</strong></div>
            <div class="pd-profile-line"><span>{fr ? 'Date de début' : 'Effective date'}</span><span>{formatDate(c.appointmentEffectiveOn, locale)}</span></div>
            <div class="pd-profile-line"><span>{fr ? 'Date d’expiration' : 'Expiry date'}</span><span>{formatDate(c.appointmentExpiresOn, locale)}</span></div>
            <h4>{fr ? 'Soumissions' : 'Submissions'}</h4>
            {submissions.filter(s => s.contractId === c.id).map(s => <div class="pd-profile-line" key={s.id}><span>{s.submissionMode} · {s.status}</span><small>{formatDate(s.submittedAt, locale, true)}</small></div>)}
            <h4>{fr ? 'Historique' : 'Audit history'}</h4>
            {events.filter(e => e.contractId === c.id).map(e => <div class="pd-profile-line" key={e.id}><span>{e.toState}</span><small>{formatDate(e.recordedAt, locale, true)}</small></div>)}
          </div>}
        </article>)}
      <p class="muted">{fr ? 'La signature, la soumission et la vérification restent soumises aux autorisations et contrôles du tableau de bord assureurs.' : 'Signing, submission and appointment verification remain subject to carrier dashboard authorization and evidence controls.'}</p>
      <button type="button" class="btn primary" onClick={openCarrierDashboard}>{fr ? 'Ouvrir le centre de conformité' : 'Open compliance dashboard'} ↗</button>
    </>}
  </section>;
}
