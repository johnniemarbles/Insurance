-- Versioned courses. Publishing a course records a frozen copy ("version") of what learners will read and be tested on.
-- Republishing with changed content makes the next version. A version is never edited or removed.
ALTER TABLE courses ADD COLUMN version int NOT NULL DEFAULT 0;            -- the latest published version; 0 = never published
ALTER TABLE enrollments ADD COLUMN course_version int;                    -- the version this learner is working under (frozen once completed)

CREATE TABLE course_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version      int NOT NULL CHECK (version >= 1),
  snapshot     jsonb NOT NULL,
  published_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, version)
);
ALTER TABLE course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON course_versions AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('course_versions', 'EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id)');

-- Immutable: no edits, and no deletes except when the whole course is going away.
CREATE FUNCTION course_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'A published course version cannot be changed'; END IF;
  IF EXISTS (SELECT 1 FROM courses WHERE id = OLD.course_id) THEN RAISE EXCEPTION 'A published course version cannot be removed'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER course_versions_immutable BEFORE UPDATE OR DELETE ON course_versions FOR EACH ROW EXECUTE FUNCTION course_versions_immutable();

-- New enrollments start on the course's current version, however they are created.
CREATE FUNCTION enrollments_pin_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.course_version IS NULL THEN
    SELECT NULLIF(c.version, 0) INTO NEW.course_version FROM courses c WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollments_pin_version BEFORE INSERT ON enrollments FOR EACH ROW EXECUTE FUNCTION enrollments_pin_version();

-- Publish: freeze the content. Unchanged content keeps its version; changed content makes the next one,
-- and learners who have not finished move onto it (finished learners keep the version they completed).
CREATE FUNCTION publish_course_version(p_course uuid, p_user uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  snap jsonb; last_v int; last_snap jsonb; v int; c courses%ROWTYPE;
BEGIN
  SELECT * INTO c FROM courses WHERE id = p_course;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown course'; END IF;
  snap := jsonb_build_object(
    'locales', (SELECT coalesce(jsonb_agg(jsonb_build_object('locale', locale, 'title', title, 'description', description) ORDER BY locale), '[]'::jsonb) FROM course_locales WHERE course_id = p_course),
    'ce', jsonb_build_object('pack', c.ce_pack, 'hours', c.ce_hours, 'category', c.ce_category),
    'quebecFacing', c.quebec_facing,
    'lessons', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'position', l.position, 'type', l.type, 'required', l.required, 'passMark', l.pass_mark, 'maxAttempts', l.max_attempts,
        'locales', (SELECT coalesce(jsonb_agg(jsonb_build_object('locale', ll.locale, 'title', ll.title, 'body', ll.body) ORDER BY ll.locale), '[]'::jsonb) FROM lesson_locales ll WHERE ll.lesson_id = l.id),
        'questions', (SELECT coalesce(jsonb_agg(jsonb_build_object('position', q.position, 'type', q.type, 'content', q.content, 'correct', q.correct, 'points', q.points) ORDER BY q.position), '[]'::jsonb) FROM quiz_questions q WHERE q.lesson_id = l.id)
      ) ORDER BY l.position), '[]'::jsonb) FROM lessons l WHERE l.course_id = p_course));
  SELECT version, snapshot INTO last_v, last_snap FROM course_versions WHERE course_id = p_course ORDER BY version DESC LIMIT 1;
  IF last_v IS NOT NULL AND (last_snap - 'locales') = (snap - 'locales') THEN
    v := last_v;
  ELSE
    v := coalesce(last_v, 0) + 1;
    INSERT INTO course_versions (tenant_id, course_id, version, snapshot, published_by) VALUES (c.tenant_id, p_course, v, snap, p_user);
    UPDATE enrollments SET course_version = v WHERE course_id = p_course AND status <> 'completed';
  END IF;
  UPDATE courses SET version = v WHERE id = p_course;
  RETURN v;
END $$;

-- Courses that are already live become version 1, and everyone who has taken them is on version 1.
SELECT publish_course_version(id, NULL) FROM courses WHERE status IN ('published', 'archived') AND EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = courses.id);
UPDATE enrollments SET course_version = 1 WHERE course_version IS NULL AND course_id IN (SELECT course_id FROM course_versions);
