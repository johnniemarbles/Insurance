-- Partner avatars and "online now" (plan: partners see other partners in their own branch who are active right now).
-- The Google profile photo is stored only as given by Google sign-in (https://lh3.googleusercontent.com/...).
ALTER TABLE app_users ADD COLUMN picture_url text
  CHECK (picture_url IS NULL OR picture_url LIKE 'https://lh3.googleusercontent.com/%');
ALTER TABLE app_users ADD COLUMN last_active_at timestamptz;
GRANT UPDATE (picture_url) ON app_users TO app_auth;

-- The signed-in person is active now (the web app calls this every minute while its tab is visible).
CREATE FUNCTION app_touch_presence() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE app_users SET last_active_at = now() WHERE id = app_user_id() AND tenant_id = app_tenant_id()
$$;
GRANT EXECUTE ON FUNCTION app_touch_presence() TO app_runtime;

-- Other partners in the caller's branch (same country, since a deployment is one country) who were active in the last five minutes.
-- Only partners see this; staff and head office get no rows. Returns name and photo only.
CREATE FUNCTION app_branch_partners_online()
RETURNS TABLE (user_id uuid, display_name text, picture_url text, last_active_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH my_branch AS (
    SELECT l.parent_id AS branch_id
      FROM app_users me
      JOIN org_nodes n ON n.id = me.home_node_id AND n.type = 'partner'
      JOIN org_links l ON l.child_id = n.id AND l.kind = 'location_link' AND l.tenant_id = app_tenant_id()
     WHERE me.id = app_user_id() AND me.tenant_id = app_tenant_id()
     LIMIT 1
  )
  SELECT u.id, u.display_name, u.picture_url, u.last_active_at
    FROM my_branch b
    JOIN org_links l ON l.parent_id = b.branch_id AND l.kind = 'location_link' AND l.tenant_id = app_tenant_id()
    JOIN org_nodes n ON n.id = l.child_id AND n.type = 'partner' AND n.tenant_id = app_tenant_id()
    JOIN app_users u ON u.home_node_id = n.id AND u.tenant_id = app_tenant_id()
   WHERE u.id <> app_user_id()
     AND u.status = 'active'
     AND u.last_active_at > now() - interval '5 minutes'
   ORDER BY u.display_name NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION app_branch_partners_online() TO app_runtime;
