-- Expiry reminders move from 30/15/0 days to 90/60/30/0. Marks already sent at 15 stay valid history.
ALTER TABLE compliance_marks DROP CONSTRAINT IF EXISTS compliance_marks_threshold_check;
ALTER TABLE compliance_marks ADD CONSTRAINT compliance_marks_threshold_check CHECK (threshold IN (90, 60, 30, 15, 0));
