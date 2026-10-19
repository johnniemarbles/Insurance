import { useEffect, useRef, useState } from 'preact/hooks';
import { CarrierEvidenceForm } from './carrier-evidence.tsx';
import { CarrierAuthorizationEvidencePanel } from './carrier-authorization-evidence.tsx';
import { CarrierHoldsPanel } from './carrier-holds.tsx';
import { CarrierBusinessStagingPanel } from './carrier-business-staging.tsx';
import { CarrierConnectionStatusPanel } from './carrier-connection-status.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

interface CarrierDirItem {
  id: string;
  displayName: string;
  country: string;
  connectionMode: string;
  connectionVerified: boolean;
  configuredMode: string | null;
  recipientTo: string | null;
  recipientCc: string[] | null;
  sendingEnabled: boolean | null;
  recipientVerifiedAt: string | null;
}

interface ContractCase {
  id: string;
  onboardingCaseId: string;
  nodeId: string;
  carrierName: string;
  carrierId: string | null;
  jurisdiction: string;
  state: string;
  effectiveState?: string;
  templateVersion: string | null;
  signatureEvidenceRef: string | null;
  carrierApprovalRef: string | null;
  appointmentReference: string | null;
  appointmentEffectiveOn: string | null;
  appointmentExpiresOn: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubmissionRecord {
  id: string;
  contractId: string;
  carrierId: string;
  carrierName: string;
  submissionMode: string;
  recipientTo: string | null;
  subject: string;
  packageHash: string;
  status: string;
  responseReference: string | null;
  submittedAt: string;
  submittedByName: string | null;
}

interface ActionItem {
  contractId: string;
  carrierName: string;
  jurisdiction: string;
  type: string;
  message: string;
}

interface AuditRecord {
  id: string;
  contractId: string;
  carrierName: string;
  fromState: string | null;
  toState: string;
  actorName: string | null;
  reason: string | null;
  recordedAt: string;
}

interface DocItem {
  id: string;
  documentType: string;
  title: string;
  fileName: string;
  contentHash: string;
  fileSizeBytes: number;
  mimeType: string;
  status: string;
  notes: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

interface ChecklistItem {
  type: string;
  title: string;
  required: boolean;
  satisfied: boolean;
  documentCount: number;
}

type TabKey = 'directory' | 'applications' | 'actions' | 'submissions' | 'appointments' | 'audit';

export function CarrierReviewPanel({ call, locale, partnerNodeId }: { call: Call; locale: string; partnerNodeId?: string }) {
  const fr = locale === 'fr-CA';
  const [activeTab, setActiveTab] = useState<TabKey>(partnerNodeId ? 'applications' : 'directory');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Dashboard Data
  const [directory, setDirectory] = useState<CarrierDirItem[]>([]);
  const [cases, setCases] = useState<ContractCase[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditRecord[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    draft: 0,
    pendingSignature: 0,
    complianceReview: 0,
    submitted: 0,
    approved: 0,
    activeAppointments: 0,
    attentionRequired: 0,
  });

  // Selected case state for operations
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDocs, setCaseDocs] = useState<Record<string, { docs: DocItem[]; checklist: ChecklistItem[]; allRequiredMet: boolean }>>({});
  const [docLoading, setDocLoading] = useState(false);

