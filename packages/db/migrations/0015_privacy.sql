-- Privacy centre: a person's requests about their own data (access, withdrawal of consent, erasure).
-- The person sees their own; a company administrator sees and resolves all of them.
CREATE TABLE privacy_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES app_users(id),
  kind        text NOT NULL CHECK (kind IN ('access', 'withdraw', 'erase')),
  note        text CHECK (note IS NULL OR length(note) <= 2000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  resolution  text CHECK (resolution IS NULL OR length(resolution) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  due_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_users(id)
);
CREATE INDEX ON privacy_requests (tenant_id, status, created_at DESC);
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON privacy_requests AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY pr_select ON privacy_requests FOR SELECT USING (user_id = app_user_id() OR app_is_tenant_admin());
CREATE POLICY pr_insert ON privacy_requests FOR INSERT WITH CHECK (user_id = app_user_id());
CREATE POLICY pr_update ON privacy_requests FOR UPDATE USING (app_is_tenant_admin()) WITH CHECK (app_is_tenant_admin());
