import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Result = { state: 'loading' | 'ready' | 'error'; value?: any; error?: string };
const SOURCES = [
  { key: 'overview', path: '/v1/compliance/overview' },
  { key: 'clearance', path: '/v1/compliance/clearance' },
  { key: 'risk', path: '/v1/compliance/files-at-risk' },
  { key: 'onboarding', path: '/v1/onboarding/dashboard' },
  { key: 'carriers', path: '/v1/compliance/carrier-contracts' },
] as const;
type Key = typeof SOURCES[number]['key'];
const initial = () => Object.fromEntries(SOURCES.map(s => [s.key, { state: 'loading' }])) as Record<Key, Result>;

export function ComplianceCommandCenter({ call, locale, onNavigate }: {
  call: Call; locale: Locale; onNavigate: (section: 'files' | 'onboarding' | 'carriers') => void;
}) {
  const fr = locale === 'fr-CA';
  const [results, setResults] = useState<Record<Key, Result>>(initial);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setResults(initial());
    for (const source of SOURCES) {
      void call('GET', source.path).then(value => {
        if (active) setResults(prev => ({ ...prev, [source.key]: { state: 'ready', value } }));
      }, error => {
        if (active) setResults(prev => ({ ...prev, [source.key]: { state: 'error', error: error instanceof Error ? error.message : String(error) } }));
      });
    }
    return () => { active = false; };
  }, [call, revision]);
  const summary = results.overview;
  const clearance = results.clearance;
  const risk = results.risk;
  const onboarding = results.onboarding;
  const carriers = results.carriers;
  const cards: { key: Key; label: string; count: number | undefined; section: 'files' | 'onboarding' | 'carriers' }[] = [
    { key: 'overview', label: fr ? 'Documents expirés' : 'Expired records', count: summary.value?.expired, section: 'files' },
    { key: 'overview', label: fr ? 'Expirations (90 jours)' : 'Expiring in 90 days', count: summary.value?.expiring90, section: 'files' },
    { key: 'clearance', label: fr ? 'Dossiers non validés' : 'Not cleared', count: clearance.value?.notCleared?.length, section: 'files' },
    { key: 'risk', label: fr ? 'Dossiers à risque' : 'Files at risk', count: risk.value?.files?.length, section: 'files' },
    { key: 'onboarding', label: fr ? 'Rapports en retard' : 'Overdue reports', count: onboarding.value?.selfReports?.overdue, section: 'onboarding' },
    { key: 'onboarding', label: fr ? 'Contrôles périodiques en retard' : 'Overdue rechecks', count: onboarding.value?.rechecks?.overdue, section: 'onboarding' },
    { key: 'carriers', label: fr ? 'Dossiers assureurs' : 'Carrier contract cases', count: Array.isArray(carriers.value) ? carriers.value.length : carriers.value?.contracts?.length, section: 'carriers' },
  ];
  const errors = SOURCES.filter(s => results[s.key].state === 'error');
  return <section class="obwrap" aria-label={fr ? 'Tableau de bord conformité' : 'Compliance command center'}>
    <div class="obcard">
      <div class="obrow"><div><h2>{fr ? 'Centre de contrôle conformité' : 'Compliance command center'}</h2>
        <p class="muted">{fr ? 'Données visibles selon vos autorisations. Les comptes ne constituent pas une attestation de conformité.' : 'Live records within your authorized scope. Counts are not a certification of compliance.'}</p></div>
        <button class="btn" type="button" onClick={() => setRevision(x => x + 1)}>{fr ? 'Actualiser' : 'Refresh'}</button></div>
      {errors.length > 0 && <div role="alert" class="err"><strong>{fr ? 'Certaines données ne sont pas disponibles' : 'Some data could not be loaded'}</strong>
        {errors.map(s => <p key={s.key}>{s.key}: {results[s.key].error}</p>)}</div>}
      <div class="hstats">
        {cards.map(c => <button type="button" class="hstat" key={c.label} onClick={() => onNavigate(c.section)}
          aria-label={c.label + ', ' + (results[c.key].state === 'ready' && typeof c.count === 'number' ? c.count : fr ? 'indisponible' : 'unavailable')}>
          <b>{results[c.key].state === 'loading' ? '…' : results[c.key].state === 'error' || typeof c.count !== 'number' ? '—' : c.count}</b>
          <span>{c.label}</span>
        </button>)}
      </div>
    </div>
    <div class="obcard">
      <h3>{fr ? 'Accès aux opérations' : 'Operational workspaces'}</h3>
      <div class="obrow">
        <button class="btn" type="button" onClick={() => onNavigate('files')}>{fr ? 'Dossiers et documents' : 'Broker files and evidence'}</button>
        <button class="btn" type="button" onClick={() => onNavigate('onboarding')}>{fr ? 'Intégration' : 'Onboarding and deadlines'}</button>
        <button class="btn" type="button" onClick={() => onNavigate('carriers')}>{fr ? 'Contrats assureurs' : 'Carrier contracting'}</button>
      </div>
    </div>
  </section>;
}
