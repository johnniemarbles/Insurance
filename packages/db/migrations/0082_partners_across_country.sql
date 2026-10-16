-- Partners see the partners across the country (one deployment is one country), not only their own branch.
-- Online list: every active partner in the tenant who was active in the last five minutes, except the caller.
CREATE OR REPLACE FUNCTION app_branch_partners_online()
RETURNS TABLE (user_id uuid, display_name text, picture_url text, last_active_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name, u.picture_url, u.last_active_at
    FROM app_users u
    JOIN org_nodes n ON n.id = u.home_node_id AND n.type = 'partner' AND n.tenant_id = app_tenant_id()
   WHERE u.tenant_id = app_tenant_id()
     AND u.id <> app_user_id()
     AND u.status = 'active'
     AND u.last_active_at > now() - interval '5 minutes'
   ORDER BY u.display_name NULLS LAST
$$;

-- Partner directory: every active partner in the tenant, with their partner company and branch, grouped by branch in the app.
DROP FUNCTION IF EXISTS app_branch_partners();
CREATE FUNCTION app_branch_partners()
RETURNS TABLE (user_id uuid, display_name text, picture_url text, last_active_at timestamptz, company text, branch text, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name, u.picture_url, u.last_active_at, n.name, loc.name, u.id = app_user_id()
    FROM app_users u
    JOIN org_nodes n ON n.id = u.home_node_id AND n.type = 'partner' AND n.tenant_id = app_tenant_id() AND n.is_active
    LEFT JOIN org_links l ON l.child_id = n.id AND l.kind = 'location_link' AND l.tenant_id = app_tenant_id()
    LEFT JOIN org_nodes loc ON loc.id = l.parent_id
   WHERE u.tenant_id = app_tenant_id()
     AND u.status = 'active'
   ORDER BY loc.name NULLS LAST, u.display_name NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION app_branch_partners() TO app_runtime;
