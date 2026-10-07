-- Quiz attempt rules: a wait between tries, and each try is numbered and tied to the course version it was taken under.
ALTER TABLE lessons ADD COLUMN cooldown_minutes int CHECK (cooldown_minutes IS NULL OR cooldown_minutes BETWEEN 1 AND 10080);
ALTER TABLE quiz_attempts ADD COLUMN attempt_no int;
ALTER TABLE quiz_attempts ADD COLUMN course_version int;
UPDATE quiz_attempts a SET attempt_no = r.n
  FROM (SELECT id, row_number() OVER (PARTITION BY enrollment_id, lesson_id ORDER BY attempted_at, id) AS n FROM quiz_attempts) r WHERE r.id = a.id;
UPDATE quiz_attempts a SET course_version = e.course_version FROM enrollments e WHERE e.id = a.enrollment_id;
CREATE UNIQUE INDEX quiz_attempts_no ON quiz_attempts (enrollment_id, lesson_id, attempt_no);
