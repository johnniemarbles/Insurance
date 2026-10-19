import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

export interface CarrierConnectionStatusItem {
  id: string;
  displayName: string;
  country: string;
  isAuthoritative: boolean;
  currentTier: 'manual_portal' | 'sandbox_testing' | 'certified' | 'live';
  adapterStatus: 'implemented' | 'staged' | 'pending';
  dispatchLocked: boolean;
  webhookQuarantineActive: boolean;
  recipientVerified: boolean;
  recipientTo: string | null;
  gates: {
    gate1LegalAgreement: boolean;
    gate1LegalEvidence?: string | null;
    gate2SandboxCertified: boolean;
    gate2SandboxEvidence?: string | null;
    gate3KmsSecretsProvisioned: boolean;
    gate3KmsEvidence?: string | null;
    gate4OutboxSafetyVerified: boolean;
    gate4OutboxEvidence?: string | null;
    gate5FeatureFlagActive: boolean;
    gate5ApprovedBy?: string | null;
    gate5ApprovedAt?: string | null;
  };
  tierExpiresOn?: string | null;
  certifiedBy?: string | null;
  certifiedAt?: string | null;
  notes?: string | null;
  revision?: number;
  updatedAt?: string | null;
}

const STATIC_CARRIER_DATA: Record<string, Omit<CarrierConnectionStatusItem, 'id' | 'displayName' | 'country' | 'recipientVerified' | 'recipientTo' | 'isAuthoritative'>> = {
  'ia-financial-group': {
    currentTier: 'manual_portal',
    adapterStatus: 'implemented',
    dispatchLocked: true,
    webhookQuarantineActive: true,
    gates: {
      gate1LegalAgreement: false,
      gate2SandboxCertified: false,
      gate3KmsSecretsProvisioned: false,
      gate4OutboxSafetyVerified: true,
      gate5FeatureFlagActive: false,
    },
  },
  'sun-life': {
    currentTier: 'manual_portal',
    adapterStatus: 'implemented',
    dispatchLocked: true,
    webhookQuarantineActive: true,
    gates: {
      gate1LegalAgreement: false,
      gate2SandboxCertified: false,
      gate3KmsSecretsProvisioned: false,
      gate4OutboxSafetyVerified: true,
      gate5FeatureFlagActive: false,
    },
  },
  'manulife': {
    currentTier: 'manual_portal',
    adapterStatus: 'staged',
    dispatchLocked: true,
    webhookQuarantineActive: true,
    gates: {
      gate1LegalAgreement: false,
      gate2SandboxCertified: false,
      gate3KmsSecretsProvisioned: false,
      gate4OutboxSafetyVerified: true,
      gate5FeatureFlagActive: false,
    },
  },
  'canada-life': {
    currentTier: 'manual_portal',
    adapterStatus: 'staged',
    dispatchLocked: true,
    webhookQuarantineActive: true,
    gates: {
      gate1LegalAgreement: false,
      gate2SandboxCertified: false,
      gate3KmsSecretsProvisioned: false,
      gate4OutboxSafetyVerified: true,
      gate5FeatureFlagActive: false,
    },
  },
};

