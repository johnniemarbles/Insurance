import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Module = 'crm' | 'compliance' | 'training' | 'learning' | 'audit' | 'onboarding' | 'carriers' | 'notifications';
interface Context {
  version: number; tenantId: string; country: 'CA' | 'US'; roles: string[];
  activeNodeIds: string[]; isTenantAdmin: boolean;
  modules: Record<Module, boolean>; scopes: { id: string; name: string }[];
}
type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string } | { state: 'forbidden' } | { state: 'unavailable' };
const pending = <T,>(): Load<T> => ({ state: 'loading' });

const workspaceNames: Record<Locale, Record<string, string>> = {
  en: {
    admin: 'Executive', manager: 'Manager', partner: 'Broker', compliance: 'Compliance',
    auditor: 'Audit', trainer: 'Training', learner: 'Learning', staff: 'Operations',
  },
  'fr-CA': {
    admin: 'Direction', manager: 'Gestionnaire', partner: 'Courtier', compliance: 'Conformité',
    auditor: 'Vérification', trainer: 'Formation', learner: 'Apprenant', staff: 'Opérations',
  },
};

const priorities: Record<string, Module[]> = {
  admin: ['crm', 'compliance', 'onboarding', 'training', 'learning', 'notifications'],
  manager: ['crm', 'onboarding', 'training', 'learning', 'notifications'],
  partner: ['crm', 'onboarding', 'learning', 'notifications'],
  compliance: ['compliance', 'onboarding', 'carriers', 'notifications'],
  auditor: ['audit', 'notifications'],
  trainer: ['training', 'learning', 'notifications'],
  learner: ['learning', 'notifications'],
  staff: ['crm', 'learning', 'notifications'],
};

const endpoints: Partial<Record<Module, string>> = {
  crm: '/v1/dashboard?days=30',
  audit: '/v1/audit/me',
  notifications: '/v1/notifications?limit=20',
  carriers: '/v1/compliance/carrier-contracts',
  compliance: '/v1/onboarding/dashboard',
  onboarding: '/v1/onboarding/dashboard',
  training: '/v1/training/dashboard',
  learning: '/v1/my/learning',
};

const titles: Record<Locale, Record<Module, string>> = {
  en: {
    crm: 'Pipeline performance', compliance: 'Compliance alerts', onboarding: 'Onboarding',
    carriers: 'Carrier authorizations', learning: 'My learning', training: 'Training and CE', audit: 'Audit engagements',
    notifications: 'Notifications',
  },
  'fr-CA': {
    crm: 'Rendement des dossiers', compliance: 'Alertes de conformité', onboarding: 'Intégration',
    carriers: 'Autorisations assureurs', learning: 'Mon apprentissage', training: 'Formation et UFC', audit: 'Missions d’audit',
    notifications: 'Notifications',
  },
};

const destinations: Record<Module, string> = {
  crm: 'pipelines', compliance: 'compliance', onboarding: 'compliance',
  carriers: 'compliance', learning: 'training', training: 'training', audit: 'compliance', notifications: 'notifications',
};

