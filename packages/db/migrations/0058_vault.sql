-- Archive vault: signed paperwork copied (encrypted) to write-once storage outside the database.
-- One row per archived document. Append-only: the record of what was archived, where, and until when cannot be edited or removed.
CREATE TABLE vault_objects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  document_id    uuid NOT NULL,                 -- the box_documents row (kept even if the document is later removed)
  advice_id      uuid,
  box_id         uuid,
  bucket         text NOT NULL,
  object_key     text NOT NULL,
  version_id     text,
  sha256         text NOT NULL,                 -- of the stored (encrypted) object
  plain_sha256   text NOT NULL,                 -- of the document itself
  size_bytes     int NOT NULL,
  lock_mode      text NOT NULL CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE', 'NONE')),
  retain_until   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id)
);
CREATE INDEX ON vault_objects (tenant_id, created_at DESC);
ALTER TABLE vault_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON vault_objects AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('vault_objects', 'true');
REVOKE ALL ON vault_objects FROM app_runtime;
GRANT SELECT, INSERT ON vault_objects TO app_runtime;
