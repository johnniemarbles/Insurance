import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

export interface PolicyRecord {
  id: string;
  carrier_id: string;
  carrier_name?: string;
  policy_number: string;
  plan_name: string;
  jurisdiction: string;
  annual_premium_cents: number;
  modal_premium_cents: number;
  premium_frequency: string;
  status: string;
  effective_date: string;
  expiry_date?: string | null;
  producer_node_id: string;
  producer_name?: string;
  branch_node_id: string;
  branch_name?: string;
  created_at: string;
}

export interface CommissionImport {
  id: string;
  carrier_id: string;
  statement_reference: string;
  statement_date: string;
  file_hash_sha256: string;
  total_gross_cents: number;
  total_net_cents: number;
  line_count: number;
  status: 'registered' | 'reconciled' | 'exceptions_flagged' | 'approved' | 'posted';
  imported_by?: string | null;
  imported_at: string;
}

export interface CommissionLineItem {
  id: string;
  import_id: string;
  policy_number: string;
  policy_id?: string | null;
  carrier_producer_code?: string | null;
  transaction_type: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  reconciliation_status: 'matched' | 'unmatched' | 'variance_flagged' | 'chargeback_linked';
  exception_reason?: string | null;
  created_at: string;
}

export interface CommissionSplit {
  id: string;
  import_id: string;
  line_item_id: string;
  producer_node_id: string;
  status: 'calculated' | 'approved' | 'clawback';
  gross_amount_cents: number;
  broker_net_cents: number;
  branch_override_cents: number;
  mga_spread_cents: number;
  holdback_cents: number;
  created_at: string;
}

export interface CommercialKpis {
  activePoliciesCount: number;
  totalAnnualPremiumCents: number;
  registeredImportsCount: number;
  pendingReconciliationCount: number;
  approvedImportsCount: number;
  netRemittanceCents: number;
}

const CARRIERS = [
  { id: 'ia-financial-group', name: 'iA Financial Group' },
  { id: 'sun-life', name: 'Sun Life' },
  { id: 'manulife', name: 'Manulife' },
  { id: 'canada-life', name: 'Canada Life' },
];

