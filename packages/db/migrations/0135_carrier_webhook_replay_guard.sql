-- Carrier inbound replay ledger. No automatic appointment activation.
CREATE TABLE IF NOT EXISTS carrier_webhook_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 carrier_id text NOT NULL REFERENCES carrier_directory(id),
 external_event_id text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined','reviewed','rejected')),
 UNIQUE (tenant_id,carrier_id,external_event_id)
);
ALTER TABLE carrier_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_webhook_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_webhook_receipts FOR ALL TO app_runtime
 USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
REVOKE ALL ON carrier_webhook_receipts FROM PUBLIC, app_auth;
GRANT SELECT, INSERT ON carrier_webhook_receipts TO app_runtime;
COMMENT ON TABLE carrier_webhook_receipts IS 'Quarantined inbound carrier event receipts, never automatic selling authorization.';
