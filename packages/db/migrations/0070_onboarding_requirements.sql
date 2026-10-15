-- Onboarding requirements a Compliance Manager can switch on or off for the company (one row per company, tenant).
-- Defaults are all on. Every change is written to onboarding_requirement_changes, which is append-only: nobody can edit or
-- delete a change, so the record of who switched a requirement off, and why, cannot be tidied afterwards.
--   screening_before_decision: the screening questions must be recorded before a decision (on by default).
--   ownership_required:        beneficial ownership tiers must be recorded for a corporate broker.
--   pending_approval:          a new broker waits in Pending Compliance Approval until decided.
--   president_exceptions:      a red-flag override needs the President & CEO's approval.
-- Read: everyone in the company. Change: Compliance Managers only, with write access.

-- A Compliance Manager: holds the compliance role somewhere in the company. Used only to decide who may change these requirements.
CREATE FUNCTION app_is_compliance_role() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM user_node_roles WHERE user_id = app_user_id() AND role::text = 'compliance') $$;

CREATE TABLE onboarding_requirements (
  tenant_id                 uuid PRIMARY KEY REFERENCES tenants(id),
  screening_before_decision boolean NOT NULL DEFAULT true,
  ownership_required        boolean NOT NULL DEFAULT true,
  pending_approval          boolean NOT NULL DEFAULT true,
  president_exceptions      boolean NOT NULL DEFAULT true,
  updated_by                uuid REFERENCES app_users(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_requirements AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY req_select ON onboarding_requirements FOR SELECT USING (true);
CREATE POLICY req_insert ON onboarding_requirements FOR INSERT WITH CHECK (app_can_write() AND app_is_compliance_role());
CREATE POLICY req_update ON onboarding_requirements FOR UPDATE USING (app_can_write() AND app_is_compliance_role()) WITH CHECK (app_can_write() AND app_is_compliance_role());
GRANT SELECT, INSERT, UPDATE ON onboarding_requirements TO app_runtime;

CREATE TABLE onboarding_requirement_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  requirement text NOT NULL CHECK (requirement IN ('screening_before_decision', 'ownership_required', 'pending_approval', 'president_exceptions')),
  from_value  boolean NOT NULL,
  to_value    boolean NOT NULL,
  reason      text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  changed_by  uuid NOT NULL REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON onboarding_requirement_changes (tenant_id, created_at);
ALTER TABLE onboarding_requirement_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_requirement_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_requirement_changes AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY change_select ON onboarding_requirement_changes FOR SELECT USING (true);
CREATE POLICY change_insert ON onboarding_requirement_changes FOR INSERT WITH CHECK (app_can_write() AND app_is_compliance_role());
REVOKE ALL ON onboarding_requirement_changes FROM app_runtime;
GRANT SELECT, INSERT ON onboarding_requirement_changes TO app_runtime;   -- no UPDATE, no DELETE