const STRINGS = {
  en: {
    title: 'Commercial Operations & Finance',
    sub: 'Authoritative in-force policy inventory, carrier statement remittance, and deterministic commission splits.',
    tabs: {
      policies: 'Policy Inventory',
      commissions: 'Commission Statements',
      kpis: 'Financial KPIs',
    },
    actions: {
      newPolicy: 'New Policy',
      uploadStatement: 'Upload Statement CSV',
      preview: 'Preview Reconciliation',
      register: 'Register Statement',
      approve: 'Approve & Seal Splits',
      resolve: 'Resolve Exception',
      offsetStatement: 'Offset Reversal Statement',
      close: 'Close',
      cancel: 'Cancel',
      save: 'Save',
      filter: 'Filter',
      search: 'Search policies…',
    },
    metrics: {
      activePolicies: 'Active Policies',
      inForcePremium: 'In-Force Annual Premium',
      pendingStatements: 'Pending Reconciliation',
      netRemittance: 'Approved Remittance',
    },
    status: {
      active: 'Active',
      pending: 'Pending',
      grace: 'Grace Period',
      lapsed: 'Lapsed',
      cancelled: 'Cancelled',
      surrendered: 'Surrendered',
      registered: 'Registered',
      reconciled: 'Reconciled',
      exceptions_flagged: 'Exceptions Flagged',
      approved: 'Approved & Sealed',
      posted: 'Posted',
      matched: 'Matched',
      unmatched: 'Unmatched',
      variance_flagged: 'Variance Flagged',
      chargeback_linked: 'Chargeback Linked',
    },
    form: {
      carrier: 'Carrier',
      policyNumber: 'Policy Number',
      planName: 'Plan Name',
      jurisdiction: 'Jurisdiction',
      annualPremium: 'Annual Premium ($)',
      modalPremium: 'Modal Premium ($)',
      frequency: 'Premium Frequency',
      effectiveDate: 'Effective Date',
      expiryDate: 'Expiry Date (optional)',
      statementRef: 'Statement Reference',
      statementDate: 'Statement Date',
      csvData: 'CSV Content (RFC 4180)',
      csvHelp: 'Include header row: PolicyNumber, GrossAmount, NetAmount, TransactionType, ProducerCode',
      reason: 'Reason for variance / exception resolution',
      linkToPolicy: 'Link to Policy ID (optional)',
    },
    emptyPolicies: 'No policies recorded yet.',
    emptyStatements: 'No carrier statements uploaded yet.',
    sealedNotice: 'This statement is approved and sealed under PostgreSQL database triggers. No in-place modification or deletion is permitted. Adjustments require an offsetting reversal statement.',
  },
  'fr-CA': {
    title: 'Opérations commerciales et finances',
    sub: 'Inventaire officiel des polices en vigueur, relevés de commissions des assureurs et répartition déterministe.',
    tabs: {
      policies: 'Inventaire des polices',
      commissions: 'Relevés de commissions',
      kpis: 'Indicateurs financiers',
    },
    actions: {
      newPolicy: 'Nouvelle police',
      uploadStatement: 'Téléverser relevé CSV',
      preview: 'Aperçu du rapprochement',
      register: 'Enregistrer relevé',
      approve: 'Approuver et sceller les répartitions',
      resolve: 'Résoudre l’exception',
      offsetStatement: 'Relevé de contre-passation',
      close: 'Fermer',
      cancel: 'Annuler',
      save: 'Enregistrer',
      filter: 'Filtrer',
      search: 'Rechercher polices…',
    },
    metrics: {
      activePolicies: 'Polices actives',
      inForcePremium: 'Primes annuelles en vigueur',
      pendingStatements: 'En attente de rapprochement',
      netRemittance: 'Versements approuvés',
    },
    status: {
      active: 'Active',
      pending: 'En attente',
      grace: 'Délai de grâce',
      lapsed: 'Échue',
      cancelled: 'Résiliée',
      surrendered: 'Rachetée',
      registered: 'Enregistré',
      reconciled: 'Rapproché',
      exceptions_flagged: 'Exceptions signalées',
      approved: 'Approuvé et scellé',
      posted: 'Comptabilisé',
      matched: 'Jumelé',
      unmatched: 'Non jumelé',
      variance_flagged: 'Écart signalé',
      chargeback_linked: 'Rappel jumelé',
    },
    form: {
      carrier: 'Assureur',
      policyNumber: 'Numéro de police',
      planName: 'Nom du régime',
      jurisdiction: 'Territoire',
      annualPremium: 'Prime annuelle ($)',
      modalPremium: 'Prime modale ($)',
      frequency: 'Fréquence de paiement',
      effectiveDate: 'Date d’effet',
      expiryDate: 'Date d’échéance (facultatif)',
      statementRef: 'Référence du relevé',
      statementDate: 'Date du relevé',
      csvData: 'Contenu CSV (RFC 4180)',
      csvHelp: 'En-têtes requis : PolicyNumber, GrossAmount, NetAmount, TransactionType, ProducerCode',
      reason: 'Motif de l’écart ou de la résolution',
      linkToPolicy: 'Lier à l’identifiant de police (facultatif)',
    },
    emptyPolicies: 'Aucune police enregistrée pour l’instant.',
    emptyStatements: 'Aucun relevé d’assureur téléversé pour l’instant.',
    sealedNotice: 'Ce relevé est approuvé et scellé par déclencheurs de base de données PostgreSQL. Aucune modification directe n’est permise. Les régularisations nécessitent un relevé de contre-passation.',
  },
};

