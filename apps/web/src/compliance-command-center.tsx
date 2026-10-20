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
  { key: 'webhooks', path: '/v1/compliance/carrier-webhook-receipts?status=quarantined' },
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

export type ComplianceSection = 'files' | 'onboarding' | 'carriers';
export type ComplianceFilter = 'all' | 'review' | 'expiring' | 'not_cleared' | 'risk' | 'aml' | 'retention' | 'overdue' | 'applications' | 'actions' | 'directory';

export function ComplianceCommandCenter({
  call,
  locale,
  onNavigate,
}: {
  call: Call;
  locale: Locale;
  onNavigate: (section: ComplianceSection, filter?: ComplianceFilter | string) => void;
}) {
  const fr = locale === 'fr-CA';
  const [results, setResults] = useState<Record<Key, Result>>(initial);
  const [revision, setRevision] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

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
  const webhooks = results.webhooks;

  const amlItems: AmlItem[] = Array.isArray(risk.value?.aml) ? risk.value.aml : [];
  const holdItems: HoldItem[] = Array.isArray(retention.value?.holds) ? retention.value.holds : [];
  const auditItems: EngagementItem[] = Array.isArray(audit.value?.engagements) ? audit.value.engagements : [];
  const quarantinedReceipts: any[] = Array.isArray(webhooks.value?.receipts) ? webhooks.value.receipts : [];
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
    cards: { key: Key; label: string; count: number | undefined; section: ComplianceSection; filter?: ComplianceFilter }[];
  }[] = [
    {
      title: fr ? 'Accréditations et dossiers' : 'Credentials & Broker Clearances',
      cards: [
        { key: 'overview', label: fr ? 'Documents expirés' : 'Expired records', count: summary.value?.expired, section: 'files', filter: 'expiring' },
        { key: 'overview', label: fr ? 'Expirations (90 jours)' : 'Expiring in 90 days', count: summary.value?.expiring90, section: 'files', filter: 'expiring' },
        { key: 'clearance', label: fr ? 'Dossiers non validés' : 'Not cleared to transact', count: clearance.value?.notCleared?.length, section: 'files', filter: 'not_cleared' },
        { key: 'risk', label: fr ? 'Dossiers à risque' : 'Files at risk (missing gate)', count: risk.value?.files?.length, section: 'files', filter: 'risk' },
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
          filter: 'aml',
        },
        {
          key: 'overview',
          label: fr ? 'Déclarations d’espèces dues' : 'Cash reports due',
          count: summary.value?.cashReportsDue ?? amlItems.filter((a) => a.issue === 'cash_unreported').length,
          section: 'files',
          filter: 'aml',
        },
        {
          key: 'risk',
          label: fr ? 'Échecs vérif. identité' : 'Failed ID checks',
          count: amlItems.filter((a) => a.issue === 'id_failed').length,
          section: 'files',
          filter: 'aml',
        },
        {
          key: 'overview',
          label: fr ? 'Retraits consentement (30j)' : 'Consent withdrawals (30d)',
          count: summary.value?.withdrawals30d,
          section: 'files',
          filter: 'aml',
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
          filter: 'retention',
        },
        {
          key: 'retention',
          label: fr ? 'Conservation échue (examen)' : 'Past retention (due review)',
          count: retention.value?.summary?.due,
          section: 'files',
          filter: 'retention',
        },
        {
          key: 'retention',
          label: fr ? 'Échéance dans 12 mois' : 'Retention due in 12m',
          count: retention.value?.summary?.dueWithin12Months,
          section: 'files',
          filter: 'retention',
        },
        {
          key: 'audit',
          label: fr ? 'Missions d’audit actives' : 'Active audit engagements',
          count: auditItems.filter((e) => e.status === 'active' || e.status === 'open' || e.status === 'invited').length,
          section: 'files',
          filter: 'retention',
        },
      ],
    },
    {
      title: fr ? 'Intégration et contrats' : 'Onboarding & Carrier Contracting',
      cards: [
        { key: 'onboarding', label: fr ? 'Rapports en retard' : 'Overdue self-reports', count: onboarding.value?.selfReports?.overdue, section: 'onboarding', filter: 'overdue' },
        { key: 'onboarding', label: fr ? 'Contrôles périodiques en retard' : 'Overdue rechecks', count: onboarding.value?.rechecks?.overdue, section: 'onboarding', filter: 'overdue' },
        {
          key: 'carriers',
          label: fr ? 'Dossiers assureurs' : 'Carrier contract cases',
          count: Array.isArray(carriers.value) ? carriers.value.length : carriers.value?.contracts?.length,
          section: 'carriers',
          filter: 'applications',
        },
        {
          key: 'webhooks',
          label: fr ? 'Webhooks en quarantaine' : 'Quarantined webhooks',
          count: quarantinedReceipts.length,
          section: 'carriers',
          filter: 'actions',
        },
        {
          key: 'notifications',
          label: fr ? 'Alertes conformité actives' : 'Active compliance alerts',
          count: notifAlerts.length,
          section: 'files',
          filter: 'review',
        },
      ],
    },
  ];

  const evidenceFor = (label: string): { title: string; detail: string }[] | null => {
    const aml = (issue: string) => amlItems.filter(x => x.issue === issue).map(x => ({ title: x.name, detail: x.detail || x.issue }));
    switch (label) {
      case 'Not cleared to transact': case 'Dossiers non validés':
        return (clearance.value?.notCleared ?? []).map((x: any) => ({ title: String(x.name ?? x.nodeId), detail: Array.isArray(x.reasons) ? x.reasons.join(', ') : '' }));
      case 'Open screening hits': case 'Correspondances ouvertes': return aml('screening_hit');
      case 'Cash reports due': case 'Déclarations d’espèces dues': return aml('cash_unreported');
      case 'Failed ID checks': case 'Échecs vérif. identité': return aml('id_failed');
      case 'Active legal holds': case 'Gels juridiques ouverts': return holdItems.map(x => ({ title: x.name, detail: x.reason }));
      case 'Active audit engagements': case 'Missions d’audit actives':
        return auditItems.filter(x => ['active', 'open', 'invited'].includes(x.status)).map(x => ({ title: x.title, detail: x.status + ' · ' + x.endsOn }));
      case 'Quarantined webhooks': case 'Webhooks en quarantaine':
        return quarantinedReceipts.map((x: any) => ({ title: String(x.carrierId ?? x.carrier_id ?? x.id ?? 'Carrier receipt'), detail: String(x.externalEventId ?? x.external_event_id ?? x.status ?? '') }));
      default: return null;
    }
  };
  const selectedCard = sections.flatMap(x => x.cards).find(x => x.label === selectedMetric);
  const selectedRows = selectedMetric ? evidenceFor(selectedMetric) : null;
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
          <button class="pii-workspace-refresh-btn" type="button" onClick={() => setRevision((x) => x + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            <span>{fr ? 'Actualiser' : 'Refresh'}</span>
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

        {selectedCard && (
          <section class="obcard" role="region" aria-label={selectedCard.label} style={{ marginTop: '16px' }}>
            <div class="obrow">
              <h3>{selectedCard.label}</h3>
              <button type="button" class="btn" onClick={() => setSelectedMetric(null)}>{fr ? 'Fermer' : 'Close'}</button>
            </div>
            {results[selectedCard.key].state !== 'ready' || typeof selectedCard.count !== 'number' ? (
              <p role="status" class="muted">{fr ? 'Données indisponibles ou en cours de chargement.' : 'Data unavailable or loading. No zero is assumed.'}</p>
            ) : selectedRows === null ? (
              <div>
                <p>{fr ? 'Total vérifié' : 'Verified total'}: <strong>{selectedCard.count}</strong></p>
                <p class="muted">{fr ? 'Le service ne fournit pas encore une liste détaillée correspondant exactement à cet indicateur.' : 'The service does not yet expose an exact record-level list for this metric.'}</p>
                {(selectedCard.filter === 'expiring' || selectedCard.filter === 'not_cleared') && (
                  <button class="btn" type="button" onClick={() => onNavigate('files', selectedCard.filter)}>
                    {fr ? 'Voir les dossiers' : 'View broker files'}
                  </button>
                )}
              </div>
            ) : selectedRows.length === 0 ? (
              <p class="muted">{selectedCard.count === 0
                ? (fr ? 'Aucun dossier correspondant.' : 'No matching records.')
                : (fr ? 'Le total ne correspond pas aux dossiers disponibles.' : 'Summary count does not reconcile with available records.')}</p>
            ) : (
              <div>
                {selectedRows.length !== selectedCard.count && <p role="status" class="muted">{fr ? 'Écart entre total et dossiers visibles.' : 'Count differs from visible records.'}</p>}
                {selectedRows.map((row, i) => (
                  <div class="ev" key={i} style={{ marginTop: '8px' }}>
                    <strong>{row.title}</strong><p class="muted">{row.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
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
                    onClick={() => setSelectedMetric(c.label)}
                    aria-expanded={selectedMetric === c.label}
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
            <button class="btn" type="button" onClick={() => onNavigate('files', 'aml')}>
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
                <button class="btn" type="button" onClick={() => onNavigate('files', 'aml')} style={{ padding: '4px 10px', fontSize: '12px' }}>
                  {fr ? 'Voir dossier' : 'Open file'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {quarantinedReceipts.length > 0 && (
        <div class="obcard" style={{ marginTop: '16px', borderLeft: '4px solid #b3261e' }}>
          <div class="obrow">
            <div>
              <h3 style={{ color: '#b3261e' }}>
                {fr ? 'Reçus de webhook en quarantaine nécessitant révision' : 'Quarantined Carrier Webhooks Requiring Review'} ({quarantinedReceipts.length})
              </h3>
              <p class="muted">
                {fr
                  ? 'Événements assureurs reçus et placés en quarantaine. L’adjudication et l’examen de conformité sont requis avant toute réconciliation.'
                  : 'Insurer events quarantined upon receipt. Independent compliance review and adjudication required before carrier reconciliation.'}
              </p>
            </div>
            <button class="btn" type="button" onClick={() => onNavigate('carriers', 'actions')}>
              {fr ? 'Traiter la quarantaine' : 'Review in carrier workspace'}
            </button>
          </div>
          <div style={{ marginTop: '12px' }}>
            {quarantinedReceipts.slice(0, 5).map((qr: any) => (
              <div
                class="ev"
                key={qr.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}
              >
                <div>
                  <strong>{qr.carrierId} · Event {qr.externalEventId}</strong>
                  <div class="muted" style={{ fontSize: '12px' }}>
                    {fr ? 'Reçu le' : 'Received'}: {new Date(qr.receivedAt).toLocaleString(fr ? 'fr-CA' : 'en-CA')}
                    {qr.notes ? ` · ${qr.notes}` : ''}
                  </div>
                </div>
                <button
                  class="btn"
                  type="button"
                  onClick={() => onNavigate('carriers', 'actions')}
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                >
                  {fr ? 'Examiner' : 'Review'}
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
          <button class="btn" type="button" onClick={() => onNavigate('files', 'all')}>
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