function Metrics({ module, data, fr }: { module: Module; data: any; fr: boolean }) {
  let entries: [string, string | number][] = [];
  if (module === 'crm' && data?.totals) entries = [
    [fr ? 'Dossiers ouverts' : 'Open records', data.totals.openCount],
    [fr ? 'Gagnés (30 j)' : 'Won (30 days)', data.totals.won],
    [fr ? 'Taux de succès' : 'Win rate', data.totals.winRate == null ? '—' : Math.round(data.totals.winRate * 100) + '%'],
  ];
  if ((module === 'compliance' || module === 'onboarding') && data) entries = [
    [fr ? 'Expirés' : 'Expired', data.expiry?.expired ?? '—'],
    [fr ? 'Expirant bientôt' : 'Expiring soon', data.expiry?.expiringSoon ?? '—'],
    [fr ? 'Rapports en retard' : 'Overdue reports', data.selfReports?.overdue ?? '—'],
    [fr ? 'Réévaluations en retard' : 'Rechecks overdue', data.rechecks?.overdue ?? '—'],
  ];
  if (module === 'carriers' && Array.isArray(data?.contracts)) entries = [
    [fr ? 'Dossiers contrats (max 200)' : 'Contract cases (max 200)', data.contracts.length],
    [fr ? 'Désignations expirées' : 'Expired appointments', data.contracts.filter((x: any) => x.effectiveState === 'expired').length],
    [fr ? 'Dates de désignation valides — non autorisation' : 'Valid appointment dates — not authorization', data.contracts.filter((x: any) => x.appointmentCurrentlyValid === true).length],
  ];
  if (module === 'audit' && Array.isArray(data?.engagements)) entries = [
    [fr ? 'Actives' : 'Active', data.engagements.filter((e: any) => e.status === 'active').length],
    [fr ? 'Visibles' : 'Visible', data.engagements.length],
  ];
  if (module === 'notifications' && Array.isArray(data?.notifications)) entries = [
    [fr ? 'Non lues' : 'Unread', data.unread ?? 0],
    [fr ? 'Récentes' : 'Recent', data.notifications.length],
  ];
  if (module === 'learning' && Array.isArray(data?.enrollments)) entries = [
    [fr ? 'Assignés' : 'Assigned', data.enrollments.length],
    [fr ? 'En cours' : 'In progress', data.enrollments.filter((e: any) => e.status === 'in_progress').length],
    [fr ? 'Complétés' : 'Completed', data.enrollments.filter((e: any) => e.status === 'completed').length],
  ];
  if (module === 'training' && data?.totals) entries = [
    [fr ? 'Assignés' : 'Assigned', data.totals.assigned],
    [fr ? 'En cours' : 'In progress', data.totals.inProgress],
    [fr ? 'Complétés' : 'Completed', data.totals.completed],
    [fr ? 'En retard' : 'Overdue', data.totals.overdue],
  ];
  if (!entries.length) return <p>{fr ? 'Aucune donnée récapitulative disponible. Ouvrez l’espace pour plus de détails.' : 'No summary data is available. Open the workspace for details.'}</p>;
  return (
    <div class="pii-workspace-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '12px' }}>
      {entries.map(([name, value]) => (
        <div class="pii-workspace-metric" key={name} style={{ padding: '12px', borderRadius: '8px', background: 'rgba(125,140,165,.08)' }}>
          <small>{name}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Panel({ module, load, go, fr }: { module: Module; load: Load<any>; go: (page: string) => void; fr: boolean }) {
  const panelTitle = (fr ? titles['fr-CA'] : titles.en)[module];
  return (
    <section class="pii-workspace-panel" style={{ border: '1px solid #dfe5ed', borderRadius: '12px', padding: '20px' }} aria-label={panelTitle}>
      <div class="pii-workspace-panel-head">
        <h2>{panelTitle}</h2>
        <button class="btn" onClick={() => go(destinations[module])}>
          {fr ? 'Ouvrir l’espace' : 'Open workspace'}
        </button>
      </div>
      {load.state === 'loading' ? <p role="status">{fr ? 'Chargement…' : 'Loading…'}</p> :
       load.state === 'forbidden' ? <p>{fr ? 'Accès non accordé pour cet espace de travail.' : 'Access not granted for this workspace.'}</p> :
       load.state === 'unavailable' ? <p>{fr ? 'Sommaire non connecté pour le moment. Ouvrez l’espace spécialisé.' : 'Summary not connected yet. Open the specialist workspace.'}</p> :
       load.state === 'error' ? <p role="alert">{fr ? `Impossible de charger ce sommaire : ${load.message}` : `Could not load this summary: ${load.message}`}</p> :
       <Metrics module={module} data={load.value} fr={fr} />}
    </section>
  );
}

export function UnifiedWorkspace({ call, go, locale, name }: { call: Call; go: (page: string) => void; locale: Locale; name: string }) {
  const fr = locale === 'fr-CA';
  const roleNames = fr ? workspaceNames['fr-CA'] : workspaceNames.en;
  const [context, setContext] = useState<Load<Context>>(pending());
  const [active, setActive] = useState('');
  const [loads, setLoads] = useState<Partial<Record<Module, Load<any>>>>({});
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setContext(pending());
    setLoads({});
    call('GET', '/v1/workspace/context').then(
      (value: Context) => {
        if (cancelled) return;
        setContext({ state: 'ready', value });
        setActive(previous =>
          value.roles.includes(previous)
            ? previous
            : (['admin', 'manager', 'compliance', 'auditor', 'trainer', 'partner', 'learner', 'staff'].find(r => value.roles.includes(r)) ?? 'staff')
        );
      },
      (e: Error) => {
        if (!cancelled) setContext({ state: 'error', message: e.message });
      }
    );
    return () => { cancelled = true; };
  }, [call, generation]);

  useEffect(() => {
    if (context.state !== 'ready') return;
    let cancelled = false;
    const allowed = (priorities[active] ?? []).filter(m => context.value.modules[m]);
    setLoads(Object.fromEntries(allowed.map(m => [m, pending()])));
    for (const m of allowed) {
      const path = endpoints[m];
      if (!path) {
        setLoads(old => ({ ...old, [m]: { state: 'unavailable' } }));
        continue;
      }
      call('GET', path).then(
        value => {
          if (!cancelled) setLoads(old => ({ ...old, [m]: { state: 'ready', value } }));
        },
        (e: Error & { status?: number }) => {
          if (!cancelled) setLoads(old => ({ ...old, [m]: e.status === 403 ? { state: 'forbidden' } : { state: 'error', message: e.message } }));
        }
      );
    }
    return () => { cancelled = true; };
  }, [context, active, call]);

  if (context.state === 'loading') {
    return <div class="pii-workspace"><p role="status">{fr ? 'Chargement de votre espace de travail…' : 'Loading your workspace…'}</p></div>;
  }
  if (context.state === 'error') {
    return (
      <div class="pii-workspace">
        <p role="alert">{fr ? `Erreur de chargement : ${context.message}` : context.message}</p>
        <button class="btn" onClick={() => setGeneration(x => x + 1)}>{fr ? 'Réessayer' : 'Retry'}</button>
      </div>
    );
  }
  if (context.state !== 'ready') return null;

  const c = context.value;
  const visible = (priorities[active] ?? []).filter(m => c.modules[m]);
  const activeRoleName = roleNames[active] ?? (fr ? 'Personnel' : 'Personal');
  const scopeNames = c.scopes.map(s => s.name).join(', ') || (fr ? 'Espace autorisé' : 'Authorized workspace');

  return (
    <main class="pii-workspace" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <header class="pii-workspace-header">
        <div>
          <small>{c.country} · {scopeNames}</small>
          <h1>{fr ? 'Mon espace de travail' : 'My workspace'}{name ? ', ' + name : ''}</h1>
          <p>{fr ? `Aperçu ${activeRoleName} · Données limitées à vos autorisations` : `${activeRoleName} overview · Data limited to your authorized access`}</p>
        </div>
        <button class="btn" onClick={() => setGeneration(x => x + 1)}>{fr ? 'Actualiser' : 'Refresh'}</button>
      </header>

      {c.roles.length > 1 && (
        <nav aria-label={fr ? 'Perspective de travail' : 'Workspace perspective'} class="pii-workspace-roles">
          {c.roles.map(r => (
            <button key={r} class="btn" aria-pressed={r === active} onClick={() => setActive(r)}>
              {roleNames[r] ?? r}
            </button>
          ))}
        </nav>
      )}

      {visible.length ? (
        <div class="pii-workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '16px' }}>
          {visible.map(m => (
            <Panel key={m} module={m} load={loads[m] ?? pending()} go={go} fr={fr} />
          ))}
        </div>
      ) : (
        <p>{fr ? 'Aucun module récapitulatif disponible pour ce rôle. Contactez votre administrateur si un accès est attendu.' : 'No summary modules are currently available for this role. Contact your administrator if access is expected.'}</p>
      )}

      <p class="pii-workspace-footnote">
        {fr ? 'Le changement de perspective n’augmente pas les autorisations. Tous les enregistrements sont vérifiés par le serveur.' : 'Perspective changes do not elevate permissions. All records are authorized by the server.'}
      </p>
    </main>
  );
}
