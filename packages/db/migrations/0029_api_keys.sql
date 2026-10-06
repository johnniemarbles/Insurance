-- Read-only API keys for the public API (Zapier, spreadsheets, reporting tools).
-- A key acts as the person who made it and sees only what that person sees. Like sessions, keys are looked up before any
-- tenant context exists, so only the auth role touches this table; the token itself is never stored, only its hash.
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash   bytea NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  FOREIGN KEY (user_id, tenant_id) REFERENCES app_users (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX ON api_keys (user_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON api_keys AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
REVOKE ALL ON api_keys FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO app_auth;
