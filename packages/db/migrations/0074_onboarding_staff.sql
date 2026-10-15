-- Staff on brokers (plan v7, sections 3 and 6). A branch manager assigns a staff member of its branch to a broker in its branch.
-- The staff member manages that broker and sees its analytics. Everyone else in the branch sees nothing here.
CREATE TABLE onboarding_staff (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  case_id     uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  user_id     uuid NOT NULL REFERENCES app_users(id),
  assigned_by uuid NOT NULL REFERENCES app_users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX ON onboarding_staff (user_id);
ALTER TABLE onboarding_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_staff FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON onboarding_staff AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Read: the staff member itself, the Compliance Manager at or above the broker, and a branch manager above the broker.
CREATE POLICY staff_select ON onboarding_staff FOR SELECT USING (
  user_id = app_user_id()
  OR app_is_compliance_at_or_above(tenant_id, node_id)
  OR EXISTS (SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
              WHERE r.user_id = app_user_id() AND r.role::text = 'manager' AND o.descendant_id = node_id)
);
-- Write: only a branch manager above the broker, and only while writes are allowed.
CREATE POLICY staff_insert ON onboarding_staff FOR INSERT WITH CHECK (app_can_write() AND EXISTS (
  SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
   WHERE r.user_id = app_user_id() AND r.role::text = 'manager' AND o.descendant_id = node_id));
CREATE POLICY staff_delete ON onboarding_staff FOR DELETE USING (app_can_write() AND EXISTS (
  SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
   WHERE r.user_id = app_user_id() AND r.role::text = 'manager' AND o.descendant_id = node_id));
GRANT SELECT, INSERT, DELETE ON onboarding_staff TO app_runtime;

-- Staff see whether each check is complete or outstanding, and nothing else of a check (no score, no provider, no reason).
-- The checks table stays hidden from them; this function returns kind and status only, and only for a broker they are assigned to.
CREATE FUNCTION onboarding_check_status_for_staff(p_case uuid) RETURNS TABLE (kind text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (c.kind) c.kind::text, c.status::text
    FROM onboarding_checks c
   WHERE c.case_id = p_case
     AND EXISTS (SELECT 1 FROM onboarding_staff s WHERE s.case_id = p_case AND s.user_id = app_user_id())
   ORDER BY c.kind, c.requested_at DESC
$$;
GRANT EXECUTE ON FUNCTION onboarding_check_status_for_staff(uuid) TO app_runtime;
