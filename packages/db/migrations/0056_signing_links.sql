-- Client-facing signing: a private link, a one-time code, a sealed PDF.
ALTER TABLE advice_records
  ADD COLUMN signer_typed_name text,
  ADD COLUMN signer_ip text,
  ADD COLUMN signer_agent text,
  ADD COLUMN document_sha256 text;

CREATE TABLE signing_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  advice_id     uuid NOT NULL REFERENCES advice_records(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL,
  node_id       uuid NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,          -- the link holds the token; only its hash is stored
  expires_at    timestamptz NOT NULL,
  otp_hash      text,
  otp_expires_at timestamptz,
  otp_attempts  int NOT NULL DEFAULT 0,
  sends         int NOT NULL DEFAULT 0,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signing_links_advice ON signing_links (advice_id);
ALTER TABLE signing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON signing_links AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Like sessions: looked up before any tenant context exists, so only the auth role touches it.
REVOKE ALL ON signing_links FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON signing_links TO app_auth;
