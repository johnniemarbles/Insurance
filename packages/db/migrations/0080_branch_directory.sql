-- Partners directory for partners: every active partner in the caller's branch (same country), online or not.
-- Name, photo, partner company and last activity only.
CREATE FUNCTION app_branch_partners()
RETURNS TABLE (user_id uuid, display_name text, picture_url text, last_active_at timestamptz, company text, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH my_branch AS (
    SELECT l.parent_id AS branch_id
      FROM app_users me
      JOIN org_nodes n ON n.id = me.home_node_id AND n.type = 'partner'
      JOIN org_links l ON l.child_id = n.id AND l.kind = 'location_link' AND l.tenant_id = app_tenant_id()
     WHERE me.id = app_user_id() AND me.tenant_id = app_tenant_id()
     LIMIT 1
  )
  SELECT u.id, u.display_name, u.picture_url, u.last_active_at, n.name, u.id = app_user_id()
    FROM my_branch b
    JOIN org_links l ON l.parent_id = b.branch_id AND l.kind = 'location_link' AND l.tenant_id = app_tenant_id()
    JOIN org_nodes n ON n.id = l.child_id AND n.type = 'partner' AND n.tenant_id = app_tenant_id() AND n.is_active
    JOIN app_users u ON u.home_node_id = n.id AND u.tenant_id = app_tenant_id()
   WHERE u.status = 'active'
   ORDER BY u.display_name NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION app_branch_partners() TO app_runtime;
