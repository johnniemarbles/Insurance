-- Head office can add the companies of its own country, and see them. Still no access to CRM records.
GRANT INSERT ON tenants, tenant_settings, org_nodes, app_users, user_node_roles, audit_log TO app_headoffice;
GRANT SELECT ON tenant_settings, deployment_info TO app_headoffice;

CREATE FUNCTION ho_company_list() RETURNS TABLE (
  tenant_id uuid, name text, created_at timestamptz, admin_email text, admin_status text, partners int, submitted int, approved int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT t.id, t.name, t.created_at,
         (SELECT u.email::text FROM user_node_roles r JOIN app_users u ON u.id = r.user_id JOIN org_nodes n ON n.id = r.node_id AND n.type = 'tenant'
           WHERE r.tenant_id = t.id AND r.role = 'admin' ORDER BY u.created_at LIMIT 1),
         (SELECT u.status::text FROM user_node_roles r JOIN app_users u ON u.id = r.user_id JOIN org_nodes n ON n.id = r.node_id AND n.type = 'tenant'
           WHERE r.tenant_id = t.id AND r.role = 'admin' ORDER BY u.created_at LIMIT 1),
         (SELECT count(*)::int FROM org_nodes n WHERE n.tenant_id = t.id AND n.type = 'partner' AND n.is_active),
         (SELECT count(*)::int FROM compliance_profiles p WHERE p.tenant_id = t.id AND p.status = 'submitted'),
         (SELECT count(*)::int FROM compliance_profiles p WHERE p.tenant_id = t.id AND p.status = 'approved')
    FROM tenants t WHERE NOT t.is_head_office ORDER BY t.name LIMIT 500;
END $$;

-- A new company in this deployment's country, with its first administrator invited by email.
-- Only head office administrators may do this (a Compliance person reviews files but does not create companies).
CREATE FUNCTION ho_company_create(p_name text, p_admin_email text, p_locale text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE tid uuid := gen_random_uuid(); rid uuid := gen_random_uuid(); uid uuid := gen_random_uuid(); reg text; ctry text; mail text := lower(btrim(p_admin_email));
BEGIN
  PERFORM ho_require();
  IF NOT EXISTS (SELECT 1 FROM user_node_roles WHERE user_id = app_user_id() AND tenant_id = app_tenant_id() AND role::text = 'admin') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Company name must be 2 to 120 characters' USING ERRCODE = '22023'; END IF;
  IF mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023'; END IF;
  IF p_locale NOT IN ('en', 'fr-CA') THEN RAISE EXCEPTION 'Unknown language' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM app_users WHERE email = mail) THEN RAISE EXCEPTION 'That email already has an account' USING ERRCODE = '23505'; END IF;
  SELECT region::text INTO reg FROM deployment_info;
  ctry := CASE WHEN reg = 'us' THEN 'US' ELSE 'CA' END;
  INSERT INTO tenants (id, name, country_code, region, default_locale, is_head_office) VALUES (tid, btrim(p_name), ctry, reg::region_code, p_locale::locale_code, false);
  INSERT INTO tenant_settings (tenant_id, max_partner_levels) VALUES (tid, (SELECT max_partner_levels FROM tenant_settings WHERE tenant_id = app_tenant_id()));
  INSERT INTO org_nodes (id, tenant_id, type, name) VALUES (rid, tid, 'tenant', btrim(p_name));
  INSERT INTO app_users (id, tenant_id, email, locale, status, home_node_id) VALUES (uid, tid, mail, p_locale::locale_code, 'invited', rid);
  INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES (tid, uid, rid, 'admin');
  INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail) VALUES (tid, NULL, 'tenant_created', 'tenant', tid, jsonb_build_object('name', btrim(p_name), 'by_head_office_user', app_user_id()));
  RETURN tid;
END $$;

ALTER FUNCTION ho_company_list() OWNER TO app_headoffice;
ALTER FUNCTION ho_company_create(text, text, text) OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION ho_company_list(), ho_company_create(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ho_company_list(), ho_company_create(text, text, text) TO app_runtime;
