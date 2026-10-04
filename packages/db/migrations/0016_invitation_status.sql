-- Invitations keep their own delivery record, so the screen can say what really happened.
ALTER TABLE invitations
  ADD COLUMN created_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN sent_at         timestamptz,
  ADD COLUMN sent_by         uuid REFERENCES app_users(id),
  ADD COLUMN delivery_method text CHECK (delivery_method IS NULL OR delivery_method IN ('gmail', 'link')),
  ADD COLUMN delivery_error  text CHECK (delivery_error IS NULL OR length(delivery_error) <= 300),
  ADD COLUMN attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN link_opened_at  timestamptz,
  ADD COLUMN stale_notified_at timestamptz;
-- The sign-in page notes that the link was opened; it cannot touch anything else.
GRANT UPDATE (link_opened_at, stale_notified_at) ON invitations TO app_auth;
GRANT SELECT ON invitations, org_nodes, tenants, app_users TO app_auth;
GRANT INSERT ON notifications TO app_auth;

-- Two new kinds of notification.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale'));

-- Activity: a branch administrator may read the audit lines that belong to the branches they administer.
CREATE FUNCTION app_admin_node_ids() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.admin_node_ids', true), '')::uuid[], '{}'::uuid[]) $$;
CREATE POLICY branch_admin_read ON audit_log FOR SELECT USING (
  owner_node_id IS NOT NULL AND EXISTS (SELECT 1 FROM org_reach r WHERE r.descendant_id = audit_log.owner_node_id AND r.ancestor_id = ANY (app_admin_node_ids()))
);
CREATE INDEX ON audit_log (tenant_id, created_at DESC);
CREATE INDEX ON audit_log (owner_node_id, created_at DESC);
