-- Two signatures on the agency agreement. The agent signs first. The compliance manager named on the link signs second.
-- The finished PDF is also kept in the agreement vault: encrypted, append-only, and readable only by a Compliance Manager
-- or the company administrator. The partner cannot read the vault.

ALTER TABLE onboarding_signing_links
  ADD COLUMN agent_signed_at timestamptz,
  ADD COLUMN agent_typed_name text,
  ADD COLUMN agent_signed_ip text,
  ADD COLUMN agent_signed_agent text,
  ADD COLUMN cm_user_id uuid,
  ADD COLUMN cm_name text,
  ADD COLUMN cm_email text;

ALTER TABLE onboarding_agreements
  ADD COLUMN officer_name text,
  ADD COLUMN officer_signed_at timestamptz;

CREATE TABLE agreement_vault (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  agreement_id  uuid NOT NULL REFERENCES onboarding_agreements(id) ON DELETE CASCADE,
  node_id       uuid NOT NULL REFERENCES org_nodes(id),
  title         text NOT NULL,
  key_id        text NOT NULL,
  data_enc      bytea NOT NULL,
  plain_sha256  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id)
);
ALTER TABLE agreement_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_vault FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON agreement_vault AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY vault_read ON agreement_vault FOR SELECT USING (app_is_compliance_role() OR app_is_tenant_admin());
CREATE POLICY vault_insert ON agreement_vault FOR INSERT WITH CHECK (app_can_write() AND (app_is_compliance_role() OR app_is_tenant_admin()));
REVOKE ALL ON agreement_vault FROM app_runtime;
GRANT SELECT, INSERT ON agreement_vault TO app_runtime;
