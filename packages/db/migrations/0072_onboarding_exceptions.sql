-- President and CEO approval of an exception (onboarding plan, section 7): a red-flag screening (insolvency, judgment,
-- red-flag yes, or an adverse background report) can be decided as good standing only once the President and CEO has approved it.
-- Append-only: an approval cannot be edited or deleted. Visible to the Compliance officer at or above the partner's node.

CREATE TABLE onboarding_exceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id       uuid NOT NULL REFERENCES org_nodes(id),
  reason        text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  approved_by   uuid NOT NULL REFERENCES app_users(id),
  approver_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON onboarding_exceptions (case_id);
ALTER TABLE onboarding_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_exceptions AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('onboarding_exceptions', 'app_is_compliance_at_or_above(tenant_id, node_id)');
REVOKE ALL ON onboarding_exceptions FROM app_runtime;
GRANT SELECT, INSERT ON onboarding_exceptions TO app_runtime;   -- no UPDATE, no DELETE
