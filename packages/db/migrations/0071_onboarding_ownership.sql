-- Broker type and ownership tiers for onboarding (onboarding plan, section 7). Visible to the Compliance officer at or above
-- the partner's node, the same as the checks and the screening. The partner and branch managers never see these rows.
--   broker_type:      individual or corporate, set by the officer. Null until it is recorded.
--   ownership_steps:  the steps taken to reach a conclusion when nobody holds 25% or more.
--   onboarding_owners: one row per director or owner. Identity, PEP and HIO determinations, and personal guarantees are recorded here.

ALTER TABLE onboarding_cases ADD COLUMN broker_type text CHECK (broker_type IN ('individual', 'corporate'));
ALTER TABLE onboarding_cases ADD COLUMN ownership_steps text CHECK (ownership_steps IS NULL OR length(ownership_steps) BETWEEN 10 AND 1000);

CREATE TABLE onboarding_owners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  case_id            uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id            uuid NOT NULL REFERENCES org_nodes(id),
  full_name          text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 200),
  is_director        boolean NOT NULL DEFAULT false,
  share_percent      numeric(5,2) NOT NULL DEFAULT 0 CHECK (share_percent >= 0 AND share_percent <= 100),
  identified         boolean NOT NULL DEFAULT false,
  pep_hio_determined boolean NOT NULL DEFAULT false,
  guarantee_signed   boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON onboarding_owners (case_id);
ALTER TABLE onboarding_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_owners FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_owners AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('onboarding_owners', 'app_is_compliance_at_or_above(tenant_id, node_id)');
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_owners TO app_runtime;
