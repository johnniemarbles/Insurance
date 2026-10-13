-- Partner agency agreement signing (separate from client advice signing). The officer sends the agreement from an onboarding
-- case once the standing is good; the partner signs through a private link with a one-time code sent to the partner's email.
-- The signed agreement and its sealed PDF are kept with the case (retained for as long as the case exists).
-- Signing links are written through the auth pool, like the client signing links (0056), so the runtime role cannot read tokens.
CREATE TABLE onboarding_signing_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id       uuid NOT NULL REFERENCES org_nodes(id),
  created_by    uuid NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  version       text NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  otp_hash      bytea,
  otp_expires_at timestamptz,
  otp_attempts  integer NOT NULL DEFAULT 0,
  sends         integer NOT NULL DEFAULT 0,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_signing_links_case ON onboarding_signing_links (case_id);
ALTER TABLE onboarding_signing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_signing_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_signing_links AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
REVOKE ALL ON onboarding_signing_links FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_signing_links TO app_auth;

CREATE TABLE onboarding_agreements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  case_id      uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id      uuid NOT NULL REFERENCES org_nodes(id),
  title        text NOT NULL,
  body         text NOT NULL,
  version      text NOT NULL,
  body_hash    text NOT NULL,
  typed_name   text NOT NULL,
  signed_ip    text,
  signed_agent text,
  signed_at    timestamptz NOT NULL DEFAULT now(),
  sealed_pdf   bytea NOT NULL
);
CREATE INDEX onboarding_agreements_case ON onboarding_agreements (case_id);
ALTER TABLE onboarding_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_agreements AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('onboarding_agreements', 'org_node_at_or_below(tenant_id, node_id)');
