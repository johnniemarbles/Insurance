-- Learning and CE reminders: in-app, once per person per situation.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder'));

-- Which reminders were already made. The key names the situation (course + stage, or CE term + state), so each is sent once.
CREATE TABLE reminder_marks (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (length(key) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
ALTER TABLE reminder_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON reminder_marks AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('reminder_marks', 'true');
