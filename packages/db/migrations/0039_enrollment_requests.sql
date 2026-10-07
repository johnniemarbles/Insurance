-- Optional enrollment: a course can ask people to request access, and a manager approves or declines.
ALTER TABLE courses ADD COLUMN enrollment_mode text NOT NULL DEFAULT 'open' CHECK (enrollment_mode IN ('open', 'approval'));

CREATE TABLE enrollment_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  learner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  decision_note   text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  decided_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX enrollment_requests_one_pending ON enrollment_requests (user_id, course_id) WHERE status = 'pending';
CREATE INDEX ON enrollment_requests (tenant_id, course_id, status);
ALTER TABLE enrollment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON enrollment_requests AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('enrollment_requests', 'user_id = app_user_id() OR lms_node_visible(tenant_id, learner_node_id)');

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder',
   'course_request', 'course_decision'));

