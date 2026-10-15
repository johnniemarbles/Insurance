-- Screening questionnaire for a broker (onboarding plan, sections 2 and 7). The Compliance officer records the answers;
-- the latest row counts. A bankruptcy, proposal, arrangement or judgment (insolvency_or_judgment), or any red-flag yes (red_flag),
-- sends the case to review whatever the credit score. Visible to the Compliance officer at or above the partner's node,
-- the same as the checks. The partner and branch managers never see these rows.
CREATE TABLE onboarding_screenings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  case_id                uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id                uuid NOT NULL REFERENCES org_nodes(id),
  insolvency_or_judgment boolean NOT NULL,
  red_flag               boolean NOT NULL,
  answers                jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by            uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON onboarding_screenings (case_id, created_at);
ALTER TABLE onboarding_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_screenings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_screenings AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('onboarding_screenings', 'app_is_compliance_at_or_above(tenant_id, node_id)');
