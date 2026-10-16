-- Online partners for everyone: partners see active partners in their own branch; staff and head office see every active partner in the tenant.
-- Returns name and photo only. Replaces the 0079 version, which gave staff no rows.
CREATE OR REPLACE FUNCTION app_branch_partners_online()
RETURNS TABLE (user_id uuid, display_name text, picture_url text, last_active_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT u.id, u.home_node_id, n.type AS home_type
      FROM app_users u
      LEFT JOIN org_nodes n ON n.id = u.home_node_id
     WHERE u.id = app_user_id() AND u.tenant_id = app_tenant_id()
  )
  SELECT u.id, u.display_name, u.picture_url, u.last_active_at
    FROM app_users u
    JOIN org_nodes n ON n.id = u.home_node_id AND n.type = 'partner' AND n.tenant_id = app_tenant_id()
    CROSS JOIN me
   WHERE u.id <> app_user_id()
     AND u.tenant_id = app_tenant_id()
     AND u.status = 'active'
     AND u.last_active_at > now() - interval '5 minutes'
     AND (
       me.home_type IS DISTINCT FROM 'partner'
       OR EXISTS (
         SELECT 1
           FROM org_links mine
           JOIN org_links theirs ON theirs.parent_id = mine.parent_id AND theirs.kind = 'location_link' AND theirs.tenant_id = app_tenant_id()
          WHERE mine.kind = 'location_link' AND mine.tenant_id = app_tenant_id()
            AND mine.child_id = me.home_node_id
            AND theirs.child_id = n.id
       )
     )
   ORDER BY u.display_name NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION app_branch_partners_online() TO app_runtime;