const TIER_META = {
  en: {
    manual_portal: {
      label: 'Manual Portal',
      badge: 'Active & Operational',
      tone: 'ok',
      description: 'Document packages staged, broker e-signed, and submitted manually via carrier advisor portal. Inbound receipts cryptographically quarantined.',
    },
    sandbox_testing: {
      label: 'Sandbox Testing',
      badge: 'Awaiting Insurer Credentials',
      tone: 'warn',
      description: 'Outbound adapter spikes ready in software. Awaiting insurer-issued sandbox API keys, endpoint configurations, and test producer IDs.',
    },
    certified: {
      label: 'Certified',
      badge: 'Pending Sandbox Sign-Off',
      tone: 'muted',
      description: 'End-to-end sandbox roundtrip testing completed with zero failures, verified replay rejection, and bilateral technical acceptance.',
    },
    live: {
      label: 'Live (Electronic API)',
      badge: 'Hard-Locked Disabled',
      tone: 'bad',
      description: 'Direct bilateral electronic dispatch. Strictly disabled fail-closed (allowExternalDispatch: false) until all 5 release gates are approved.',
    },
  },
  'fr-CA': {
    manual_portal: {
      label: 'Portail manuel',
      badge: 'Actif & opérationnel',
      tone: 'ok',
      description: 'Dossiers préparés, signés électroniquement par le courtier et soumis manuellement via le portail conseiller. Récépissés entrants mis en quarantaine.',
    },
    sandbox_testing: {
      label: 'Tests en bac à sable',
      badge: 'En attente des accès assureur',
      tone: 'warn',
      description: 'Adaptateurs logiciels prêts. En attente des clés API de test, des points de terminaison et des identifiants émis par l’assureur.',
    },
    certified: {
      label: 'Certifié',
      badge: 'En attente de validation',
      tone: 'muted',
      description: 'Essais complets en bac à sable réussis avec zéro défaillance, protection anti-rejeu vérifiée et approbation technique bilatérale.',
    },
    live: {
      label: 'En direct (API électronique)',
      badge: 'Verrouillé désactivé',
      tone: 'bad',
      description: 'Expédition électronique directe. Strictement désactivée par défaut (allowExternalDispatch: false) jusqu’à approbation des 5 portes de mise en production.',
    },
  },
};

