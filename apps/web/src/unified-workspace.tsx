import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Module = 'crm' | 'compliance' | 'training' | 'learning' | 'audit' | 'onboarding' | 'carriers' | 'commercial' | 'notifications';

interface Context {
  version: number;
  tenantId: string;
  country: 'CA' | 'US';
  roles: string[];
  activeNodeIds: string[];
  isTenantAdmin: boolean;
  modules: Record<Module, boolean>;
  scopes: { id: string; name: string }[];
}

export interface DashboardMetric {
  id: string;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface DashboardItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string;
  target?: { page: string; routeId?: string };
}

export interface DashboardCard {
  id: string;
  module: Module;
  title: string;
  description?: string;
  status: 'ready' | 'empty' | 'forbidden' | 'unavailable';
  metrics: DashboardMetric[];
  items?: DashboardItem[];
  drilldown: {
    page: string;
    routeId?: string;
    label: string;
  };
  allowedActions: string[];
}

export interface ExecutiveSummary {
  activeCarrierContracts: number;
  pendingApprovals: number;
  complianceAlerts: number;
  carrierReceipts: number;
  quarantinedReceipts: number;
}

export interface WorkQueueItem {
  id: string;
  category: 'webhook_review' | 'contract_approval' | 'audit_exception' | 'compliance_alert' | 'onboarding_review' | 'task' | 'coursework' | 'statement_reconciliation';
  title: string;
  subtitle?: string;
  role: string;
  priority: 'high' | 'medium' | 'normal';
  date?: string;
  target: { page: string; routeId?: string };
  actionLabel?: string;
}

interface UnifiedDashboardResponse {
  version: number;
  tenantId: string;
  country: 'CA' | 'US';
  perspective: string;
  roles: string[];
  activeNodeIds: string[];
  isTenantAdmin: boolean;
  isHeadOffice: boolean;
  summary?: ExecutiveSummary;
  workQueue?: WorkQueueItem[];
  cards: DashboardCard[];
}

type Load<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

const pending = <T,>(): Load<T> => ({ state: 'loading' });

const workspaceNames: Record<Locale, Record<string, string>> = {
  en: {
    admin: 'Executive',
    ho: 'Head Office',
    finance: 'Finance',
    manager: 'Manager',
    partner: 'Broker',
    compliance: 'Compliance',
    auditor: 'Audit',
    trainer: 'Training',
    learner: 'Learning',
    staff: 'Operations',
  },
  'fr-CA': {
    admin: 'Direction',
    ho: 'Siège social',
    finance: 'Finances',
    manager: 'Gestionnaire',
    partner: 'Courtier',
    compliance: 'Conformité',
    auditor: 'Vérification',
    trainer: 'Formation',
    learner: 'Apprenant',
    staff: 'Opérations',
  },
};

const titles: Record<Locale, Record<Module, string>> = {
  en: {
    crm: 'Pipeline performance',
    compliance: 'Compliance alerts',
    onboarding: 'Onboarding',
    carriers: 'Carrier contracting cases',
    commercial: 'Commercial operations & finance',
    learning: 'My coursework',
    training: 'Training and CE',
    audit: 'Audit engagements',
    notifications: 'Notifications',
  },
  'fr-CA': {
    crm: 'Rendement des dossiers',
    compliance: 'Alertes de conformité',
    onboarding: 'Intégration',
    carriers: 'Dossiers contrats assureurs',
    commercial: 'Opérations commerciales et finances',
    learning: 'Mon apprentissage',
    training: 'Formation et UFC',
    audit: 'Missions d’audit',
    notifications: 'Notifications',
  },
};

