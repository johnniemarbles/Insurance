-- Indexes so per-box counts (tasks, notes) stay fast when a list shows them.
CREATE INDEX IF NOT EXISTS tasks_box_idx ON tasks (box_id, due_at) WHERE box_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_box_idx ON notes (box_id, created_at DESC);
