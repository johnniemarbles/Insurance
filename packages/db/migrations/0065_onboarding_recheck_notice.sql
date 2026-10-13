-- A notice for the Compliance officers and the company's administrators when a partner's 6-month check falls due (partner onboarding).
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder',
   'course_request', 'course_decision', 'quiz_attempts', 'team_overdue', 'aml_alert', 'vault_alert', 'first_week_late', 'onboarding_recheck'));
