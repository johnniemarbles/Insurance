-- Broker self-report (plan v6, section 7). The broker records one of five events; the clock starts then and the report goes to
-- the Compliance Manager's queue with its due day (business days, Toronto time, set by the application).
CREATE TABLE broker_self_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id         uuid NOT NULL REFERENCES org_nodes(id),
  kind            text NOT NULL CHECK (kind IN ('bankruptcy', 'consumer_proposal', 'investigation', 'sanction', 'criminal_charge')),
  description     text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 1000),
  recorded_by     uuid REFERENCES app_users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  due_on          date NOT NULL,
  acknowledged_by uuid REFERENCES app_users(id),
  acknowledged_at timestamptz
);
CREATE INDEX ON broker_self_reports (case_id);
ALTER TABLE broker_self_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_self_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON broker_self_reports AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Read: the Compliance Manager at or above the broker, and anyone at the broker. Branch managers see progress only (plan v7).
CREATE POLICY self_report_select ON broker_self_reports FOR SELECT USING (
  app_is_compliance_at_or_above(tenant_id, node_id)
  OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.node_id = broker_self_reports.node_id)
);
-- Write: a person at the broker records a report about itself; a Compliance Manager acknowledges it.
CREATE POLICY self_report_insert ON broker_self_reports FOR INSERT WITH CHECK (app_can_write()
  AND recorded_by = app_user_id()
  AND EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.node_id = broker_self_reports.node_id));
CREATE POLICY self_report_update ON broker_self_reports FOR UPDATE USING (app_can_write() AND app_is_compliance_at_or_above(tenant_id, node_id))
  WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id, node_id));
GRANT SELECT, INSERT, UPDATE ON broker_self_reports TO app_runtime;
