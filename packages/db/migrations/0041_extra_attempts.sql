-- A manager can give a learner more tries at a quiz: {lessonId: extra tries}. Pinned to the enrollment, so it follows the learner and nothing else.
ALTER TABLE enrollments ADD COLUMN extra_attempts jsonb NOT NULL DEFAULT '{}'::jsonb;
