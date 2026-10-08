-- Private links that open the demo tenant without a Google account.
-- Only a hash of the link is stored. Looked up before any tenant context exists, so only the auth role touches it.
CREATE TABLE demo_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  token_hash   bytea NOT NULL UNIQUE,
  label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  max_uses     integer NOT NULL DEFAULT 50 CHECK (max_uses BETWEEN 1 AND 1000),
  uses         integer NOT NULL DEFAULT 0,
  last_used_at timestamptz
);
CREATE INDEX ON demo_invites (tenant_id);
ALTER TABLE demo_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_invites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON demo_invites AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
REVOKE ALL ON demo_invites FROM app_runtime;
GRANT SELECT, INSERT, UPDATE ON demo_invites TO app_auth;
