-- Whoever is enrolled in a course (by opening it, or by an assignment) gains the Learner role at their learning node.
-- They keep every other role, so a Partner who enrols is Partner and Learner together.
CREATE FUNCTION enrollment_adds_learner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_node_roles (tenant_id, user_id, node_id, role)
  VALUES (NEW.tenant_id, NEW.user_id, NEW.learner_node_id, 'learner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER enrollment_adds_learner AFTER INSERT ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enrollment_adds_learner();
