-- A logged phone call is a note with an outcome and a length. Same table, same RLS.
ALTER TABLE notes
  ADD COLUMN kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'call')),
  ADD COLUMN call_outcome text CHECK (call_outcome IN ('connected', 'voicemail', 'no_answer', 'wrong_number')),
  ADD COLUMN call_minutes int CHECK (call_minutes BETWEEN 0 AND 600);
