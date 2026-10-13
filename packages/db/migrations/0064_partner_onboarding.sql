-- Partner (broker) onboarding: one case per partner node, the consents given, the checks run, the good-standing decision,
-- and carrier packets (stage 2: the carrier agreement signed after the PII agency agreement; the existing carrier_appointments table is an appointment request tracker and is left as it is). Stages and outcomes match packages/domain/src/onboarding.ts.
-- Check results and decisions are head-office only (the branch admin sees status, never the checks). Regional compliance officers
-- (Ontario, BC) need their own role before they can see results; until then only head office does. See the PRD.
CREATE TABLE onboarding_cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  country     text NOT NULL CHECK (country IN ('CA', 'US')),
  stage       text NOT NULL DEFAULT 'invited' CHECK (stage IN ('invited', 'form_submitted', 'consents_recorded', 'checks_requested', 'checks_complete', 'standing_decided', 'agency_agreement_sent', 'agency_agreement_signed', 'active')),
  standing    text CHECK (standing IN ('good_standing', 'needs_review', 'not_in_good_standing')),
  last_checked_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, node_id)
);
CREATE TABLE onboarding_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id         uuid NOT NULL REFERENCES org_nodes(id),
  kind            text NOT NULL CHECK (kind IN ('credit_check', 'background_check', 'carrier_reporting')),
  wording_version text NOT NULL,
  accepted        boolean NOT NULL,
  ip_addr         inet,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onboarding_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  case_id      uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id      uuid NOT NULL REFERENCES org_nodes(id),
  kind         text NOT NULL CHECK (kind IN ('licence', 'credit', 'background')),
  provider     text NOT NULL,
  reference    text,
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'complete', 'failed')),
  score        integer,
  adverse      boolean,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  recorded_by  uuid
);
CREATE INDEX ON onboarding_checks (case_id, kind);
CREATE TABLE onboarding_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  case_id     uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  suggested   text NOT NULL CHECK (suggested IN ('good_standing', 'needs_review', 'not_in_good_standing', 'pending')),
  outcome     text NOT NULL CHECK (outcome IN ('good_standing', 'needs_review', 'not_in_good_standing')),
  reason      text NOT NULL,
  thresholds  jsonb NOT NULL,
  decided_by  uuid NOT NULL,
  decided_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE carrier_packets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  node_id          uuid NOT NULL REFERENCES org_nodes(id),
  carrier          text NOT NULL,
  template_version text NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'carrier_approved', 'declined')),
  effective_date   date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON carrier_packets (node_id);
-- Check results and standing decisions: a tenant admin, or a Compliance officer whose node sits at or above the partner's node.
-- A regional officer (for example, Ontario or BC) sees only the partners below their region.
CREATE FUNCTION app_is_compliance_at_or_above(p_tenant uuid, p_node uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_is_tenant_admin() OR EXISTS (
    SELECT 1 FROM user_node_roles r
    JOIN org_reach o ON o.ancestor_id = r.node_id AND o.descendant_id = p_node
    WHERE r.user_id = app_user_id() AND r.tenant_id = p_tenant AND r.role::text = 'compliance');
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_cases', 'onboarding_consents', 'onboarding_checks', 'onboarding_decisions', 'carrier_packets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
CALL apply_visibility_policies('onboarding_cases', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('onboarding_consents', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('carrier_packets', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('onboarding_checks', 'app_is_compliance_at_or_above(tenant_id, node_id)');
CALL apply_visibility_policies('onboarding_decisions', 'app_is_compliance_at_or_above(tenant_id, node_id)');
