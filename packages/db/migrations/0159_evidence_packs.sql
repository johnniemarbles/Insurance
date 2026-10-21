-- Network evidence packs (roadmap Phase 3, feature 13). One export per partner, per carrier, or per regulator request:
-- the client files (each a full audit package), the partner compliance files, and the registers (complaints, file
-- reviews, licence checks, conduct decisions, supervision and suitability reviews, ID checks) for a period, with a
-- SHA-256 manifest. PII keeps a record of every pack it issued (who, when, what scope, and the manifest's hash), so
-- anyone holding a pack can later ask PII whether it is unchanged.
-- Ships switched off (EVIDENCE_PACKS_ENABLED); changes no existing row.

CREATE TABLE evidence_packs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  scope             text NOT NULL CHECK (scope IN ('partner', 'carrier', 'regulator')),
  scope_ref         text NOT NULL CHECK (char_length(scope_ref) BETWEEN 1 AND 120),
  scope_label       text NOT NULL CHECK (char_length(scope_label) BETWEEN 1 AND 200),
  request_reference text CHECK (request_reference IS NULL OR char_length(request_reference) <= 200),
  period_from       date NOT NULL,
  period_to         date NOT NULL,
  deal_count        int NOT NULL CHECK (deal_count >= 0),
  file_count        int NOT NULL CHECK (file_count >= 0),
  bytes             bigint NOT NULL CHECK (bytes >= 0),
  manifest_sha256   text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  exported_by       uuid NOT NULL REFERENCES app_users(id),
  exported_by_name  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);
CREATE INDEX evidence_packs_tenant ON evidence_packs (tenant_id, created_at DESC);
CREATE INDEX evidence_packs_hash ON evidence_packs (manifest_sha256);
ALTER TABLE evidence_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_packs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON evidence_packs AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY compliance_read ON evidence_packs FOR SELECT USING (app_is_tenant_admin() OR app_is_compliance_role());
CREATE POLICY compliance_insert ON evidence_packs FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND exported_by = app_user_id());
REVOKE ALL ON evidence_packs FROM app_runtime;
GRANT SELECT, INSERT ON evidence_packs TO app_runtime;   -- the register of issued packs is never changed