function formatMoney(cents: number, locale: string): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CommercialPage({
  call,
  locale = 'en',
  openImportId,
}: {
  call: Call;
  locale?: Locale | string;
  openImportId?: string;
}) {
  const t = STRINGS[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [tab, setTab] = useState<'policies' | 'commissions' | 'kpis'>('policies');
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [statements, setStatements] = useState<CommissionImport[]>([]);
  const [kpis, setKpis] = useState<CommercialKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [carrierFilter, setCarrierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawers
  const [newPolicyOpen, setNewPolicyOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activeImport, setActiveImport] = useState<{
    import: CommissionImport;
    lines: CommissionLineItem[];
    splits: CommissionSplit[];
  } | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [resolveLine, setResolveLine] = useState<CommissionLineItem | null>(null);

  // Form states
  const [policyForm, setPolicyForm] = useState({
    carrierId: 'ia-financial-group',
    policyNumber: '',
    planName: '',
    jurisdiction: 'QC',
    annualPremium: '',
    modalPremium: '',
    premiumFrequency: 'monthly',
    effectiveDate: new Date().toISOString().slice(0, 10),
  });

  const [statementForm, setStatementForm] = useState({
    carrierId: 'ia-financial-group',
    statementReference: '',
    statementDate: new Date().toISOString().slice(0, 10),
    csvContent: '',
  });

  const [resolveForm, setResolveForm] = useState({
    policyId: '',
    reconciliationStatus: 'matched' as const,
    exceptionReason: '',
  });

  const loadAll = async () => {
    setLoading(true);
    setErr('');
    try {
      const [polRes, stmtRes, kpiRes] = await Promise.all([
        call('GET', '/v1/commercial/policies?limit=100'),
        call('GET', '/v1/commercial/commission-imports?limit=100'),
        call('GET', '/v1/commercial/kpis').catch(() => null),
      ]);
      setPolicies(polRes?.policies ?? []);
      setStatements(stmtRes?.imports ?? []);
      if (kpiRes) setKpis(kpiRes);

      if (openImportId) {
        const d = await call('GET', `/v1/commercial/commission-imports/${openImportId}`);
        if (d?.import) setActiveImport(d);
        setTab('commissions');
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [openImportId]);

  const handleCreatePolicy = async (e: Event) => {
    e.preventDefault();
    setErr('');
    try {
      const annualCents = Math.round(parseFloat(policyForm.annualPremium) * 100);
      const modalCents = Math.round(parseFloat(policyForm.modalPremium) * 100);
      if (isNaN(annualCents) || isNaN(modalCents) || annualCents < 0 || modalCents < 0) {
        throw new Error('Valid monetary premium amounts are required');
      }
      if (!policyForm.policyNumber.trim() || !policyForm.planName.trim()) {
        throw new Error('Policy number and plan name are required');
      }

      await call('POST', '/v1/commercial/policies', {
        carrierId: policyForm.carrierId,
        policyNumber: policyForm.policyNumber.trim(),
        planName: policyForm.planName.trim(),
        jurisdiction: policyForm.jurisdiction.trim().toUpperCase(),
        annualPremiumCents: annualCents,
        modalPremiumCents: modalCents,
        premiumFrequency: policyForm.premiumFrequency,
        status: 'active',
        effectiveDate: policyForm.effectiveDate,
      });

      setNewPolicyOpen(false);
      setPolicyForm({
        carrierId: 'ia-financial-group',
        policyNumber: '',
        planName: '',
        jurisdiction: 'QC',
        annualPremium: '',
        modalPremium: '',
        premiumFrequency: 'monthly',
        effectiveDate: new Date().toISOString().slice(0, 10),
      });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handlePreviewStatement = async () => {
    setErr('');
    setPreviewData(null);
    try {
      if (!statementForm.csvContent.trim()) throw new Error('CSV content is required');
      const res = await call('POST', '/v1/commercial/commission-imports/csv-preview', {
        carrierId: statementForm.carrierId,
        csvContent: statementForm.csvContent,
      });
      setPreviewData(res.preview);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRegisterStatement = async (e: Event) => {
    e.preventDefault();
    setErr('');
    try {
      if (!statementForm.statementReference.trim()) throw new Error('Statement reference is required');
      if (!statementForm.csvContent.trim()) throw new Error('CSV content is required');

      const res = await call('POST', '/v1/commercial/commission-imports/csv', {
        carrierId: statementForm.carrierId,
        statementReference: statementForm.statementReference.trim(),
        statementDate: statementForm.statementDate,
        csvContent: statementForm.csvContent,
      });

      setUploadOpen(false);
      setPreviewData(null);
      setStatementForm({
        carrierId: 'ia-financial-group',
        statementReference: '',
        statementDate: new Date().toISOString().slice(0, 10),
        csvContent: '',
      });
      await loadAll();
      if (res?.import?.id) {
        const detail = await call('GET', `/v1/commercial/commission-imports/${res.import.id}`);
        setActiveImport(detail);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleApproveStatement = async (importId: string) => {
    setErr('');
    try {
      await call('POST', `/v1/commercial/commission-imports/${importId}/approve`);
      await loadAll();
      const detail = await call('GET', `/v1/commercial/commission-imports/${importId}`);
      setActiveImport(detail);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleResolveException = async (e: Event) => {
    e.preventDefault();
    if (!activeImport || !resolveLine) return;
    setErr('');
    try {
      await call(
        'POST',
        `/v1/commercial/commission-imports/${activeImport.import.id}/lines/${resolveLine.id}/resolve`,
        {
          policyId: resolveForm.policyId.trim() || undefined,
          reconciliationStatus: resolveForm.reconciliationStatus,
          exceptionReason: resolveForm.exceptionReason.trim() || undefined,
        }
      );
      setResolveLine(null);
      const detail = await call('GET', `/v1/commercial/commission-imports/${activeImport.import.id}`);
      setActiveImport(detail);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (carrierFilter && p.carrier_id !== carrierFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.policy_number.toLowerCase().includes(q) ||
          p.plan_name.toLowerCase().includes(q) ||
          (p.producer_name && p.producer_name.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [policies, carrierFilter, statusFilter, searchQuery]);

  return (
    <div class="home">
      <div class="hwelcome">
        <div>
          <h2 style={{ margin: 0 }}>{t.title}</h2>
          <span class="muted">{t.sub}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {tab === 'policies' && (
            <button class="btn" onClick={() => setNewPolicyOpen(true)}>
              + {t.actions.newPolicy}
            </button>
          )}
          {tab === 'commissions' && (
            <button class="btn" onClick={() => setUploadOpen(true)}>
              + {t.actions.uploadStatement}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div class="err" role="alert" style={{ marginBottom: '16px' }}>
          {err}
        </div>
      )}

      {/* Top Metrics Row */}
      {kpis && (
        <div class="rstats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '20px' }}>
          <div class="rstat">
            <b>{kpis.activePoliciesCount}</b>
            <span>{t.metrics.activePolicies}</span>
          </div>
          <div class="rstat">
            <b>{formatMoney(kpis.totalAnnualPremiumCents, locale)}</b>
            <span>{t.metrics.inForcePremium}</span>
          </div>
          <div class="rstat warn">
            <b>{kpis.pendingReconciliationCount}</b>
            <span>{t.metrics.pendingStatements}</span>
          </div>
          <div class="rstat ok">
            <b>{formatMoney(kpis.netRemittanceCents, locale)}</b>
            <span>{t.metrics.netRemittance}</span>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div class="seg" role="tablist" style={{ marginBottom: '20px' }}>
        <button
          role="tab"
          aria-selected={tab === 'policies'}
          class={tab === 'policies' ? 'on' : ''}
          onClick={() => setTab('policies')}
        >
          {t.tabs.policies} ({policies.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'commissions'}
          class={tab === 'commissions' ? 'on' : ''}
          onClick={() => setTab('commissions')}
        >
          {t.tabs.commissions} ({statements.length})
        </button>
      </div>

      {/* Policies Inventory Tab */}
      {tab === 'policies' && (
        <div class="hcard">
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder={t.actions.search}
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
            <select
              value={carrierFilter}
              onChange={(e) => setCarrierFilter((e.target as HTMLSelectElement).value)}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            >
              <option value="">All Carriers</option>
              {CARRIERS.map((c) => (
                <option value={c.id} key={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="grace">Grace Period</option>
              <option value="lapsed">Lapsed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {filteredPolicies.length === 0 ? (
            <p class="muted" style={{ padding: '24px', textAlign: 'center' }}>
              {t.emptyPolicies}
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', fontSize: '13px', color: '#6b7280' }}>
                  <th style={{ padding: '10px' }}>Policy #</th>
                  <th style={{ padding: '10px' }}>Carrier</th>
                  <th style={{ padding: '10px' }}>Plan</th>
                  <th style={{ padding: '10px' }}>Territory</th>
                  <th style={{ padding: '10px' }}>Annual Premium</th>
                  <th style={{ padding: '10px' }}>Modal</th>
                  <th style={{ padding: '10px' }}>Status</th>
                  <th style={{ padding: '10px' }}>Effective Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>{p.policy_number}</td>
                    <td style={{ padding: '10px' }}>{CARRIERS.find((c) => c.id === p.carrier_id)?.name ?? p.carrier_id}</td>
                    <td style={{ padding: '10px' }}>{p.plan_name}</td>
                    <td style={{ padding: '10px' }}>
                      <span class="chip">{p.jurisdiction}</span>
                    </td>
                    <td style={{ padding: '10px', fontWeight: 600 }}>
                      {formatMoney(p.annual_premium_cents, locale)}
                    </td>
                    <td style={{ padding: '10px', color: '#6b7280', fontSize: '13px' }}>
                      {formatMoney(p.modal_premium_cents, locale)} / {p.premium_frequency}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span class={`chip ${p.status === 'active' ? 'ok' : p.status === 'grace' ? 'warn' : 'bad'}`}>
                        {t.status[p.status as keyof typeof t.status] ?? p.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px', color: '#6b7280', fontSize: '13px' }}>
                      {p.effective_date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Commission Statements Tab */}
      {tab === 'commissions' && (
        <div class="hcard">
          {statements.length === 0 ? (
            <p class="muted" style={{ padding: '24px', textAlign: 'center' }}>
              {t.emptyStatements}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {statements.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    background: activeImport?.import?.id === s.id ? '#f5f3ff' : '#fff',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <b>{s.statement_reference}</b>
                      <span class="chip">{CARRIERS.find((c) => c.id === s.carrier_id)?.name ?? s.carrier_id}</span>
                      <span class={`chip ${s.status === 'approved' ? 'ok' : s.status === 'exceptions_flagged' ? 'bad' : 'warn'}`}>
                        {t.status[s.status] ?? s.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                      {s.statement_date} · {s.line_count} lines · Gross: {formatMoney(s.total_gross_cents, locale)} · Net: {formatMoney(s.total_net_cents, locale)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      class="btn quiet"
                      onClick={async () => {
                        const detail = await call('GET', `/v1/commercial/commission-imports/${s.id}`);
                        setActiveImport(detail);
                      }}
                    >
                      Inspect & Splits
                    </button>
                    {s.status !== 'approved' && s.status !== 'posted' && (
                      <button
                        class="btn"
                        onClick={() => handleApproveStatement(s.id)}
                        disabled={s.status === 'exceptions_flagged'}
                        title={s.status === 'exceptions_flagged' ? 'Resolve exceptions before approval' : ''}
                      >
                        {t.actions.approve}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Statement Inspection Drawer / Modal */}
      {activeImport && (
        <aside class="drawer" style={{ maxWidth: '780px', width: '100%', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0 }}>{activeImport.import.statement_reference}</h3>
              <span class="muted">
                {CARRIERS.find((c) => c.id === activeImport.import.carrier_id)?.name} · {activeImport.import.statement_date}
              </span>
            </div>
            <button class="btn quiet" onClick={() => setActiveImport(null)}>
              {t.actions.close}
            </button>
          </div>

          {activeImport.import.status === 'approved' && (
            <div style={{ background: '#ecfdf5', border: '1px solid #10b981', color: '#065f46', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
              ✓ {t.sealedNotice}
            </div>
          )}

          <div class="rstats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '16px' }}>
            <div class="rstat">
              <b>{formatMoney(activeImport.import.total_gross_cents, locale)}</b>
              <span>Statement Gross</span>
            </div>
            <div class="rstat">
              <b>{formatMoney(activeImport.import.total_net_cents, locale)}</b>
              <span>Statement Net</span>
            </div>
            <div class={`rstat ${activeImport.import.status === 'approved' ? 'ok' : 'warn'}`}>
              <b>{activeImport.import.line_count}</b>
              <span>{t.status[activeImport.import.status] ?? activeImport.import.status}</span>
            </div>
          </div>

          <h4>Statement Line Items</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '24px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ padding: '8px' }}>Policy #</th>
                <th style={{ padding: '8px' }}>Type</th>
                <th style={{ padding: '8px' }}>Gross</th>
                <th style={{ padding: '8px' }}>Net</th>
                <th style={{ padding: '8px' }}>Status</th>
                <th style={{ padding: '8px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeImport.lines.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{l.policy_number}</td>
                  <td style={{ padding: '8px' }}>{l.transaction_type}</td>
                  <td style={{ padding: '8px', color: l.gross_amount_cents < 0 ? '#b91c1c' : 'inherit' }}>
                    {formatMoney(l.gross_amount_cents, locale)}
                  </td>
                  <td style={{ padding: '8px', color: l.net_amount_cents < 0 ? '#b91c1c' : 'inherit' }}>
                    {formatMoney(l.net_amount_cents, locale)}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <span class={`chip ${l.reconciliation_status === 'matched' ? 'ok' : l.reconciliation_status === 'unmatched' ? 'bad' : 'warn'}`}>
                      {t.status[l.reconciliation_status] ?? l.reconciliation_status}
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>
                    {l.reconciliation_status === 'unmatched' && activeImport.import.status !== 'approved' && (
                      <button
                        class="btn quiet"
                        style={{ fontSize: '12px', padding: '4px 8px' }}
                        onClick={() => {
                          setResolveLine(l);
                          setResolveForm({
                            policyId: '',
                            reconciliationStatus: 'matched',
                            exceptionReason: '',
                          });
                        }}
                      >
                        {t.actions.resolve}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {activeImport.splits.length > 0 && (
            <>
              <h4>Deterministic Calculated Commission Splits</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                    <th style={{ padding: '8px' }}>Producer Net</th>
                    <th style={{ padding: '8px' }}>Branch Override</th>
                    <th style={{ padding: '8px' }}>MGA Spread</th>
                    <th style={{ padding: '8px' }}>Holdback</th>
                    <th style={{ padding: '8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeImport.splits.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: '#047857' }}>
                        {formatMoney(s.broker_net_cents, locale)}
                      </td>
                      <td style={{ padding: '8px' }}>{formatMoney(s.branch_override_cents, locale)}</td>
                      <td style={{ padding: '8px' }}>{formatMoney(s.mga_spread_cents, locale)}</td>
                      <td style={{ padding: '8px', color: s.holdback_cents > 0 ? '#b45309' : '#6b7280' }}>
                        {formatMoney(s.holdback_cents, locale)}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span class={`chip ${s.status === 'approved' ? 'ok' : 'warn'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </aside>
      )}

      {/* Upload Statement Modal */}
      {uploadOpen && (
        <div class="modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div class="hcard" style={{ maxWidth: '600px', width: '90%', padding: '24px', background: '#fff', borderRadius: '12px' }}>
            <h3>{t.actions.uploadStatement}</h3>
            <form onSubmit={handleRegisterStatement}>
              <div class="fld">
                <label>{t.form.carrier}</label>
                <select
                  value={statementForm.carrierId}
                  onChange={(e) => setStatementForm({ ...statementForm, carrierId: (e.target as HTMLSelectElement).value })}
                >
                  {CARRIERS.map((c) => (
                    <option value={c.id} key={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div class="fld">
                  <label>{t.form.statementRef}</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. IA-2026-NOV-01"
                    value={statementForm.statementReference}
                    onInput={(e) => setStatementForm({ ...statementForm, statementReference: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="fld">
                  <label>{t.form.statementDate}</label>
                  <input
                    type="date"
                    required
                    value={statementForm.statementDate}
                    onChange={(e) => setStatementForm({ ...statementForm, statementDate: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </div>

              <div class="fld">
                <label>{t.form.csvData}</label>
                <small class="muted" style={{ display: 'block', marginBottom: '6px' }}>{t.form.csvHelp}</small>
                <textarea
                  rows={6}
                  required
                  placeholder="PolicyNumber,GrossAmount,NetAmount,TransactionType,ProducerCode&#10;POL-1001,1500.00,1200.00,first_year,QC-01"
                  value={statementForm.csvContent}
                  onInput={(e) => setStatementForm({ ...statementForm, csvContent: (e.target as HTMLTextAreaElement).value })}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>

              {previewData && (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', padding: '12px', borderRadius: '6px', margin: '12px 0', fontSize: '13px' }}>
                  <b>Pre-Commit Preview:</b>
                  <div>Lines: {previewData.lineCount} · Matched: {previewData.matchedCount} · Chargebacks: {previewData.chargebackCount} · Unmatched: {previewData.unmatchedCount}</div>
                  <div>Gross: {formatMoney(previewData.totalGrossCents, locale)} · Net: {formatMoney(previewData.totalNetCents, locale)}</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button type="button" class="btn quiet" onClick={handlePreviewStatement}>
                  {t.actions.preview}
                </button>
                <button type="button" class="btn quiet" onClick={() => setUploadOpen(false)}>
                  {t.actions.cancel}
                </button>
                <button type="submit" class="btn">
                  {t.actions.register}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Policy Modal */}
      {newPolicyOpen && (
        <div class="modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div class="hcard" style={{ maxWidth: '540px', width: '90%', padding: '24px', background: '#fff', borderRadius: '12px' }}>
            <h3>{t.actions.newPolicy}</h3>
            <form onSubmit={handleCreatePolicy}>
              <div class="fld">
                <label>{t.form.carrier}</label>
                <select
                  value={policyForm.carrierId}
                  onChange={(e) => setPolicyForm({ ...policyForm, carrierId: (e.target as HTMLSelectElement).value })}
                >
                  {CARRIERS.map((c) => (
                    <option value={c.id} key={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div class="fld">
                  <label>{t.form.policyNumber}</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. POL-99283"
                    value={policyForm.policyNumber}
                    onInput={(e) => setPolicyForm({ ...policyForm, policyNumber: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="fld">
                  <label>{t.form.jurisdiction}</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    placeholder="e.g. QC or ON"
                    value={policyForm.jurisdiction}
                    onInput={(e) => setPolicyForm({ ...policyForm, jurisdiction: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </div>

              <div class="fld">
                <label>{t.form.planName}</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. EquiBuild Participating Whole Life"
                  value={policyForm.planName}
                  onInput={(e) => setPolicyForm({ ...policyForm, planName: (e.target as HTMLInputElement).value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div class="fld">
                  <label>{t.form.annualPremium}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="2400.00"
                    value={policyForm.annualPremium}
                    onInput={(e) => setPolicyForm({ ...policyForm, annualPremium: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="fld">
                  <label>{t.form.modalPremium}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="200.00"
                    value={policyForm.modalPremium}
                    onInput={(e) => setPolicyForm({ ...policyForm, modalPremium: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div class="fld">
                  <label>{t.form.frequency}</label>
                  <select
                    value={policyForm.premiumFrequency}
                    onChange={(e) => setPolicyForm({ ...policyForm, premiumFrequency: (e.target as HTMLSelectElement).value })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="semi_annual">Semi-Annual</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div class="fld">
                  <label>{t.form.effectiveDate}</label>
                  <input
                    type="date"
                    required
                    value={policyForm.effectiveDate}
                    onChange={(e) => setPolicyForm({ ...policyForm, effectiveDate: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button type="button" class="btn quiet" onClick={() => setNewPolicyOpen(false)}>
                  {t.actions.cancel}
                </button>
                <button type="submit" class="btn">
                  {t.actions.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Exception Resolution Modal */}
      {resolveLine && (
        <div class="modal-bg" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 110 }}>
          <div class="hcard" style={{ maxWidth: '480px', width: '90%', padding: '24px', background: '#fff', borderRadius: '12px' }}>
            <h3>{t.actions.resolve}: {resolveLine.policy_number}</h3>
            <p class="muted" style={{ fontSize: '13px' }}>
              Gross: {formatMoney(resolveLine.gross_amount_cents, locale)} · Net: {formatMoney(resolveLine.net_amount_cents, locale)} · Type: {resolveLine.transaction_type}
            </p>
            <form onSubmit={handleResolveException}>
              <div class="fld">
                <label>Resolution Action</label>
                <select
                  value={resolveForm.reconciliationStatus}
                  onChange={(e) => setResolveForm({ ...resolveForm, reconciliationStatus: (e.target as HTMLSelectElement).value as any })}
                >
                  <option value="matched">Link & Match Policy</option>
                  <option value="variance_flagged">Flag Variance / Exception</option>
                </select>
              </div>

              {resolveForm.reconciliationStatus === 'matched' && (
                <div class="fld">
                  <label>{t.form.linkToPolicy}</label>
                  <select
                    value={resolveForm.policyId}
                    onChange={(e) => setResolveForm({ ...resolveForm, policyId: (e.target as HTMLSelectElement).value })}
                  >
                    <option value="">Select Existing Policy Record</option>
                    {policies.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.policy_number} — {p.plan_name} ({CARRIERS.find((c) => c.id === p.carrier_id)?.name})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div class="fld">
                <label>{t.form.reason}</label>
                <textarea
                  rows={3}
                  placeholder="Explain why this line is approved or variance confirmed…"
                  value={resolveForm.exceptionReason}
                  onInput={(e) => setResolveForm({ ...resolveForm, exceptionReason: (e.target as HTMLTextAreaElement).value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button type="button" class="btn quiet" onClick={() => setResolveLine(null)}>
                  {t.actions.cancel}
                </button>
                <button type="submit" class="btn">
                  {t.actions.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
