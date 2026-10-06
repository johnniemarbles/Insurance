-- Head office insights: counts only, across every company in this country. No names, no records.
-- One call returns everything the overview needs, so a country answers once instead of five times.
CREATE FUNCTION ho_insights(p_global_min numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ho_require();
  WITH parts AS (
    SELECT n.id, p.status, p.legal_name, p.entity_type, p.submitted_at, p.reviewed_at,
           (SELECT count(*) FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence') AS lic,
           (SELECT count(*) FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo') AS eo,
           (SELECT max(i.limit_amount) FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS eomax,
           greatest(coalesce((SELECT (sv.value #>> '{}')::numeric FROM setting_values sv WHERE sv.scope_type = 'tenant' AND sv.scope_id = n.tenant_id AND sv.key = 'compliance.eoMinLimit'), 0), coalesce(p_global_min, 0)) AS emin
      FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office
      LEFT JOIN compliance_profiles p ON p.node_id = n.id
     WHERE n.type = 'partner' AND n.is_active)
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'partners', count(*),
      'profile', count(*) FILTER (WHERE legal_name IS NOT NULL AND entity_type IS NOT NULL),
      'documents', count(*) FILTER (WHERE lic > 0 AND eo > 0),
      'submitted', count(*) FILTER (WHERE status IN ('submitted', 'approved')),
      'approved', count(*) FILTER (WHERE status = 'approved')),
    'backlog', jsonb_build_object(
      'waiting', count(*) FILTER (WHERE status = 'submitted'),
      'oldestDays', coalesce(max(current_date - submitted_at::date) FILTER (WHERE status = 'submitted'), 0),
      'fresh', count(*) FILTER (WHERE status = 'submitted' AND current_date - submitted_at::date < 3),
      'aging', count(*) FILTER (WHERE status = 'submitted' AND current_date - submitted_at::date BETWEEN 3 AND 6),
      'stale', count(*) FILTER (WHERE status = 'submitted' AND current_date - submitted_at::date >= 7),
      'avgDaysToApprove', (round(avg(extract(epoch FROM reviewed_at - submitted_at) / 86400) FILTER (WHERE status = 'approved' AND submitted_at IS NOT NULL AND reviewed_at > now() - interval '90 days')::numeric, 1))),
    'coverage', jsonb_build_object(
      'meets', count(*) FILTER (WHERE eomax IS NOT NULL AND eomax >= emin),
      'below', count(*) FILTER (WHERE eomax IS NOT NULL AND eomax < emin),
      'none', count(*) FILTER (WHERE eomax IS NULL)))
    INTO r FROM parts;

  r := r || jsonb_build_object(
    'expiry', jsonb_build_object(
      'overdue', (SELECT count(*) FROM compliance_items i JOIN tenants t ON t.id = i.tenant_id AND NOT t.is_head_office JOIN org_nodes n ON n.id = i.node_id AND n.is_active WHERE i.expires_on < current_date),
      'within30', (SELECT count(*) FROM compliance_items i JOIN tenants t ON t.id = i.tenant_id AND NOT t.is_head_office JOIN org_nodes n ON n.id = i.node_id AND n.is_active WHERE i.expires_on <= current_date + 30),
      'within14', (SELECT count(*) FROM compliance_items i JOIN tenants t ON t.id = i.tenant_id AND NOT t.is_head_office JOIN org_nodes n ON n.id = i.node_id AND n.is_active WHERE i.expires_on <= current_date + 14),
      'weeks', (SELECT coalesce(jsonb_agg(coalesce(c.n, 0) ORDER BY g.w), '[]'::jsonb) FROM generate_series(0, 12) AS g(w)
                  LEFT JOIN (SELECT ((i.expires_on - current_date) / 7) AS w, count(*) AS n
                               FROM compliance_items i JOIN tenants t ON t.id = i.tenant_id AND NOT t.is_head_office JOIN org_nodes n ON n.id = i.node_id AND n.is_active
                              WHERE i.expires_on >= current_date AND i.expires_on < current_date + 91 GROUP BY 1) c ON c.w = g.w)),
    'appointments', (SELECT jsonb_build_object(
        'requested', count(*) FILTER (WHERE a.status = 'requested'), 'inProgress', count(*) FILTER (WHERE a.status = 'in_progress'),
        'appointed', count(*) FILTER (WHERE a.status = 'appointed'), 'declined', count(*) FILTER (WHERE a.status = 'declined'))
        FROM carrier_appointments a JOIN tenants t ON t.id = a.tenant_id AND NOT t.is_head_office),
    'companies', jsonb_build_object(
      'total', (SELECT count(*) FROM tenants WHERE NOT is_head_office),
      'adminNotSignedIn', (SELECT count(*) FROM tenants t WHERE NOT t.is_head_office AND
          (SELECT u.status::text FROM user_node_roles ur JOIN app_users u ON u.id = ur.user_id JOIN org_nodes n ON n.id = ur.node_id AND n.type = 'tenant'
            WHERE ur.tenant_id = t.id AND ur.role = 'admin' ORDER BY u.created_at LIMIT 1) = 'invited')));
  RETURN r;
END $$;

ALTER FUNCTION ho_insights(numeric) OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION ho_insights(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ho_insights(numeric) TO app_runtime;
