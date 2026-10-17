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
  { key: 'retention', path: '/v1/compliance/retention' },
  { key: 'audit', path: '/v1/audit/engagements' },
  { key: 'notifications', path: '/v1/notifications' },
] as const;

type Key = typeof SOURCES[number]['key'];
const initial = () => Object.fromEntries(SOURCES.map((s) => [s.key, { state: 'loading' }])) as Record<Key, Result>;

interface AmlItem {
  boxId: string;
  name: string;
  issue: string;
  detail: string;
  since: string;
  overdue: boolean;
}

interface HoldItem {
  id: string;
  boxId: string;
  name: string;
  reason: string;
  placedBy?: string;
  placedAt?: string;
}

interface EngagementItem {
  id: string;
  title: string;
  auditorEmail: string;
  status: string;
  endsOn: string;
  scope?: string[];
}

export function ComplianceCommandCenter({
  call,
  locale,
  onNavigate,
}: {
  call: Call;
  locale: Locale;
  onNavigate: (section: 'files' | 'onboarding' | 'carriers') => void;
}) {
  const fr = locale === 'fr-CA';
  const [results, setResults] = useState<Record<Key, Result>>(initial);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setResults(initial());
    for (const source of SOURCES) {
      void call('GET', source.path).then(
        (value) => {
          if (active) setResults((prev) => ({ ...prev, [source.key]: { state: 'ready', value } }));
        },
        (error) => {
          if (active) {
            setResults((prev) => ({
              ...prev,
              [source.key]: { state: 'error', error: error instanceof Error ? error.message : String(error) },
            }));
          }
        },
      );
    }
    return () => {
      active = false;
    };
  }, [call, revision]);

  const summary = results.overview;
  const clearance = results.clearance;
  const risk = results.risk;
  const onboarding = results.onboarding;
  const carriers = results.carriers;
  const retention = results.retention;
  const audit = results.audit;
  const notifications = results.notifications;

  const amlItems: AmlItem[] = Array.isArray(risk.value?.aml) ? risk.value.aml : [];
  const holdItems: HoldItem[] = Array.isArray(retention.value?.holds) ? retention.value.holds : [];
  const auditItems: EngagementItem[] = Array.isArray(audit.value?.engagements) ? audit.value.engagements : [];
  const notifAlerts = Array.isArray(notifications.value?.notifications)
    ? notifications.value.notifications.filter((n: any) => n.kind?.includes('alert') || n.kind?.includes('aml'))
    : [];

  const issueLabels: Record<string, string> = fr
    ? {
        screening_hit: 'Correspondance vérification',
        id_failed: 'Vérification d’identité échouée',
        cash_unreported: 'Espèces importantes non déclarées',
      }
    : {
        screening_hit: 'Screening hit unreviewed',
        id_failed: 'ID check failed',
        cash_unreported: 'Large cash report missing',
      };

  const sections: {
    title: string;
    cards: { key: Key; label: string; count: number | undefined; section: 'files' | 'onboarding' | 'carriers' }[];
  }[] = [
    {
      title: fr ? 'Accréditations et dossiers' : 'Credentials & Broker Clearances',
      cards: [
        { key: 'overview', label: fr ? 'Documents expirés' : 'Expired records', count: summary.value?.expired, section: 'files' },
        { key: 'overview', label: fr ? 'Expirations (90 jours)' : 'Expiring in 90 days', count: summary.value?.expiring90, section: 'files' },
        { key: 'clearance', label: fr ? 'Dossiers non validés' : 'Not cleared to transact', count: clearance.value?.notCleared?.length, section: 'files' },
        { key: 'risk', label: fr ? 'Dossiers à risque' : 'Files at risk (missing gate)', count: risk.value?.files?.length, section: 'files' },
      ],
    },
    {
      title: fr ? 'LCB/FT, filtrage et identité' : 'AML, Screening & Identity',
      cards: [
        {
          key: 'overview',
          label: fr ? 'Correspondances ouvertes' : 'Open screening hits',
          count: summary.value?.openScreeningHits ?? amlItems.filter((a) => a.issue === 'screening_hit').length,
          section: 'files',
        },
        {
          key: 'overview',
          label: fr ? 'Déclarations d’espèces dues' : 'Cash reports due',
          count: summary.value?.cashReportsDue ?? amlItems.filter((a) => a.issue === 'cash_unreported').length,
          section: 'files',
        },
        {
          key: 'risk',
          label: fr ? 'Échecs vérif. identité' : 'Failed ID checks',
          count: amlItems.filter((a) => a.issue === 'id_failed').length,
          section: 'files',
        },
        {
          key: 'overview',
          label: fr ? 'Retraits consentement (30j)' : 'Consent withdrawals (30d)',
          count: summary.value?.withdrawals30d,
          section: 'files',
        },
      ],
    },
    {
      title: fr ? 'Conservation, gels et audits' : 'Retention, Legal Holds & Audits',
      cards: [
        {
          key: 'retention',
          label: fr ? 'Gels juridiques ouverts' : 'Active legal holds',
          count: retention.value?.summary?.held ?? summary.value?.openHolds ?? holdItems.length,
          section: 'files',
        },
        {
          key: 'retention',
          label: fr ? 'Conservation échue (examen)' : 'Past retention (due review)',
          count: retention.value?.summary?.due,
          section: 'files',
        },
        {
          key: 'retention',
          label: fr ? 'Échéance dans 12 mois' : 'Retention due in 12m',
          count: retention.value?.summary?.dueWithin12Months,
          section: 'files',
        },
        {
          key: 'audit',
          label: fr ? 'Missions d’audit actives' : 'Active audit engagements',
          count: auditItems.filter((e) => e.status === 'active' || e.status === 'open' || e.status === 'invited').length,
          section: 'files',
        },
      ],
    },
    {
      title: fr ? 'Intégration et contrats' : 'Onboarding & Carrier Contracting',
      cards: [
        { key: 'onboarding', label: fr ? 'Rapports en retard' : 'Overdue self-reports', count: onboarding.value?.selfReports?.overdue, section: 'onboarding' },
        { key: 'onboarding', label: fr ? 'Contrôles périodiques en retard' : 'Overdue rechecks', count: onboarding.value?.rechecks?.overdue, section: 'onboarding' },
        {
          key: 'carriers',
          label: fr ? 'Dossiers assureurs' : 'Carrier contract cases',
          count: Array.isArray(carriers.value) ? carriers.value.length : carriers.value?.contracts?.length,
          section: 'carriers',
        },
        {
          key: 'notifications',
          label: fr ? 'Alertes conformité actives' : 'Active compliance alerts',
          count: notifAlerts.length,
          section: 'files',
        },
      ],
    },
  ];

  const errors = SOURCES.filter((s) => results[s.key].state === 'error');

  return (
    <section class="obwrap" aria-label={fr ? 'Tableau de bord conformité' : 'Compliance command center'}>
      <div class="obcard">
        <div class="obrow">
          <div>
            <h2>{fr ? 'Centre de contrôle conformité' : 'Compliance command center'}</h2>
            <p class="muted">
              {fr
                ? 'Données consolidées selon vos autorisations. Les comptes incomplets ne sont jamais masqués en faux zéros.'
                : 'Consolidated live records within authorized scope. Incomplete or failing data is never presented as zero.'}
            </p>
          </div>
          <button class="btn" type="button" onClick={() => setRevision((x) => x + 1)}>
            {fr ? 'Actualiser' : 'Refresh'}
          </button>
        </div>

        {errors.length > 0 && (
          <div role="alert" class="err" style={{ marginTop: '14px' }}>
            <strong>{fr ? 'Certaines données de conformité n’ont pas pu être vérifiées' : 'Some compliance data could not be verified'}</strong>
            <p class="muted" style={{ margin: '4px 0' }}>
              {fr
                ? 'Les indicateurs ci-dessous affichent un tiret (« — ») pour éviter de présenter des vérifications manquantes comme conformes.'
                : 'Indicators below show a dash ("—") to prevent displaying unverified controls as cleared.'}
            </p>
            {errors.map((s) => (
              <p key={s.key} style={{ margin: '2px 0' }}>
                <code>{s.key}</code>: {results[s.key].error}
              </p>
            ))}
          </div>
        )}

        {sections.map((sec) => (
          <div key={sec.title} style={{ marginTop: '20px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '15px', color: '#475569' }}>{sec.title}</h3>
            <div class="hstats">
              {sec.cards.map((c) => {
                const res = results[c.key];
                const display =
                  res.state === 'loading'
                    ? '…'
                    : res.state === 'error' || typeof c.count !== 'number'
                    ? '—'
                    : c.count;
                return (
                  <button
                    type="button"
                    class="hstat"
                    key={c.label}
                    onClick={() => onNavigate(c.section)}
                    aria-label={`${c.label}, ${display}`}
                  >
                    <b>{display}</b>
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {amlItems.length > 0 && (
        <div class="obcard" style={{ marginTop: '16px' }}>
          <div class="obrow">
            <div>
              <h3>{fr ? 'Points d’attention LCB/FT et filtrage prioritaires' : 'Priority AML & Screening Attention Items'} ({amlItems.length})</h3>
              <p class="muted">
                {fr
                  ? 'Résultats de filtrage, vérifications d’identité en échec ou transactions en espèces en attente de référence.'
                  : 'Open screening hits, failed identity checks, or cash transactions awaiting regulatory report reference.'}
              </p>
            </div>
            <button class="btn" type="button" onClick={() => onNavigate('files')}>
              {fr ? 'Examiner dans les dossiers' : 'Review in broker files'}
            </button>
          </div>
          <div style={{ marginTop: '12px' }}>
            {amlItems.map((a, n) => (
              <div
                class="ev"
                key={a.boxId + a.issue + n}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}
              >
                <div>
                  <strong>{a.name}</strong> <small class="muted">{a.detail} · {a.since}</small>
                  <div style={{ color: '#b3261e', fontSize: '13px', fontWeight: 600 }}>
                    {issueLabels[a.issue] ?? a.issue}
                    {a.overdue ? ` · ${fr ? 'EN RETARD (> 15 jours)' : 'OVERDUE (> 15 days)'}` : ''}
                  </div>
                </div>
                <button class="btn" type="button" onClick={() => onNavigate('files')} style={{ padding: '4px 10px', fontSize: '12px' }}>
                  {fr ? 'Voir dossier' : 'Open file'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(holdItems.length > 0 || auditItems.length > 0) && (
        <div class="obcard" style={{ marginTop: '16px' }}>
          <h3>{fr ? 'Gouvernance : Gels juridiques et missions d’audit' : 'Governance: Legal Holds & Audit Engagements'}</h3>
          {holdItems.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <strong>{fr ? 'Gels juridiques actifs' : 'Active Legal Holds'} ({holdItems.length})</strong>
              {holdItems.slice(0, 5).map((h) => (
                <div class="ev" key={h.id} style={{ margin: '6px 0' }}>
                  <strong>{h.name}</strong> <small class="muted">{h.reason}</small>
                  {h.placedBy && <div class="muted" style={{ fontSize: '12px' }}>{fr ? 'Imposé par' : 'Placed by'}: {h.placedBy} {h.placedAt ? `(${h.placedAt.slice(0, 10)})` : ''}</div>}
                </div>
              ))}
            </div>
          )}
          {auditItems.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <strong>{fr ? 'Missions d’audit externe' : 'External Audit Engagements'} ({auditItems.length})</strong>
              {auditItems.slice(0, 5).map((e) => (
                <div class="ev" key={e.id} style={{ margin: '6px 0' }}>
                  <strong>{e.title}</strong> <small class="muted">{e.auditorEmail} · {fr ? 'Échéance' : 'Ends'}: {e.endsOn} · {e.status}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div class="obcard" style={{ marginTop: '16px' }}>
        <h3>{fr ? 'Accès rapide aux postes opérationnels' : 'Quick Access to Operational Workspaces'}</h3>
        <div class="obrow" style={{ marginTop: '10px' }}>
          <button class="btn" type="button" onClick={() => onNavigate('files')}>
            {fr ? 'Dossiers et pièces justificatives' : 'Broker files and evidence'}
          </button>
          <button class="btn" type="button" onClick={() => onNavigate('onboarding')}>
            {fr ? 'Intégration et échéances' : 'Onboarding and deadlines'}
          </button>
          <button class="btn" type="button" onClick={() => onNavigate('carriers')}>
            {fr ? 'Contrats assureurs' : 'Carrier contracting'}
          </button>
        </div>
      </div>
    </section>
  );
}
