-- Two more kinds of notice: open anti-money-laundering items (a large cash receipt past its reporting window, a screening hit nobody reviewed)
-- and a warning when signed paperwork has waited too long to reach the archive vault.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder',
   'course_request', 'course_decision', 'quiz_attempts', 'team_overdue', 'aml_alert', 'vault_alert'));
