-- Sub-broker requests (plan v6 section 2; decision 3 and the Compliance Manager's start, confirmed 15 Oct 2026). An active
-- broker's administrator asks for a sub-broker. The branch's Compliance Manager starts its file, which creates the node, the
-- file and the invitation together. Until then there is no sub-broker node.
CREATE TABLE sub_broker_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  parent_node_id  uuid NOT NULL REFERENCES org_nodes(id),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200 AND name NOT LIKE '%@%'),
  broker_type     text NOT NULL CHECK (broker_type IN ('individual', 'corporate')),
  admin_email     text NOT NULL CHECK (char_length(admin_email) BETWEEN 3 AND 320),
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'started')),
  requested_by    uuid REFERENCES app_users(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  started_node_id uuid REFERENCES org_nodes(id),
  started_by      uuid REFERENCES app_users(id),
  started_at      timestamptz
);
CREATE INDEX ON sub_broker_requests (parent_node_id);
ALTER TABLE sub_broker_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_broker_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON sub_broker_requests AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Read: the Compliance Manager at or above the parent broker, and the broker's own people.
CREATE POLICY sub_request_select ON sub_broker_requests FOR SELECT USING (
  app_is_compliance_at_or_above(tenant_id, parent_node_id)
  OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.node_id = sub_broker_requests.parent_node_id)
);
-- Write: only the administrator of the parent broker asks; only a Compliance Manager starts it.
CREATE POLICY sub_request_insert ON sub_broker_requests FOR INSERT WITH CHECK (app_can_write()
  AND requested_by = app_user_id()
  AND EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.node_id = sub_broker_requests.parent_node_id AND r.role::text = 'admin'));
CREATE POLICY sub_request_update ON sub_broker_requests FOR UPDATE USING (app_can_write() AND app_is_compliance_at_or_above(tenant_id, parent_node_id))
  WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id, parent_node_id));
GRANT SELECT, INSERT, UPDATE ON sub_broker_requests TO app_runtime;
