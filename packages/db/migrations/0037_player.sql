-- Step-by-step courses and "continue where I left off".
ALTER TABLE courses ADD COLUMN sequential boolean NOT NULL DEFAULT false;
ALTER TABLE enrollments ADD COLUMN last_lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL;
