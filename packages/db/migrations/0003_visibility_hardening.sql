-- Replace the generic "any tenant member can read" policies on identity tables with
-- real visibility rules: a person sees their own branch (themselves, people beneath them, ancestors' names),
-- never a sibling's. Closes the gap found while building Phase 0.

-- A node is visible to: tenant admins, the viewer's own nodes, partner-chain ancestors and descendants
-- of those nodes, and locations that reach them (and the partners beneath the viewer's locations).
-- Uses only org_links and org_partner_closure so the org_nodes policy cannot recurse into itself.
CREATE FUNCTION org_node_visible(p_tenant uuid, p_node uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       app_is_tenant_admin()
    OR p_node = ANY (app_node_ids())
    OR EXISTS (SELECT 1 FROM org_partner_closure c
               WHERE c.ancestor_id = p_node AND c.descendant_id = ANY (app_node_ids()))
    OR EXISTS (SELECT 1 FROM org_partner_closure c
               WHERE c.descendant_id = p_node AND c.ancestor_id = ANY (app_node_ids()))
    OR EXISTS (SELECT 1 FROM org_links l JOIN org_partner_closure c ON c.ancestor_id = l.child_id
               WHERE l.kind = 'location_link' AND l.parent_id = ANY (app_node_ids()) AND c.descendant_id = p_node)
    OR EXISTS (SELECT 1 FROM org_links l JOIN org_partner_closure c ON c.ancestor_id = l.child_id
               WHERE l.kind = 'location_link' AND l.parent_id = p_node AND c.descendant_id = ANY (app_node_ids())))
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_nodes', 'app_users', 'user_node_roles', 'invitations', 'audit_log'] LOOP
    EXECUTE format('DROP POLICY tenant_read ON %I', t);
    EXECUTE format('DROP POLICY tenant_write ON %I', t);
  END LOOP;
END $$;

-- org_nodes: the tenant root is visible to everyone in the tenant (its name appears in notices).
-- Inserts only need write rights: a new node is not yet linked, so it is not yet "visible".
CREATE POLICY vis_select ON org_nodes FOR SELECT USING (type = 'tenant' OR org_node_visible(tenant_id, id));
CREATE POLICY vis_insert ON org_nodes FOR INSERT WITH CHECK (app_can_write());
CREATE POLICY vis_update ON org_nodes FOR UPDATE
  USING (app_can_write() AND org_node_visible(tenant_id, id)) WITH CHECK (app_can_write());
CREATE POLICY vis_delete ON org_nodes FOR DELETE USING (app_can_write() AND org_node_visible(tenant_id, id));

-- app_users: yourself, tenant admins, and people whose home node you can see below you.
CREATE POLICY vis_select ON app_users FOR SELECT
  USING (id = app_user_id() OR app_is_tenant_admin() OR lms_node_visible(tenant_id, home_node_id));
CREATE POLICY vis_insert ON app_users FOR INSERT
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, home_node_id)));
CREATE POLICY vis_update ON app_users FOR UPDATE
  USING (app_can_write() AND (id = app_user_id() OR app_is_tenant_admin() OR lms_node_visible(tenant_id, home_node_id)))
  WITH CHECK (app_can_write() AND (id = app_user_id() OR app_is_tenant_admin() OR lms_node_visible(tenant_id, home_node_id)));
CREATE POLICY vis_delete ON app_users FOR DELETE
  USING (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, home_node_id)));

-- user_node_roles
CREATE POLICY vis_select ON user_node_roles FOR SELECT
  USING (user_id = app_user_id() OR app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id));
CREATE POLICY vis_insert ON user_node_roles FOR INSERT
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id)));
CREATE POLICY vis_update ON user_node_roles FOR UPDATE
  USING (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id)))
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id)));
CREATE POLICY vis_delete ON user_node_roles FOR DELETE
  USING (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id)));

-- invitations
CREATE POLICY vis_select ON invitations FOR SELECT
  USING (app_is_tenant_admin() OR invited_by = app_user_id() OR lms_node_visible(tenant_id, node_id));
CREATE POLICY vis_insert ON invitations FOR INSERT
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR lms_node_visible(tenant_id, node_id)));
CREATE POLICY vis_update ON invitations FOR UPDATE
  USING (app_can_write() AND (app_is_tenant_admin() OR invited_by = app_user_id() OR lms_node_visible(tenant_id, node_id)))
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR invited_by = app_user_id() OR lms_node_visible(tenant_id, node_id)));
CREATE POLICY vis_delete ON invitations FOR DELETE
  USING (app_can_write() AND (app_is_tenant_admin() OR invited_by = app_user_id() OR lms_node_visible(tenant_id, node_id)));

-- audit_log: append-only. Anyone may record their own actions; only tenant admins may read.
CREATE POLICY admin_read ON audit_log FOR SELECT USING (app_is_tenant_admin());
CREATE POLICY own_append ON audit_log FOR INSERT WITH CHECK (actor_user_id = app_user_id());

-- Monthly audit partitions: created by ops/cron as the owner; the runtime role gets no direct access.
CREATE FUNCTION create_audit_partition(p_month date) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', p_month)::date;
  name text := 'audit_log_' || to_char(start_d, 'YYYY_MM');
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
                 name, start_d, (start_d + interval '1 month')::date);
  EXECUTE format('REVOKE ALL ON %I FROM app_runtime', name);
  RETURN name;
END $$;
