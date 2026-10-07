-- Assignment rules: an assignment can be limited to people who hold a role, and can set the due date as "N days after joining the course".
ALTER TABLE course_assignments ADD COLUMN role org_role;
ALTER TABLE course_assignments ADD COLUMN due_in_days int CHECK (due_in_days IS NULL OR due_in_days BETWEEN 1 AND 730);

-- Who a rule covers: everyone whose home branch is at or beneath the node and (if set) who holds the role somewhere.
CREATE FUNCTION assignment_audience(p_tenant uuid, p_node uuid, p_role org_role)
RETURNS TABLE (user_id uuid, name text, email text, home_node_id uuid) LANGUAGE sql STABLE AS $$
  SELECT u.id, coalesce(u.display_name, u.email::text), u.email::text, u.home_node_id
    FROM org_reach r JOIN app_users u ON u.home_node_id = r.descendant_id AND u.tenant_id = p_tenant AND u.status = 'active'
   WHERE r.tenant_id = p_tenant AND r.ancestor_id = p_node
     AND (p_role IS NULL OR EXISTS (SELECT 1 FROM user_node_roles x WHERE x.user_id = u.id AND x.role = p_role))
$$;

CREATE OR REPLACE FUNCTION sync_enrollments(p_assignment uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO enrollments (tenant_id, user_id, course_id, assignment_id, learner_node_id, due_at)
  SELECT a.tenant_id, au.user_id, a.course_id, a.id, au.home_node_id,
         coalesce(a.due_at, CASE WHEN a.due_in_days IS NOT NULL THEN now() + a.due_in_days * interval '1 day' END)
    FROM course_assignments a, assignment_audience(a.tenant_id, a.node_id, a.role) au
   WHERE a.id = p_assignment
  ON CONFLICT (user_id, course_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