const actionLabels: Record<Locale, Record<string, string>> = {
  en: {
    view_pipeline: 'Open Pipeline',
    create_record: 'New Record',
    review_compliance: 'Review Alerts',
    manage_holds: 'Legal Holds',
    view_cases: 'Contract Cases',
    prepare_packet: 'Prepare Packet',
    view_directory: 'Partner Directory',
    invite_partner: 'Invite Broker',
    assign_course: 'Assign Courses',
    view_reports: 'Reports',
    launch_course: 'Resume Learning',
    view_sampling: 'Audit Sampling',
    mark_all_read: 'Mark Read',
    view_policies: 'Policy Inventory',
    upload_statement: 'Upload Statement',
    reconcile_statement: 'Reconcile',
    reconcile_statements: 'Reconcile',
  },
  'fr-CA': {
    view_pipeline: 'Ouvrir dossiers',
    create_record: 'Nouveau dossier',
    review_compliance: 'Examiner alertes',
    manage_holds: 'Gels juridiques',
    view_cases: 'Dossiers contrats',
    prepare_packet: 'Préparer dossier',
    view_directory: 'Répertoire courtiers',
    invite_partner: 'Inviter courtier',
    assign_course: 'Assigner cours',
    view_reports: 'Rapports',
    launch_course: 'Reprendre cours',
    view_sampling: 'Échantillonnage audit',
    mark_all_read: 'Tout marquer lu',
    view_policies: 'Inventaire des polices',
    upload_statement: 'Téléverser relevé',
    reconcile_statement: 'Rapprocher',
    reconcile_statements: 'Rapprocher',
  },
};

function handleAction(action: string, card: DashboardCard, go: (page: string, id?: string) => void) {
  switch (action) {
    case 'view_pipeline':
    case 'create_record':
      go('pipelines');
      break;
    case 'review_compliance':
    case 'manage_holds':
      go('compliance', 'files');
      break;
    case 'view_cases':
    case 'prepare_packet':
      go('compliance', 'carriers');
      break;
    case 'view_policies':
    case 'upload_statement':
    case 'reconcile_statement':
    case 'reconcile_statements':
      go('commercial');
      break;
    case 'view_directory':
    case 'invite_partner':
      go('partners');
      break;
    case 'assign_course':
    case 'view_reports':
    case 'launch_course':
      go('training');
      break;
    case 'view_sampling':
      go('compliance', 'files');
      break;
    case 'mark_all_read':
      go('notifications');
      break;
    default:
      if (card.drilldown) {
        go(card.drilldown.page, card.drilldown.routeId);
      }
      break;
  }
}

