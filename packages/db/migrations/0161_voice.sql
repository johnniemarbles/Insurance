-- Voice, part 1 (switch: VOICE_ENABLED): speak a question, dictate a note or task. The audio is transcribed once in
-- memory and never stored. The assistant log gains two kinds and the length of the recording in seconds; it keeps
-- counts only, never the audio or the words. Changes no existing row.
ALTER TABLE copilot_log DROP CONSTRAINT copilot_log_kind_check;
ALTER TABLE copilot_log ADD CONSTRAINT copilot_log_kind_check
  CHECK (kind IN ('ask', 'rulebook', 'letter', 'meeting', 'suitability', 'voice', 'voice_note'));
ALTER TABLE copilot_log ADD COLUMN audio_seconds integer CHECK (audio_seconds IS NULL OR audio_seconds BETWEEN 0 AND 600);
-- The hourly limit counts a person's own recordings.
CREATE INDEX copilot_log_voice ON copilot_log (user_id, created_at DESC) WHERE kind = 'voice';
