-- Sign-in sessions and invitation acceptance.
-- Sessions are looked up before a tenant context exists, so only the auth role touches them.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,          -- the cookie holds the token; only its hash is stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  FOREIGN KEY (user_id, tenant_id) REFERENCES app_users (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ON sessions (user_id);
CREATE INDEX ON sessions (expires_at);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON sessions AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- No permissive policy and no grant: the application role can never read a session.
REVOKE ALL ON sessions FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO app_auth;

-- Invitation acceptance runs as the auth role (the person has no tenant context yet).
GRANT INSERT ON app_users, user_node_roles TO app_auth;
GRANT INSERT ON audit_log TO app_auth;
GRANT UPDATE (accepted_at) ON invitations TO app_auth;
GRANT SELECT ON user_node_roles TO app_auth;
GRANT UPDATE (display_name) ON app_users TO app_auth;
