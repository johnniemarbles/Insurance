-- Certificates now say which version of the course was completed, and take the CE hours from that version
-- (so a later change to a course's CE hours cannot rewrite an old certificate).
GRANT CREATE ON SCHEMA public TO app_headoffice;
GRANT SELECT ON course_versions TO app_headoffice;
DROP FUNCTION certificate_public(text);
CREATE FUNCTION certificate_public(p_code text) RETURNS TABLE (
  code text, issued_at timestamptz, learner text, course text, company text, hours numeric, category text, pack text, locale text, version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.verification_code, c.issued_at, coalesce(u.display_name, u.email::text),
         coalesce((SELECT cl.title FROM course_locales cl WHERE cl.course_id = co.id AND cl.locale::text = c.locale::text),
                  (SELECT cl.title FROM course_locales cl WHERE cl.course_id = co.id AND cl.locale = 'en'), ''),
         t.name,
         coalesce((v.snapshot #>> '{ce,hours}')::numeric, CASE WHEN v.id IS NULL THEN co.ce_hours END),
         coalesce(v.snapshot #>> '{ce,category}', CASE WHEN v.id IS NULL THEN co.ce_category END),
         coalesce(v.snapshot #>> '{ce,pack}', CASE WHEN v.id IS NULL THEN co.ce_pack END),
         c.locale::text, e.course_version
    FROM certificates c JOIN enrollments e ON e.id = c.enrollment_id JOIN courses co ON co.id = e.course_id
    JOIN app_users u ON u.id = e.user_id JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN course_versions v ON v.course_id = co.id AND v.version = e.course_version
   WHERE c.verification_code = p_code
$$;
ALTER FUNCTION certificate_public(text) OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION certificate_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION certificate_public(text) TO app_auth;
REVOKE CREATE ON SCHEMA public FROM app_headoffice;