export function CarrierConnectionStatusPanel({
  call,
  locale,
}: {
  call: Call;
  locale: Locale | string;
}) {
  const fr = locale === 'fr-CA';
  const tm = fr ? TIER_META['fr-CA'] : TIER_META.en;
  const [carriers, setCarriers] = useState<CarrierConnectionStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>('ia-financial-group');

  useEffect(() => {
    let active = true;

    function loadFallback() {
      call('GET', '/v1/compliance/carriers')
        .then((res: { carriers?: Array<{ id: string; displayName: string; country: string; connectionMode: string; connectionVerified: boolean }> }) => {
          if (!active) return;
          const list = (res.carriers ?? []).map(c => {
            const defaults = STATIC_CARRIER_DATA[c.id] ?? {
              currentTier: 'manual_portal' as const,
              adapterStatus: 'pending' as const,
              dispatchLocked: true,
              webhookQuarantineActive: true,
              gates: {
                gate1LegalAgreement: false,
                gate2SandboxCertified: false,
                gate3KmsSecretsProvisioned: false,
                gate4OutboxSafetyVerified: true,
                gate5FeatureFlagActive: false,
              },
            };
            return {
              id: c.id,
              displayName: c.displayName,
              country: c.country,
              isAuthoritative: false,
              recipientVerified: c.connectionVerified,
              recipientTo: null,
              ...defaults,
            };
          });
          setCarriers(list);
          if (list.length > 0 && !list.some(c => c.id === selectedCarrierId)) {
            setSelectedCarrierId(list[0]!.id);
          }
        })
        .catch(() => {});
    }

    call('GET', '/v1/compliance/carrier-certifications')
      .then((res: { certifications?: any[] }) => {
        if (!active) return;
        if (res?.certifications && Array.isArray(res.certifications) && res.certifications.length > 0) {
          const list: CarrierConnectionStatusItem[] = res.certifications.map(c => ({
            id: c.carrierId,
            displayName: c.displayName,
            country: c.country,
            isAuthoritative: Boolean(c.isAuthoritative),
            currentTier: c.currentTier,
            adapterStatus: c.adapterStatus,
            dispatchLocked: Boolean(c.dispatchLocked),
            webhookQuarantineActive: Boolean(c.webhookQuarantineActive),
            recipientVerified: true,
            recipientTo: null,
            gates: {
              gate1LegalAgreement: Boolean(c.gates?.gate1LegalAgreement),
              gate1LegalEvidence: c.gates?.gate1LegalEvidence ?? null,
              gate2SandboxCertified: Boolean(c.gates?.gate2SandboxCertified),
              gate2SandboxEvidence: c.gates?.gate2SandboxEvidence ?? null,
              gate3KmsSecretsProvisioned: Boolean(c.gates?.gate3KmsSecretsProvisioned),
              gate3KmsEvidence: c.gates?.gate3KmsEvidence ?? null,
              gate4OutboxSafetyVerified: Boolean(c.gates?.gate4OutboxSafetyVerified),
              gate4OutboxEvidence: c.gates?.gate4OutboxEvidence ?? null,
              gate5FeatureFlagActive: Boolean(c.gates?.gate5FeatureFlagActive),
              gate5ApprovedBy: c.gates?.gate5ApprovedBy ?? null,
              gate5ApprovedAt: c.gates?.gate5ApprovedAt ?? null,
            },
            tierExpiresOn: c.tierExpiresOn ?? null,
            certifiedBy: c.certifiedBy ?? null,
            certifiedAt: c.certifiedAt ?? null,
            notes: c.notes ?? null,
            revision: c.revision ?? 1,
            updatedAt: c.updatedAt ?? null,
          }));
          setCarriers(list);
          if (list.length > 0 && !list.some(c => c.id === selectedCarrierId)) {
            setSelectedCarrierId(list[0]!.id);
          }
          return;
        }
        loadFallback();
      })
      .catch(() => {
        loadFallback();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [call]);

  const selected = carriers.find(c => c.id === selectedCarrierId) ?? carriers[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Governance Safety Banner */}
      <div
        style={{
          background: 'var(--amber-soft, #fff8e1)',
          border: '1px solid var(--amber, #f59e0b)',
          borderRadius: '10px',
          padding: '16px 20px',
          display: 'flex',
          gap: '14px',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ fontSize: '24px', lineHeight: 1 }}>🛡️</div>
        <div style={{ display: 'grid', gap: '4px', fontSize: '13px', color: 'var(--navy)' }}>
          <strong style={{ fontSize: '14px' }}>
            {fr ? 'Avis de conformité et gouvernance des connexions' : 'Carrier Connectivity & Governance Standard'}
          </strong>
          <span>
            {fr
              ? 'La préparation logicielle d’un adaptateur ne constitue pas une autorisation de l’assureur. L’expédition réseau externe demeure verrouillée et sécurisée (allowExternalDispatch: false). Les opérations se déroulent exclusivement via les portails autorisés des assureurs.'
              : 'Software adapter readiness does NOT constitute insurer authorization. External network dispatch remains fail-closed (allowExternalDispatch: false). All carrier contracting operates strictly through authorized advisor portals.'}
          </span>
        </div>
      </div>

      {/* 2. Four Connection Tiers Overview */}
      <div class="obcard">
        <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--navy)' }}>
          {fr ? 'Les 4 paliers de connexion assureur' : 'Four Carrier Connection & Certification Tiers'}
        </h3>
        <p class="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
          {fr
            ? 'Chaque assureur progresse à travers quatre paliers rigoureusement vérifiés avant toute activation en production.'
            : 'Every carrier transitions through four strictly governed tiers prior to production activation.'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          {(['manual_portal', 'sandbox_testing', 'certified', 'live'] as const).map((tierKey, idx) => {
            const t = tm[tierKey];
            const isActive = selected?.currentTier === tierKey;
            return (
              <div
                key={tierKey}
                class="hcard"
                style={{
                  border: isActive ? '2px solid var(--primary, #0284c7)' : '1px solid var(--line2, #e2e8f0)',
                  background: isActive ? 'var(--blue-soft, #f0f9ff)' : '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  borderRadius: '10px',
                  padding: '14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--mute)' }}>
                    {fr ? `PALIER ${idx + 1}` : `TIER ${idx + 1}`}
                  </span>
                  <span class={`pill ${t.tone}`} style={{ fontSize: '11px', fontWeight: 600 }}>
                    {t.badge}
                  </span>
                </div>
                <strong style={{ fontSize: '15px', color: 'var(--navy)' }}>{t.label}</strong>
                <p class="muted" style={{ fontSize: '12px', margin: 0, lineHeight: 1.4 }}>
                  {t.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Carrier Matrix & Detailed Inspector */}
      {loading ? (
        <p class="muted">{fr ? 'Chargement des statuts de connexion…' : 'Loading carrier connection status…'}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
          {/* Left: Carrier Selector List */}
          <div class="obcard" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: '0 0 4px', fontSize: '15px', color: 'var(--navy)' }}>
              {fr ? 'Répertoire des assureurs canadiens' : 'Canadian Carrier Directory'}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {carriers.map(c => {
                const isSelected = c.id === selectedCarrierId;
                const tierInfo = tm[c.currentTier];
                return (
                  <button
                    key={c.id}
                    type="button"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid var(--primary, #0284c7)' : '1px solid var(--line2, #e2e8f0)',
                      background: isSelected ? 'var(--blue-soft, #f0f9ff)' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                    onClick={() => setSelectedCarrierId(c.id)}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '14px' }}>{c.displayName}</span>
                        {c.isAuthoritative && (
                          <span style={{ fontSize: '10px', color: 'var(--ok, #16a34a)' }} title={fr ? 'Registre en base' : 'Authoritative DB'}>●</span>
                        )}
                      </div>
                      <small class="muted">{c.country} · {tierInfo.label}</small>
                    </div>
                    <span class={`pill ${c.adapterStatus === 'implemented' ? 'ok' : 'muted'}`} style={{ fontSize: '11px' }}>
                      {c.adapterStatus === 'implemented'
                        ? (fr ? 'Adaptateur prêt' : 'Adapter Ready')
                        : (fr ? 'Planifié' : 'Staged')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Selected Carrier Detailed Certification Card */}
          {selected && (
            <div class="obcard" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '18px', color: 'var(--navy)' }}>{selected.displayName}</h4>
                  <small class="muted">ID: <code>{selected.id}</code> · {selected.country}</small>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {selected.isAuthoritative ? (
                    <span class="pill ok" style={{ fontSize: '11px', padding: '3px 8px' }}>
                      {fr ? `✓ Registre vérifié (Rév. ${selected.revision ?? 1})` : `✓ Authoritative Ledger (Rev. ${selected.revision ?? 1})`}
                    </span>
                  ) : (
                    <span class="pill muted" style={{ fontSize: '11px', padding: '3px 8px' }}>
                      {fr ? 'Référence par défaut' : 'Default Baseline'}
                    </span>
                  )}
                  <span class={`pill ${selected.currentTier === 'live' ? 'bad' : 'ok'}`} style={{ fontSize: '12px', padding: '4px 10px' }}>
                    {tm[selected.currentTier].label}
                  </span>
                </div>
              </div>

              {/* Status Attribute Badges */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <div class="hcard" style={{ padding: '10px 12px' }}>
                  <small class="muted">{fr ? 'Adaptateur logiciel' : 'Software Adapter'}</small>
                  <div style={{ fontWeight: 600, color: selected.adapterStatus === 'implemented' ? 'var(--ok)' : 'inherit' }}>
                    {selected.adapterStatus === 'implemented'
                      ? (fr ? '✓ Implémenté & testé' : '✓ Implemented & Tested')
                      : (fr ? 'En attente d’implémentation' : 'Pending Implementation')}
                  </div>
                </div>
                <div class="hcard" style={{ padding: '10px 12px' }}>
                  <small class="muted">{fr ? 'Expédition réseau' : 'Network Dispatch'}</small>
                  <div style={{ fontWeight: 600, color: 'var(--bad, #b3261e)' }}>
                    🔒 {fr ? 'Verrouillé désactivé' : 'Fail-Closed (Locked)'}
                  </div>
                </div>
                <div class="hcard" style={{ padding: '10px 12px' }}>
                  <small class="muted">{fr ? 'Sécurité webhooks' : 'Webhook Quarantine'}</small>
                  <div style={{ fontWeight: 600, color: 'var(--ok, #16a34a)' }}>
                    🛡️ {fr ? 'Actif (HMAC-SHA256)' : 'Active (HMAC-SHA256)'}
                  </div>
                </div>
              </div>

              {/* Five Release Gates Progress Checklist with Evidence */}
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--navy)' }}>
                  {fr ? 'Portes de déverrouillage pour expédition électronique en direct' : 'Live Electronic Dispatch Release Gates'}
                </strong>
                <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    {
                      key: 'gate1LegalAgreement',
                      title: fr ? 'Porte 1 : Entente bilatérale et DPA signés' : 'Gate 1: Bilateral Agreement & DPA Signed',
                      active: selected.gates.gate1LegalAgreement,
                      evidence: selected.gates.gate1LegalEvidence,
                    },
                    {
                      key: 'gate2SandboxCertified',
                      title: fr ? 'Porte 2 : Certification technique en bac à sable' : 'Gate 2: Technical Sandbox Certification',
                      active: selected.gates.gate2SandboxCertified,
                      evidence: selected.gates.gate2SandboxEvidence,
                    },
                    {
                      key: 'gate3KmsSecretsProvisioned',
                      title: fr ? 'Porte 3 : Clés doubles HMAC provisionnées dans KMS' : 'Gate 3: KMS Dual-Secret Provisioning',
                      active: selected.gates.gate3KmsSecretsProvisioned,
                      evidence: selected.gates.gate3KmsEvidence,
                    },
                    {
                      key: 'gate4OutboxSafetyVerified',
                      title: fr ? 'Porte 4 : Verrouillage transactionnel outbox vérifié' : 'Gate 4: Outbox Worker Safety Verified',
                      active: selected.gates.gate4OutboxSafetyVerified,
                      evidence: selected.gates.gate4OutboxEvidence,
                    },
                    {
                      key: 'gate5FeatureFlagActive',
                      title: fr ? 'Porte 5 : Activation explicite par drapeau de fonctionnalité' : 'Gate 5: Explicit Scoped Feature Flag Activation',
                      active: selected.gates.gate5FeatureFlagActive,
                      evidence: selected.gates.gate5ApprovedBy
                        ? (fr ? `Approuvé par: ${selected.gates.gate5ApprovedBy.slice(0, 8)}…` : `Approved by: ${selected.gates.gate5ApprovedBy.slice(0, 8)}…`)
                        : null,
                    },
                  ].map(gate => (
                    <li
                      key={gate.key}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: gate.active ? 'var(--green-soft, #f0fdf4)' : 'var(--bg-subtle, #f8fafc)',
                        border: '1px solid var(--line2, #e2e8f0)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: gate.active ? 600 : 400 }}>{gate.title}</span>
                        <span class={`pill ${gate.active ? 'ok' : 'muted'}`} style={{ fontSize: '10px' }}>
                          {gate.active ? (fr ? 'Complété' : 'Verified') : (fr ? 'Requis' : 'Pending')}
                        </span>
                      </div>
                      {gate.evidence && (
                        <div style={{ fontSize: '11px', color: 'var(--muted, #64748b)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                          🔍 {fr ? 'Preuve' : 'Evidence'}: {gate.evidence}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Provenance & Audit Metadata */}
              {selected.isAuthoritative && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', borderTop: '1px solid var(--line2, #e2e8f0)', paddingTop: '12px', fontSize: '12px' }}>
                  <div>
                    <span class="muted">{fr ? 'Échéance palier:' : 'Tier Expiry:'} </span>
                    <strong>{selected.tierExpiresOn ?? (fr ? 'Indéterminée (Standard)' : 'Indefinite (Standard)')}</strong>
                  </div>
                  <div>
                    <span class="muted">{fr ? 'Dernière révision:' : 'Last Revision:'} </span>
                    <strong>{selected.revision ? `Rev #${selected.revision}` : 'Initial'}</strong>
                  </div>
                  {selected.certifiedAt && (
                    <div>
                      <span class="muted">{fr ? 'Certifié le:' : 'Certified On:'} </span>
                      <strong>{new Date(selected.certifiedAt).toLocaleDateString(fr ? 'fr-CA' : 'en-CA')}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