  // Form states for operations
  const [newDocType, setNewDocType] = useState('licence');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocFileName, setNewDocFileName] = useState('');
  const [newDocHash, setNewDocHash] = useState('');
  const [signerName, setSignerName] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // Submission & Appointment states
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [apptRef, setApptRef] = useState('');
  const [apptEff, setApptEff] = useState(new Date().toISOString().slice(0, 10));
  const [apptExp, setApptExp] = useState(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
  const [respStatus, setRespStatus] = useState<'acknowledged' | 'additional_info_requested' | 'carrier_approved' | 'declined'>('acknowledged');
  const [respRef, setRespRef] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [appFilter, setAppFilter] = useState('all');

  const refreshDashboard = async () => {
    setLoading(true);
    try {
      const data = await call('GET', '/v1/compliance/carrier-dashboard');
      setDirectory(partnerNodeId ? [] : (data.directory ?? []));
      const scopedCases: ContractCase[] = (data.cases ?? []).filter((item: ContractCase) => !partnerNodeId || item.nodeId === partnerNodeId);
      const caseIds = new Set(scopedCases.map(item => item.id));
      const scopedSubmissions: SubmissionRecord[] = (data.submissions ?? []).filter((item: SubmissionRecord) => !partnerNodeId || caseIds.has(item.contractId));
      const scopedActions: ActionItem[] = (data.actionRequired ?? []).filter((item: ActionItem) => !partnerNodeId || caseIds.has(item.contractId));
      const scopedAudit: AuditRecord[] = (data.auditEvents ?? []).filter((item: AuditRecord) => !partnerNodeId || caseIds.has(item.contractId));
      setCases(scopedCases);
      setSubmissions(scopedSubmissions);
      setActions(scopedActions);
      setAuditEvents(scopedAudit);
      setSummary(partnerNodeId ? {
        total: scopedCases.length,
        draft: scopedCases.filter(item => item.state === 'requested').length,
        pendingSignature: scopedCases.filter(item => item.state === 'documents_prepared').length,
        complianceReview: scopedCases.filter(item => item.state === 'broker_signed').length,
        submitted: scopedCases.filter(item => ['submitted','carrier_review'].includes(item.state)).length,
        approved: scopedCases.filter(item => ['approved','appointment_verified','active'].includes(item.state)).length,
        activeAppointments: scopedCases.filter(item => item.effectiveState === 'active').length,
        attentionRequired: scopedActions.length,
      } : data.summary ?? {
        total: 0, draft: 0, pendingSignature: 0, complianceReview: 0,
        submitted: 0, approved: 0, activeAppointments: 0, attentionRequired: 0,
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshDashboard();
  }, [call, partnerNodeId]);

  const loadCaseDocs = async (id: string) => {
    setDocLoading(true);
    try {
      const r = await call('GET', `/v1/compliance/carrier-contracts/${id}/documents`);
      setCaseDocs(prev => ({
        ...prev,
        [id]: { docs: r.documents ?? [], checklist: r.checklist ?? [], allRequiredMet: r.allRequiredMet ?? false },
      }));
    } catch (err) {
      setError(String(err));
    } finally {
      setDocLoading(false);
    }
  };

  const handleFileSelect = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setNewDocFileName(file.name);
    if (!newDocTitle.trim()) {
      setNewDocTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      setNewDocHash(hashHex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute SHA-256 hash');
    }
  };

  const handleAttachDoc = async (id: string) => {
    if (!newDocTitle.trim() || !newDocFileName.trim()) {
      setError(fr ? 'Titre et nom de fichier requis.' : 'Title and file name are required.');
      return;
    }
    const hash = newDocHash.trim();
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      setError(fr ? 'Empreinte SHA-256 valide (64 caractères hexadécimaux) requise.' : 'Valid 64-character SHA-256 content hash required.');
      return;
    }
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/documents`, {
        documentType: newDocType,
        title: newDocTitle.trim(),
        fileName: newDocFileName.trim(),
        contentHash: hash,
        fileSizeBytes: 245000,
        mimeType: 'application/pdf',
      });
      setNewDocTitle('');
      setNewDocFileName('');
      setNewDocHash('');
      await loadCaseDocs(id);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePreparePacket = async (id: string) => {
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/prepare-packet`, { templateVersion: 'v2026.1' });
      await refreshDashboard();
      await loadCaseDocs(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignPacket = async (id: string) => {
    if (!consentConfirmed) {
      setError(fr ? 'Le consentement exprès du courtier doit être confirmé.' : 'Broker express consent must be confirmed.');
      return;
    }
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/sign-packet`, {
        signerName: signerName.trim() || undefined,
        consentRecorded: true,
      });
      setConsentConfirmed(false);
      setSignerName('');
      await refreshDashboard();
      await loadCaseDocs(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitPackage = async (id: string, mode: 'manual' | 'email') => {
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/submit-package`, {
        mode,
        notes: submissionNotes,
      });
      setSubmissionNotes('');
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRecordResponse = async (id: string) => {
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/record-response`, {
        responseStatus: respStatus,
        reference: respRef.trim() || undefined,
      });
      setRespRef('');
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyAppointment = async (id: string, activateNow = true) => {
    if (!apptRef.trim()) {
      setError(fr ? 'Numéro de référence de nomination requis.' : 'Appointment reference is required.');
      return;
    }
    setBusy(true);
    try {
      await call('POST', `/v1/compliance/carrier-contracts/${id}/verify-appointment`, {
        appointmentReference: apptRef.trim(),
        effectiveOn: apptEff,
        expiresOn: apptExp,
        activateNow,
      });
      setApptRef('');
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const filteredCases = cases.filter(c => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.carrierName.toLowerCase().includes(q) || c.jurisdiction.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    const matchesFilter = appFilter === 'all' ||
      (appFilter === 'draft' && c.state === 'requested') ||
      (appFilter === 'signature' && c.state === 'documents_prepared') ||
      (appFilter === 'review' && c.state === 'broker_signed') ||
      (appFilter === 'submitted' && ['submitted', 'carrier_review'].includes(c.state)) ||
      (appFilter === 'approved' && ['approved', 'appointment_verified', 'active'].includes(c.state));
    return matchesSearch && matchesFilter;
  });

  return (
    <section class="carrier-review-wrap" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '60px' }}>
      {/* 1. Header & Summary Metrics */}
      <div class="obcard">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '20px', color: 'var(--navy)' }}>
              {fr ? 'Gestion des contrats directs avec les assureurs' : 'Operational Carrier Contracting & Appointments'}
            </h2>
            <p class="muted" style={{ margin: 0, fontSize: '13px' }}>
              {fr
                ? 'Punjab Insurance Agency — Soumission directe, e-signatures, approbation et suivi pour iA, Manulife, Sun Life et Canada Life.'
                : 'Punjab Insurance Agency — Direct application preparation, e-signatures, compliance approval, controlled dispatch and appointment verification.'}
            </p>
          </div>
          <button class="btn quiet" type="button" disabled={loading || busy} onClick={() => void refreshDashboard()}>
            {loading ? (fr ? 'Actualisation…' : 'Refreshing…') : (fr ? 'Actualiser' : 'Refresh')}
          </button>
        </div>

        {/* Metric Tiles */}
        <div class="ui-stat-grid" style={{ marginTop: '16px' }}>
          <div class="ui-stat-tile">
            <span class="ui-stat-val">{summary.total}</span>
            <span class="ui-stat-lbl">{fr ? 'Dossiers totaux' : 'Total Cases'}</span>
          </div>
          <div class="ui-stat-tile" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('applications'); setAppFilter('signature'); }}>
            <span class="ui-stat-val" style={{ color: summary.pendingSignature > 0 ? 'var(--warn)' : 'inherit' }}>
              {summary.pendingSignature}
            </span>
            <span class="ui-stat-lbl">{fr ? 'En attente de signature' : 'Pending Signature'}</span>
          </div>
          <div class="ui-stat-tile" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('applications'); setAppFilter('review'); }}>
            <span class="ui-stat-val" style={{ color: summary.complianceReview > 0 ? 'var(--pri)' : 'inherit' }}>
              {summary.complianceReview}
            </span>
            <span class="ui-stat-lbl">{fr ? 'Examen conformité' : 'Compliance Review'}</span>
          </div>
          <div class="ui-stat-tile" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('applications'); setAppFilter('submitted'); }}>
            <span class="ui-stat-val">{summary.submitted}</span>
            <span class="ui-stat-lbl">{fr ? 'Soumis à l’assureur' : 'Submitted to Carrier'}</span>
          </div>
          <div class="ui-stat-tile" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('appointments')}>
            <span class="ui-stat-val" style={{ color: 'var(--ok)' }}>{summary.activeAppointments}</span>
            <span class="ui-stat-lbl">{fr ? 'Nominations actives' : 'Active Appointments'}</span>
          </div>
          <div class="ui-stat-tile" style={{ cursor: 'pointer', background: summary.attentionRequired > 0 ? 'var(--warn-soft)' : undefined }} onClick={() => setActiveTab('actions')}>
            <span class="ui-stat-val" style={{ color: summary.attentionRequired > 0 ? 'var(--warn)' : 'inherit' }}>
              {summary.attentionRequired}
            </span>
            <span class="ui-stat-lbl">{fr ? 'Actions requises' : 'Action Required'}</span>
          </div>
        </div>
      </div>

      {error && <div role="alert" class="err" style={{ background: 'var(--err-soft)', borderRadius: '8px', padding: '10px 14px' }}>{error}</div>}

      {/* 2. Navigation Tabs */}
      <div class="carrier-dash-tabs" role="tablist">
        {!partnerNodeId && <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'directory' ? 'active' : ''}`}
          aria-selected={activeTab === 'directory'}
          onClick={() => setActiveTab('directory')}
        >
          {fr ? 'Statut & Certification' : 'Connection Status & Certification'}
        </button>}
        <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'applications' ? 'active' : ''}`}
          aria-selected={activeTab === 'applications'}
          onClick={() => setActiveTab('applications')}
        >
          {fr ? 'Dossiers & Candidatures' : 'Applications'} ({cases.length})
        </button>
        <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'actions' ? 'active' : ''}`}
          aria-selected={activeTab === 'actions'}
          onClick={() => setActiveTab('actions')}
        >
          {fr ? 'Actions requises' : 'Action Required'} {actions.length > 0 && <span class="pill" style={{ background: 'var(--warn)', marginLeft: '6px' }}>{actions.length}</span>}
        </button>
        <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'submissions' ? 'active' : ''}`}
          aria-selected={activeTab === 'submissions'}
          onClick={() => setActiveTab('submissions')}
        >
          {fr ? 'Suivi des envois' : 'Submission Tracking'} ({submissions.length})
        </button>
        <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'appointments' ? 'active' : ''}`}
          aria-selected={activeTab === 'appointments'}
          onClick={() => setActiveTab('appointments')}
        >
          {fr ? 'Nominations' : 'Appointments'}
        </button>
        <button
          role="tab"
          class={`carrier-dash-tab ${activeTab === 'audit' ? 'active' : ''}`}
          aria-selected={activeTab === 'audit'}
          onClick={() => setActiveTab('audit')}
        >
          {fr ? 'Journal d’audit' : 'Audit History'}
        </button>
      </div>

      {/* 3. Tab Contents */}

      {/* TAB 1: Carrier Connection Status & Certification Screen */}
      {activeTab === 'directory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <CarrierConnectionStatusPanel call={call} locale={locale} />

          <div class="obcard">
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: 'var(--navy)' }}>
              {fr ? 'Paramètres d’expédition des dossiers' : 'Direct Contracting Submission Settings'}
            </h3>
            <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
              {fr
                ? 'Adresses de destination et vérifications administratives pour chaque assureur partenaire.'
                : 'Configured submission modes, recipient addresses, and verification safeguards for each partner carrier.'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              {directory.map(carrier => (
                <div key={carrier.id} class="hcard" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '15px', color: 'var(--navy)' }}>{carrier.displayName}</strong>
                    <span class={`pill ${carrier.configuredMode === 'semi_automated' ? 'ok' : 'muted'}`} style={{ fontSize: '11px' }}>
                      {carrier.configuredMode === 'semi_automated' ? (fr ? 'Semi-automatique' : 'Semi-Automated') : (fr ? 'Export manuel' : 'Manual Export')}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--mute)' }}>
                    <div>{fr ? 'Pays' : 'Country'}: <strong>{carrier.country}</strong></div>
                    <div>
                      {fr ? 'Destinataire' : 'Primary Recipient'}:{' '}
                      <strong>{carrier.recipientTo || (fr ? 'Non configuré' : 'Not configured')}</strong>
                    </div>
                    <div>
                      {fr ? 'Copies' : 'CC'}: <strong>{(carrier.recipientCc ?? []).length}</strong> {fr ? 'adresse(s)' : 'recipient(s)'}
                    </div>
                    <div>
                      {fr ? 'Envoi activé' : 'Dispatch Gate'}:{' '}
                      <span style={{ color: carrier.sendingEnabled ? 'var(--ok)' : 'var(--warn)', fontWeight: 600 }}>
                        {carrier.sendingEnabled ? (fr ? 'Activé' : 'Verified & Active') : (fr ? 'Désactivé (par défaut)' : 'Disabled by Default')}
                      </span>
                    </div>
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--line2)' }}>
                    <span class="muted" style={{ fontSize: '11px' }}>
                      {carrier.recipientVerifiedAt
                        ? (fr ? `Vérifié le ${carrier.recipientVerifiedAt.slice(0, 10)}` : `Verified on ${carrier.recipientVerifiedAt.slice(0, 10)}`)
                        : (fr ? 'Vérification du destinataire requise' : 'Recipient verification required before dispatch')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Applications Queue */}
      {activeTab === 'applications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div class="obcard" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <span style={{ fontSize: '13px', color: 'var(--mute)' }}>{fr ? 'Recherche' : 'Search'}:</span>
              <input
                type="search"
                style={{ flex: 1, padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--line2)' }}
                placeholder={fr ? 'Assureur, province, ID…' : 'Carrier, province, case ID…'}
                value={search}
                onInput={e => setSearch((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="seg" role="group">
              <button class={appFilter === 'all' ? 'active' : ''} aria-pressed={appFilter === 'all'} onClick={() => setAppFilter('all')}>
                {fr ? 'Tous' : 'All'}
              </button>
              <button class={appFilter === 'draft' ? 'active' : ''} aria-pressed={appFilter === 'draft'} onClick={() => setAppFilter('draft')}>
                {fr ? 'Brouillon' : 'Draft'}
              </button>
              <button class={appFilter === 'signature' ? 'active' : ''} aria-pressed={appFilter === 'signature'} onClick={() => setAppFilter('signature')}>
                {fr ? 'Signature' : 'Signature'}
              </button>
              <button class={appFilter === 'review' ? 'active' : ''} aria-pressed={appFilter === 'review'} onClick={() => setAppFilter('review')}>
                {fr ? 'Conformité' : 'Review'}
              </button>
              <button class={appFilter === 'submitted' ? 'active' : ''} aria-pressed={appFilter === 'submitted'} onClick={() => setAppFilter('submitted')}>
                {fr ? 'Soumis' : 'Submitted'}
              </button>
              <button class={appFilter === 'approved' ? 'active' : ''} aria-pressed={appFilter === 'approved'} onClick={() => setAppFilter('approved')}>
                {fr ? 'Approuvé' : 'Approved'}
              </button>
            </div>
          </div>

          {filteredCases.length === 0 ? (
            <div class="obcard" style={{ textAlign: 'center', padding: '32px' }}>
              <p class="muted">{fr ? 'Aucun dossier ne correspond aux critères.' : 'No contracting applications match the selected filter.'}</p>
            </div>
          ) : (
            filteredCases.map(c => {
              const isSelected = selectedCaseId === c.id;
              const docsInfo = caseDocs[c.id];

              return (
                <div key={c.id} class="obcard" style={{ borderLeft: isSelected ? '4px solid var(--pri)' : '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '16px', color: 'var(--navy)' }}>{c.carrierName}</strong>
                      <span class="muted" style={{ marginLeft: '8px', fontSize: '13px' }}>({c.jurisdiction})</span>
                      <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '2px' }}>
                        ID: <code style={{ fontSize: '11px' }}>{c.id.slice(0, 8)}</code> · {fr ? 'Modèle' : 'Template'}: {c.templateVersion ?? 'Pending'} · {fr ? 'Créé' : 'Created'}: {c.createdAt.slice(0, 10)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span class={`pill ${['active', 'approved'].includes(c.state) ? 'ok' : c.state === 'submitted' ? 'pri' : 'warn'}`}>
                        {c.state.replaceAll('_', ' ').toUpperCase()}
                      </span>
                      <button
                        class="btn quiet"
                        style={{ padding: '5px 12px', fontSize: '12px' }}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedCaseId(null);
                          } else {
                            setSelectedCaseId(c.id);
                            void loadCaseDocs(c.id);
                          }
                        }}
                      >
                        {isSelected ? (fr ? 'Fermer' : 'Close Workflow') : (fr ? 'Ouvrir dossier' : 'Manage Case')}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Case Workflow Panel */}
                  {isSelected && (
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* Step A: Application Checklist & Attachments */}
                      <div class="hcard">
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--navy)' }}>
                          {fr ? '1. Liste de contrôle des exigences assureur' : '1. Carrier Requirements & Document Checklist'}
                        </h4>
                        <p class="muted" style={{ margin: '0 0 12px', fontSize: '12px' }}>
                          {fr
                            ? 'Chaque document obligatoire doit être téléversé et vérifié avec une empreinte SHA-256.'
                            : 'Every mandatory document must be attached and validated with an immutable SHA-256 fingerprint.'}
                        </p>

                        {docLoading && !docsInfo ? (
                          <p class="muted" style={{ fontSize: '13px' }}>{fr ? 'Chargement des pièces…' : 'Loading requirements…'}</p>
                        ) : docsInfo ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {docsInfo.checklist.map(item => (
                              <div key={item.type} class={`checklist-item ${item.satisfied ? 'satisfied' : 'missing'}`}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span>{item.satisfied ? '✓' : '⚠️'}</span>
                                  <strong style={{ fontSize: '13px' }}>{item.title}</strong>
                                </div>
                                <span style={{ fontSize: '12px', color: item.satisfied ? 'var(--ok)' : 'var(--warn)' }}>
                                  {item.satisfied ? (fr ? `${item.documentCount} pièce(s) jointe(s)` : `${item.documentCount} attached`) : (fr ? 'Requis' : 'Required')}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Document Upload / Attach Form */}
                        <div style={{ marginTop: '14px', padding: '12px', background: 'var(--tint2)', borderRadius: '8px' }}>
                          <strong style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>
                            {fr ? 'Joindre un document au dossier' : 'Attach Supporting Document'}
                          </strong>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                            <label style={{ fontSize: '12px' }}>
                              Type:
                              <select
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                                value={newDocType}
                                onChange={e => setNewDocType(e.currentTarget.value)}
                              >
                                <option value="licence">Insurance Licence</option>
                                <option value="eo_insurance">E&O Certificate</option>
                                <option value="banking_void_cheque">Void Cheque / Direct Deposit</option>
                                <option value="aml_cert">AML Compliance Certificate</option>
                                <option value="carrier_app_schedule">Carrier Contracting Schedule</option>
                                <option value="signed_agreement">Signed Agency Agreement</option>
                                <option value="other">Other Supporting Record</option>
                              </select>
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              Title:
                              <input
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                                placeholder="e.g. Ontario Life Licence 2026"
                                value={newDocTitle}
                                onInput={e => setNewDocTitle((e.target as HTMLInputElement).value)}
                              />
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              File Name:
                              <input
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                                placeholder="licence_ON_2026.pdf"
                                value={newDocFileName}
                                onInput={e => setNewDocFileName((e.target as HTMLInputElement).value)}
                              />
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              {fr ? 'Fichier source :' : 'Source File:'}
                              <input
                                type="file"
                                style={{ width: '100%', padding: '4px', borderRadius: '6px', border: '1px solid var(--line2)', fontSize: '11px' }}
                                onChange={handleFileSelect}
                              />
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              SHA-256:
                              <input
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)', fontFamily: 'monospace', fontSize: '11px' }}
                                placeholder="64-char hex hash"
                                value={newDocHash}
                                onInput={e => setNewDocHash((e.target as HTMLInputElement).value)}
                              />
                            </label>
                          </div>
                          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              class="btn"
                              style={{ padding: '6px 14px', fontSize: '12px' }}
                              disabled={busy || !newDocTitle || !newDocFileName || !/^[a-f0-9]{64}$/i.test(newDocHash.trim())}
                              onClick={() => void handleAttachDoc(c.id)}
                            >
                              {busy ? 'Attaching…' : 'Attach Document'}
                            </button>
                          </div>
                        </div>

                        {/* List of Attached Documents */}
                        {docsInfo && docsInfo.docs.length > 0 && (
                          <div style={{ marginTop: '12px' }}>
                            <strong style={{ fontSize: '12px', color: 'var(--mute)' }}>{fr ? 'Documents vérifiés au dossier' : 'Attached Vault Evidence'}:</strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                              {docsInfo.docs.map(doc => (
                                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#fff', border: '1px solid var(--line2)', borderRadius: '6px', fontSize: '12px' }}>
                                  <div>
                                    <strong>{doc.title}</strong> <span class="muted">({doc.fileName})</span>
                                    <div class="hash-pill" style={{ marginTop: '2px' }}>SHA-256: {doc.contentHash.slice(0, 16)}…{doc.contentHash.slice(-8)}</div>
                                  </div>
                                  <span class="pill ok" style={{ fontSize: '11px' }}>{doc.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Step B: E-Signature & Preparation */}
                      <div class="hcard">
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--navy)' }}>
                          {fr ? '2. Préparation du dossier et signature électronique' : '2. Package Preparation & E-Signature'}
                        </h4>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {c.state === 'requested' && (
                            <button
                              class="btn"
                              disabled={busy}
                              onClick={() => void handlePreparePacket(c.id)}
                            >
                              {fr ? 'Préparer le dossier de signature (v2026.1)' : 'Prepare E-Signature Packet (v2026.1)'}
                            </button>
                          )}

                          {c.state === 'documents_prepared' && (
                            <div style={{ display: 'grid', gap: '8px', padding: '10px', background: 'var(--tint2)', borderRadius: '8px', width: '100%' }}>
                              <label style={{ fontSize: '12px' }}>
                                {fr ? 'Nom complet du signataire autorisé :' : 'Authorized Broker Full Legal Name:'}
                                <input
                                  style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                                  placeholder={fr ? 'Nom complet du courtier' : 'Broker full legal name'}
                                  value={signerName}
                                  onInput={e => setSignerName((e.target as HTMLInputElement).value)}
                                />
                              </label>
                              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={consentConfirmed}
                                  onChange={e => setConsentConfirmed((e.target as HTMLInputElement).checked)}
                                />
                                <span>{fr ? 'Le courtier a examiné et consenti formellement à cette soumission.' : 'Broker has reviewed and explicitly consented to this contracting submission.'}</span>
                              </label>
                              <button
                                class="btn primary"
                                disabled={busy || !consentConfirmed}
                                onClick={() => void handleSignPacket(c.id)}
                              >
                                {fr ? 'Enregistrer la signature électronique du courtier' : 'Record Broker E-Signature'}
                              </button>
                            </div>
                          )}

                          {c.signatureEvidenceRef && (
                            <div style={{ fontSize: '12px' }}>
                              <span class="pill ok">{fr ? 'Signé' : 'Signed'}</span>{' '}
                              <span class="hash-pill">Sig: {c.signatureEvidenceRef.slice(0, 16)}…</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Step C: Compliance Review & Controlled Submission */}
                      <div class="hcard">
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--navy)' }}>
                          {fr ? '3. Approbation de conformité et transmission' : '3. Compliance Approval & Controlled Submission'}
                        </h4>
                        <p class="muted" style={{ margin: '0 0 10px', fontSize: '12px' }}>
                          {fr
                            ? 'Valide les permis, la police E&O et génère un paquet scellé avec empreinte immuable.'
                            : 'Validates licences, E&O coverage, and generates a sealed submission bundle hash.'}
                        </p>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            class="btn"
                            disabled={busy || !['broker_signed', 'submitted', 'carrier_review'].includes(c.state)}
                            onClick={() => void handleSubmitPackage(c.id, 'manual')}
                          >
                            {fr ? 'Exporter paquet scellé (Portail manuel)' : 'Export Sealed Package (Manual Portal)'}
                          </button>

                          <button
                            class="btn primary"
                            disabled={busy || !['broker_signed', 'submitted', 'carrier_review'].includes(c.state)}
                            onClick={() => void handleSubmitPackage(c.id, 'email')}
                          >
                            {fr ? 'Transmettre directement par courriel sécurisé' : 'Submit via Secure Carrier Email'}
                          </button>
                        </div>
                      </div>

                      {/* Step D: Carrier Responses & Appointment Verification */}
                      <div class="hcard">
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--navy)' }}>
                          {fr ? '4. Réponse de l’assureur et vérification de la nomination' : '4. Carrier Response & Appointment Verification'}
                        </h4>

                        {/* Record Response Form */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                          <select
                            value={respStatus}
                            onChange={e => setRespStatus(e.currentTarget.value as any)}
                            style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                          >
                            <option value="acknowledged">Carrier Acknowledged</option>
                            <option value="additional_info_requested">Additional Info Requested</option>
                            <option value="carrier_approved">Carrier Approved Application</option>
                            <option value="declined">Carrier Declined</option>
                          </select>
                          <input
                            placeholder="Reference / confirmation number"
                            value={respRef}
                            onInput={e => setRespRef((e.target as HTMLInputElement).value)}
                            style={{ padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)', flex: 1, minWidth: '160px' }}
                          />
                          <button
                            class="btn"
                            disabled={busy}
                            onClick={() => void handleRecordResponse(c.id)}
                          >
                            Record Response
                          </button>
                        </div>

                        {/* Appointment Verification */}
                        <div style={{ padding: '12px', background: 'var(--tint2)', borderRadius: '8px' }}>
                          <strong style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                            {fr ? 'Enregistrement de nomination officielle' : 'Authoritative Appointment Verification'}
                          </strong>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                            <label style={{ fontSize: '12px' }}>
                              Appointment Code:
                              <input
                                placeholder="e.g. IA-AGT-998822"
                                value={apptRef}
                                onInput={e => setApptRef((e.target as HTMLInputElement).value)}
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                              />
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              Effective Date:
                              <input
                                type="date"
                                value={apptEff}
                                onInput={e => setApptEff((e.target as HTMLInputElement).value)}
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                              />
                            </label>
                            <label style={{ fontSize: '12px' }}>
                              Expiry Date:
                              <input
                                type="date"
                                value={apptExp}
                                onInput={e => setApptExp((e.target as HTMLInputElement).value)}
                                style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid var(--line2)' }}
                              />
                            </label>
                          </div>
                          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              class="btn primary"
                              disabled={busy || !apptRef}
                              onClick={() => void handleVerifyAppointment(c.id, true)}
                            >
                              Verify & Activate Appointment
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Deep Verification Modules */}
                      <details style={{ marginTop: '8px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--pri)', fontWeight: 600 }}>
                          {fr ? 'Afficher les modules avancés de contrôle et d’admissibilité' : 'Advanced Verification & Product Controls'}
                        </summary>
                        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <CarrierAuthorizationEvidencePanel call={call} contractId={c.id} />
                          <CarrierHoldsPanel call={call} contractId={c.id} />
                          <CarrierBusinessStagingPanel call={call} contractId={c.id} />
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: Action Required */}
      {activeTab === 'actions' && (
        <div class="obcard">
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--navy)' }}>
            {fr ? 'Éléments nécessitant une intervention' : 'Items Requiring Attention'}
          </h3>
          <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            {fr ? 'Dossiers bloqués, pièces manquantes ou nominations approchant de leur échéance.' : 'Blocked applications, missing checklist requirements, or expiring carrier appointments.'}
          </p>

          {actions.length === 0 ? (
            <p class="muted" style={{ textAlign: 'center', padding: '24px' }}>
              ✓ {fr ? 'Aucune action requise. Tous les dossiers sont à jour.' : 'All clear! No pending actions or expiring appointments.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {actions.map((act, i) => (
                <div key={i} class="carrier-dir-row" style={{ borderLeft: '4px solid var(--warn)' }}>
                  <div>
                    <strong style={{ fontSize: '14px' }}>{act.carrierName} ({act.jurisdiction})</strong>
                    <div style={{ fontSize: '12px', color: 'var(--mute)' }}>{act.message}</div>
                  </div>
                  <button
                    class="btn quiet"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                    onClick={() => {
                      setActiveTab('applications');
                      setSelectedCaseId(act.contractId);
                      void loadCaseDocs(act.contractId);
                    }}
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Submission Tracking */}
      {activeTab === 'submissions' && (
        <div class="obcard">
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--navy)' }}>
            {fr ? 'Registre des soumissions aux assureurs' : 'Direct Contracting Submission Register'}
          </h3>
          <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            {fr ? 'Empreintes immuables, mode de transmission, destinataires et preuves d’envoi.' : 'Immutable bundle hashes, delivery channels, snapshots of recipient addresses, and status.'}
          </p>

          {submissions.length === 0 ? (
            <p class="muted" style={{ textAlign: 'center', padding: '24px' }}>
              {fr ? 'Aucune soumission enregistrée.' : 'No application submissions recorded yet.'}
            </p>
          ) : (
            <table class="carrier-sub-table">
              <thead>
                <tr>
                  <th>{fr ? 'Date' : 'Date'}</th>
                  <th>{fr ? 'Assureur' : 'Carrier'}</th>
                  <th>{fr ? 'Mode' : 'Mode'}</th>
                  <th>{fr ? 'Destinataire' : 'Recipient'}</th>
                  <th>{fr ? 'Empreinte SHA-256' : 'Package Hash'}</th>
                  <th>{fr ? 'État' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map(sub => (
                  <tr key={sub.id}>
                    <td>{sub.submittedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td><strong>{sub.carrierName}</strong></td>
                    <td>
                      <span class={`pill ${sub.submissionMode === 'email' ? 'ok' : 'muted'}`} style={{ fontSize: '11px' }}>
                        {sub.submissionMode}
                      </span>
                    </td>
                    <td>{sub.recipientTo ?? 'Manual Portal Export'}</td>
                    <td>
                      <span class="hash-pill">{sub.packageHash.slice(0, 12)}…{sub.packageHash.slice(-6)}</span>
                    </td>
                    <td>
                      <span class={`pill ${sub.status === 'carrier_approved' ? 'ok' : sub.status === 'submitted' ? 'pri' : 'warn'}`} style={{ fontSize: '11px' }}>
                        {sub.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 5: Appointments */}
      {activeTab === 'appointments' && (
        <div class="obcard">
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--navy)' }}>
            {fr ? 'Registre des nominations des assureurs' : 'Verified Carrier Appointments'}
          </h3>
          <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            {fr ? 'Seules les nominations vérifiées avec dates en vigueur confèrent le droit de transiger.' : 'Only verified appointments with authoritative carrier confirmation authorize product sales.'}
          </p>

          <table class="carrier-sub-table">
            <thead>
              <tr>
                <th>{fr ? 'Assureur' : 'Carrier'}</th>
                <th>{fr ? 'Juridiction' : 'Jurisdiction'}</th>
                <th>{fr ? 'Référence' : 'Appointment Ref'}</th>
                <th>{fr ? 'Dates de validité' : 'Effective Window'}</th>
                <th>{fr ? 'Statut' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {cases.filter(c => ['approved', 'appointment_verified', 'active'].includes(c.state)).map(c => (
                <tr key={c.id}>
                  <td><strong>{c.carrierName}</strong></td>
                  <td>{c.jurisdiction}</td>
                  <td><code>{c.appointmentReference ?? 'Pending Reference'}</code></td>
                  <td>
                    {c.appointmentEffectiveOn ? `${c.appointmentEffectiveOn} → ${c.appointmentExpiresOn ?? 'No expiry'}` : 'Not specified'}
                  </td>
                  <td>
                    <span class={`pill ${c.state === 'active' ? 'ok' : 'pri'}`} style={{ fontSize: '11px' }}>
                      {c.state.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: Audit History */}
      {activeTab === 'audit' && (
        <div class="obcard">
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--navy)' }}>
            {fr ? 'Journal d’audit immuable des contrats' : 'Immutable Carrier Contracting Audit Log'}
          </h3>
          <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            {fr ? 'Historique complet des actions, acteurs, horodatages et transitions d’état.' : 'Complete tamper-evident log of all transitions, actors, timestamps, and compliance reasons.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {auditEvents.map(evt => (
              <div key={evt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--tint)', borderRadius: '8px', fontSize: '13px', gap: '12px' }}>
                <div>
                  <strong>{evt.carrierName}</strong>: <span class="muted">{evt.fromState ?? 'initial'} →</span>{' '}
                  <span class="pill pri" style={{ fontSize: '11px' }}>{evt.toState}</span>
                  {evt.reason && <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '2px' }}>{evt.reason}</div>}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--mute)' }}>
                  <div>{evt.actorName ?? 'System / Compliance'}</div>
                  <div>{evt.recordedAt.slice(0, 16).replace('T', ' ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
