-- External auditor engagements (annual-review plan, section C). An auditor is not staff: it holds no roles. It holds one or more
-- engagements, each with a scope, a start and an end date. Access ends on the end date by itself; the inviter can end it earlier.
CREATE TABLE audit_engagements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  deputed_by        text NOT NULL CHECK (deputed_by IN ('regulator', 'insurer', 'other')),
  deputed_by_name   text CHECK (deputed_by_name IS NULL OR char_length(deputed_by_name) <= 120),
  auditor_email     citext NOT NULL,
  auditor_user_id   uuid REFERENCES app_users(id),
  scope             text[] NOT NULL CHECK (cardinality(scope) BETWEEN 1 AND 4
                      AND scope <@ ARRAY['policies', 'training_records', 'complaints_log', 'sampled_files']::text[]),
  masked            boolean NOT NULL DEFAULT true,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL CHECK (ends_on >= starts_on AND ends_on - starts_on <= 365),
  ended_at          timestamptz,
  ended_by          uuid REFERENCES app_users(id),
  created_by        uuid REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_engagements (tenant_id, auditor_user_id);
ALTER TABLE audit_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON audit_engagements AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Read: the President & CEO (tenant administrator), any Compliance Manager, and the auditor on its own engagements.
CREATE POLICY engagement_select ON audit_engagements FOR SELECT USING (
  auditor_user_id = app_user_id()
  OR app_is_tenant_admin()
  OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.role::text = 'compliance'));
-- Write: only the President & CEO or a Compliance Manager invites or ends an engagement.
CREATE POLICY engagement_insert ON audit_engagements FOR INSERT WITH CHECK (app_can_write() AND created_by = app_user_id()
  AND (app_is_tenant_admin() OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.role::text = 'compliance')));
CREATE POLICY engagement_update ON audit_engagements FOR UPDATE
  USING (app_can_write() AND (app_is_tenant_admin() OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.role::text = 'compliance')))
  WITH CHECK (app_can_write() AND (app_is_tenant_admin() OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = app_user_id() AND r.role::text = 'compliance')));
GRANT SELECT, INSERT, UPDATE ON audit_engagements TO app_runtime;
-- Sign-in links the auditor's login to its engagement when the invitation is accepted (packages/db/src/auth.ts).
GRANT SELECT, UPDATE (auditor_user_id) ON audit_engagements TO app_auth;

-- An invitation may be for an engagement. Accepting it creates the login but grants no role.
ALTER TABLE invitations ADD COLUMN audit_engagement_id uuid REFERENCES audit_engagements(id) ON DELETE SET NULL;
CREATE INDEX invitations_audit_engagement ON invitations (audit_engagement_id);
-- An auditor invitation sits at the tenant root, where a Compliance Manager has no branch access. Allow it when the inviter
-- created that engagement; every other invitation keeps its rule.
DROP POLICY vis_insert ON invitations;
CREATE POLICY vis_insert ON invitations FOR INSERT WITH CHECK (app_can_write() AND (
  app_is_tenant_admin()
  OR lms_node_visible(tenant_id, node_id)
  OR (audit_engagement_id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_engagements e WHERE e.id = invitations.audit_engagement_id AND e.created_by = app_user_id()))));