function CardPanel({
  card,
  go,
  fr,
}: {
  card: DashboardCard;
  go: (page: string, id?: string) => void;
  fr: boolean;
}) {
  const localizedTitle = (fr ? titles['fr-CA'] : titles.en)[card.module] || card.title;
  const drillLabel = fr ? 'Ouvrir l’espace' : card.drilldown.label || 'Open workspace';

  return (
    <section class="pii-workspace-panel" aria-label={localizedTitle}>
      <div class="pii-workspace-panel-head">
        <h2 class="pii-workspace-panel-title">{localizedTitle}</h2>
        {card.module !== 'audit' && (
          <button
            class="pii-workspace-action-link"
            type="button"
            onClick={() => go(card.drilldown.page, card.drilldown.routeId)}
          >
            <span>{drillLabel}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {card.status === 'forbidden' ? (
        <div class="pii-workspace-state">
          <span>{fr ? 'Accès non accordé pour cet espace de travail.' : 'Access not granted for this workspace.'}</span>
        </div>
      ) : card.status === 'unavailable' ? (
        <div class="pii-workspace-state">
          <span>{fr ? 'Sommaire non connecté pour le moment. Ouvrez l’espace spécialisé.' : 'Summary not connected yet. Open the specialist workspace.'}</span>
        </div>
      ) : (
        <>
          {card.metrics.length > 0 && (
            <div class="pii-workspace-metrics">
              {card.metrics.map(m => (
                <div class="pii-workspace-metric" key={m.id}>
                  <strong class={`pii-workspace-metric-val ${m.tone || ''}`}>{m.value}</strong>
                  <small class="pii-workspace-metric-lbl">
                    {m.label}
                    {m.sub ? ` · ${m.sub}` : ''}
                  </small>
                </div>
              ))}
            </div>
          )}

          {card.status === 'empty' && card.metrics.length === 0 && (
            <p class="pii-workspace-state">
              {fr ? 'Rien à signaler pour le moment.' : 'Nothing requiring attention for this period.'}
            </p>
          )}

          {Array.isArray(card.items) && card.items.length > 0 && (
            <ul class="pii-workspace-audit-items" style={{ marginTop: '12px' }}>
              {card.items.slice(0, 5).map(item => (
                <li
                  key={item.id}
                  class="pii-workspace-audit-item"
                  style={item.target ? { cursor: 'pointer' } : undefined}
                  onClick={() => {
                    if (item.target) go(item.target.page, item.target.routeId);
                  }}
                >
                  <div style={{ display: 'grid', gap: '2px' }}>
                    <span class="pii-workspace-audit-name">{item.title}</span>
                    {item.subtitle && <small class="muted">{item.subtitle}</small>}
                  </div>
                  {item.status && (
                    <span class={`pii-workspace-audit-status ${item.status === 'active' || item.status === 'completed' ? 'active' : ''}`}>
                      {item.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {Array.isArray(card.allowedActions) && card.allowedActions.length > 0 && (
            <div class="pii-workspace-card-actions">
              {card.allowedActions.map(act => (
                <button
                  key={act}
                  type="button"
                  class="pii-workspace-btn-action"
                  onClick={() => handleAction(act, card, go)}
                >
                  {(fr ? actionLabels['fr-CA'] : actionLabels.en)[act] || act.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function UnifiedWorkspace({
  call,
  go,
  locale,
  name,
  legacyHome,
}: {
  call: Call;
  go: (page: string, id?: string) => void;
  locale: Locale;
  name: string;
  legacyHome?: ComponentChildren;
}) {
  const fr = locale === 'fr-CA';
  const roleNames = fr ? workspaceNames['fr-CA'] : workspaceNames.en;
  const [context, setContext] = useState<Load<Context>>(pending());
  const [active, setActive] = useState('');
  const [dashboard, setDashboard] = useState<Load<UnifiedDashboardResponse>>(pending());
  const [generation, setGeneration] = useState(0);
  const [homeRevision, setHomeRevision] = useState(0);

  // 1. Initial Workspace Discovery
  useEffect(() => {
    let cancelled = false;
    setContext(pending());
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
    return () => {
      cancelled = true;
    };
  }, [call, generation]);

  // 2. Fetch Unified Dashboard Cards for Active Perspective
  useEffect(() => {
    if (context.state !== 'ready' || !active) return;
    let cancelled = false;
    setDashboard(pending());

    call('GET', `/v1/workspace/dashboard?perspective=${encodeURIComponent(active)}&days=30`).then(
      (data: UnifiedDashboardResponse) => {
        if (!cancelled) setDashboard({ state: 'ready', value: data });
      },
      (e: Error & { status?: number }) => {
        if (!cancelled) {
          if (e.status === 403) setDashboard({ state: 'forbidden' });
          else setDashboard({ state: 'error', message: e.message });
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [context, active, call, generation]);

  if (context.state === 'loading') {
    return (
      <main class="pii-workspace">
        <div class="pii-workspace-state" role="status">
          <span>{fr ? 'Chargement de votre espace de travail…' : 'Loading your workspace…'}</span>
        </div>
      </main>
    );
  }
  if (context.state === 'error') {
    return (
      <main class="pii-workspace">
        <div class="pii-workspace-state err" role="alert">
          <span>{fr ? `Erreur de chargement : ${context.message}` : context.message}</span>
        </div>
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button class="btn" onClick={() => setGeneration(x => x + 1)}>
            {fr ? 'Réessayer' : 'Retry'}
          </button>
        </div>
      </main>
    );
  }
  if (context.state !== 'ready') return null;

  const c = context.value;
  const activeRoleName = roleNames[active] ?? (fr ? 'Personnel' : 'Personal');
  const scopeNames = c.scopes.map(s => s.name).join(', ') || (fr ? 'Espace autorisé' : 'Authorized workspace');

  return (
    <main class="pii-workspace">
      <header class="pii-workspace-header">
        <div class="pii-workspace-header-main">
          <span class="pii-workspace-badge">
            {c.country} · {scopeNames}
          </span>
          <h1 class="pii-workspace-title">
            {fr ? 'Mon espace de travail' : 'My workspace'}
            {name ? ', ' + name : ''}
          </h1>
          <p class="pii-workspace-subhead">
            {fr
              ? `Aperçu ${activeRoleName} · Données limitées à vos autorisations`
              : `${activeRoleName} overview · Data limited to your authorized access`}
          </p>
        </div>
        <div class="pii-workspace-header-actions">
          <button
            class="pii-workspace-refresh-btn"
            type="button"
            onClick={() => {
              setGeneration(x => x + 1);
              setHomeRevision(x => x + 1);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{fr ? 'Actualiser' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      {c.roles.length > 1 && (
        <nav aria-label={fr ? 'Perspective de travail' : 'Workspace perspective'} class="pii-workspace-roles">
          <span class="pii-workspace-roles-label">{fr ? 'Perspective :' : 'Perspective:'}</span>
          <div class="pii-workspace-roles-group" role="tablist">
            {c.roles.map(r => (
              <button
                key={r}
                role="tab"
                class={`pii-workspace-role-btn ${r === active ? 'active' : ''}`}
                aria-pressed={r === active}
                aria-selected={r === active}
                onClick={() => setActive(r)}
              >
                {roleNames[r] ?? r}
              </button>
            ))}
          </div>
        </nav>
      )}

      {dashboard.state === 'loading' ? (
        <div class="pii-workspace-state" role="status" style={{ minHeight: '180px' }}>
          <span>{fr ? 'Chargement des cartes d’activité…' : 'Loading activity cards…'}</span>
        </div>
      ) : dashboard.state === 'forbidden' ? (
        <div class="pii-workspace-state err" role="alert">
          <span>{fr ? 'Accès non autorisé pour cette perspective.' : 'Access not authorized for this perspective.'}</span>
        </div>
      ) : dashboard.state === 'error' ? (
        <div class="pii-workspace-state err" role="alert">
          <span>{fr ? `Erreur : ${dashboard.message}` : `Error: ${dashboard.message}`}</span>
        </div>
      ) : dashboard.state === 'ready' ? (
        <>
          {dashboard.value.summary && (
            <section class="pii-workspace-summary-strip" aria-label={fr ? 'Sommaire de direction' : 'Executive Summary'}>
              <div class="pii-workspace-summary-grid">
                <div
                  class="pii-workspace-summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => go('compliance', 'carriers')}
                >
                  <span class="pii-workspace-summary-num">{dashboard.value.summary.activeCarrierContracts}</span>
                  <span class="pii-workspace-summary-lbl">{fr ? 'Contrats / nominations actifs' : 'Active Contracts / Appointments'}</span>
                </div>
                <div
                  class="pii-workspace-summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => go('compliance', 'carriers')}
                >
                  <span class="pii-workspace-summary-num">{dashboard.value.summary.pendingApprovals}</span>
                  <span class="pii-workspace-summary-lbl">{fr ? 'Approbations en attente' : 'Pending Approvals'}</span>
                </div>
                <div
                  class="pii-workspace-summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => go('compliance', 'files')}
                >
                  <span class={`pii-workspace-summary-num ${dashboard.value.summary.complianceAlerts > 0 ? 'warn' : ''}`}>
                    {dashboard.value.summary.complianceAlerts}
                  </span>
                  <span class="pii-workspace-summary-lbl">{fr ? 'Alertes de conformité' : 'Compliance Alerts'}</span>
                </div>
                <div
                  class="pii-workspace-summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => go('compliance', 'carriers')}
                >
                  <span class={`pii-workspace-summary-num ${dashboard.value.summary.quarantinedReceipts > 0 ? 'bad' : ''}`}>
                    {dashboard.value.summary.quarantinedReceipts}
                  </span>
                  <span class="pii-workspace-summary-lbl">{fr ? 'Webhooks en quarantaine' : 'Quarantined Webhooks'}</span>
                </div>
                <div
                  class="pii-workspace-summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => go('compliance', 'carriers')}
                >
                  <span class="pii-workspace-summary-num">{dashboard.value.summary.carrierReceipts}</span>
                  <span class="pii-workspace-summary-lbl">{fr ? 'Reçus de webhook' : 'Carrier Webhook Receipts'}</span>
                </div>
              </div>
            </section>
          )}

          {Array.isArray(dashboard.value.workQueue) && dashboard.value.workQueue.length > 0 && (
            <section class="pii-workspace-workqueue" aria-label={fr ? 'File de travail opérationnelle' : 'Operational Action Queue'}>
              <div class="pii-workspace-workqueue-head">
                <div class="pii-workspace-workqueue-title-row">
                  <h2 class="pii-workspace-workqueue-title">
                    {fr ? 'File de travail opérationnelle' : 'Operational Action Queue'}
                  </h2>
                  <span class="pii-workspace-workqueue-count">
                    {dashboard.value.workQueue.length} {fr ? 'tâches à traiter' : 'items requiring action'}
                  </span>
                </div>
                <p class="pii-workspace-workqueue-subhead">
                  {fr
                    ? 'Révisions prioritaires, approbations en attente et conformité nécessitant une intervention dans votre périmètre.'
                    : 'Priority reviews, pending approvals, and compliance tasks requiring action within your authorized scope.'}
                </p>
              </div>
              <div class="pii-workspace-workqueue-list">
                {dashboard.value.workQueue.map(item => (
                  <div key={item.id} class="pii-workspace-workqueue-item">
                    <div class="pii-workspace-workqueue-main">
                      <div class="pii-workspace-workqueue-tags">
                        <span class={`pii-workspace-priority-tag ${item.priority}`}>
                          {item.priority.toUpperCase()}
                        </span>
                        <span class="pii-workspace-role-tag">{item.role}</span>
                        {item.date && (
                          <span class="pii-workspace-date-tag">
                            {new Date(item.date).toLocaleDateString(fr ? 'fr-CA' : 'en-CA')}
                          </span>
                        )}
                      </div>
                      <strong class="pii-workspace-workqueue-item-title">{item.title}</strong>
                      {item.subtitle && <p class="pii-workspace-workqueue-item-sub">{item.subtitle}</p>}
                    </div>
                    <button
                      type="button"
                      class="pii-workspace-workqueue-btn"
                      onClick={() => go(item.target.page, item.target.routeId)}
                    >
                      <span>{item.actionLabel || (fr ? 'Traiter' : 'Action')}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {dashboard.value.cards.length > 0 ? (
            <div class="pii-workspace-grid">
              {dashboard.value.cards.map(card => (
                <CardPanel key={card.id} card={card} go={go} fr={fr} />
              ))}
            </div>
          ) : (
            <p class="pii-workspace-state">
              {fr
                ? 'Aucune carte d’activité n’est disponible pour ce rôle.'
                : 'No activity cards are available for this role.'}
            </p>
          )}
        </>
      ) : (
        <p class="pii-workspace-state">
          {fr
            ? 'Sommaire d’activité non disponible pour le moment.'
            : 'Activity summary not available at this time.'}
        </p>
      )}

      {/* Preserve CRM Home for users with authorized CRM access */}
      {c.roles.includes(active) && c.modules.crm && ['admin', 'manager', 'partner', 'staff'].includes(active) && (
        <div key={homeRevision}>{legacyHome}</div>
      )}

      <p class="pii-workspace-footnote">
        {fr
          ? 'Le changement de perspective n’augmente pas les autorisations. Tous les enregistrements sont vérifiés par le serveur.'
          : 'Perspective changes do not elevate permissions. All records are authorized by the server.'}
      </p>
    </main>
  );
}
