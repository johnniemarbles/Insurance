-- In-app notifications. Anyone in the company can be told something; only the person told can read or clear it.
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed')),
  box_id     uuid REFERENCES boxes(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data       jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(data) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX ON notifications (user_id, created_at DESC);
CREATE INDEX ON notifications (user_id) WHERE read_at IS NULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON notifications AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY n_select ON notifications FOR SELECT USING (user_id = app_user_id());
CREATE POLICY n_insert ON notifications FOR INSERT WITH CHECK (app_can_write());
CREATE POLICY n_update ON notifications FOR UPDATE USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY n_delete ON notifications FOR DELETE USING (user_id = app_user_id());
GRANT SELECT (box_id) ON mail_merge_recipients TO app_auth;
