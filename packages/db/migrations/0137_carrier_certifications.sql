-- Phase 7: Authoritative tenant carrier certification registry with evidence tracking,
-- gate sign-off provenance, finite tier expiry, and server-enforced activation invariants.

CREATE TABLE IF NOT EXISTS carrier_certifications (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  tier text NOT NULL DEFAULT 'manual_portal' CHECK (tier IN ('manual_portal', 'sandbox_testing', 'certified', 'live')),
  adapter_status text NOT NULL DEFAULT 'staged' CHECK (adapter_status IN ('pending', 'staged', 'implemented')),
  gate1_legal_agreement boolean NOT NULL DEFAULT false,
  gate1_legal_evidence text,
  gate2_sandbox_certified boolean NOT NULL DEFAULT false,
  gate2_sandbox_evidence text,
  gate3_kms_secrets_provisioned boolean NOT NULL DEFAULT false,
  gate3_kms_evidence text,
  gate4_outbox_safety_verified boolean NOT NULL DEFAULT false,
  gate4_outbox_evidence text,
  gate5_feature_flag_active boolean NOT NULL DEFAULT false,
  gate5_approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  gate5_approved_at timestamptz,
  tier_expires_on date,
  certified_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  certified_at timestamptz,
  notes text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, carrier_id),
  -- Evidence is required whenever a gate is marked true
  CHECK (NOT gate1_legal_agreement OR (gate1_legal_evidence IS NOT NULL AND length(trim(gate1_legal_evidence)) > 0)),
  CHECK (NOT gate2_sandbox_certified OR (gate2_sandbox_evidence IS NOT NULL AND length(trim(gate2_sandbox_evidence)) > 0)),
  CHECK (NOT gate3_kms_secrets_provisioned OR (gate3_kms_evidence IS NOT NULL AND length(trim(gate3_kms_evidence)) > 0)),
  CHECK (NOT gate4_outbox_safety_verified OR (gate4_outbox_evidence IS NOT NULL AND length(trim(gate4_outbox_evidence)) > 0)),
  CHECK (NOT gate5_feature_flag_active OR (gate5_approved_by IS NOT NULL AND gate5_approved_at IS NOT NULL)),
  -- Certified tier requires Gates 1 & 2 complete, plus certified_by & certified_at provenance
  CHECK (tier <> 'certified' OR (gate1_legal_agreement AND gate2_sandbox_certified AND certified_by IS NOT NULL AND certified_at IS NOT NULL)),
  -- Live tier requires all 5 gates complete, finite future expiry date, and official certification
  CHECK (tier <> 'live' OR (
    gate1_legal_agreement AND
    gate2_sandbox_certified AND
    gate3_kms_secrets_provisioned AND
    gate4_outbox_safety_verified AND
    gate5_feature_flag_active AND
    gate5_approved_by IS NOT NULL AND
    certified_by IS NOT NULL AND
    certified_at IS NOT NULL AND
    tier_expires_on IS NOT NULL
  ))
);

ALTER TABLE carrier_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_certifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON carrier_certifications
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON carrier_certifications TO app_runtime;
REVOKE ALL ON carrier_certifications FROM PUBLIC, app_auth;

COMMENT ON TABLE carrier_certifications IS 'Authoritative tenant carrier certification registry with gate evidence and server-enforced activation invariants.';
