-- Company agency-agreement wording. One current row per company. Each save is also kept as a revision that cannot be
-- edited or deleted, so a later paste cannot erase the wording that was on file. There is no default text: a Compliance
-- Manager pastes the wording counsel issued. PII does not supply the legal text.
-- Read: everyone in the company. Change: Compliance Managers only.

CREATE TABLE onboarding_agreement_templates (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id),
  title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  version    text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 60),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 60000),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_agreement_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_agreement_templates AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY tpl_select ON onboarding_agreement_templates FOR SELECT USING (true);
CREATE POLICY tpl_insert ON onboarding_agreement_templates FOR INSERT WITH CHECK (app_can_write() AND app_is_compliance_role());
CREATE POLICY tpl_update ON onboarding_agreement_templates FOR UPDATE USING (app_can_write() AND app_is_compliance_role()) WITH CHECK (app_can_write() AND app_is_compliance_role());
GRANT SELECT, INSERT, UPDATE ON onboarding_agreement_templates TO app_runtime;

CREATE TABLE onboarding_agreement_revisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  title      text NOT NULL,
  version    text NOT NULL,
  body       text NOT NULL,
  saved_by   uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON onboarding_agreement_revisions (tenant_id, created_at);
ALTER TABLE onboarding_agreement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_agreement_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_agreement_revisions AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY rev_select ON onboarding_agreement_revisions FOR SELECT USING (true);
CREATE POLICY rev_insert ON onboarding_agreement_revisions FOR INSERT WITH CHECK (app_can_write() AND app_is_compliance_role());
REVOKE ALL ON onboarding_agreement_revisions FROM app_runtime;
GRANT SELECT, INSERT ON onboarding_agreement_revisions TO app_runtime;
