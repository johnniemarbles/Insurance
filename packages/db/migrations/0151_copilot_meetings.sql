-- Co-pilot step 3: meeting notes from uploaded recordings. The co-pilot log gains the kind 'meeting'.
-- The recording itself is never stored: it is transcribed in memory and dropped. Changes no existing row.
ALTER TABLE copilot_log DROP CONSTRAINT copilot_log_kind_check;
ALTER TABLE copilot_log ADD CONSTRAINT copilot_log_kind_check CHECK (kind IN ('ask', 'rulebook', 'letter', 'meeting'));
