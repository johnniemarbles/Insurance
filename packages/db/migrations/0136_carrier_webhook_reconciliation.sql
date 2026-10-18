-- Carrier inbound reconciliation and compliance review extensions.
ALTER TABLE carrier_webhook_receipts
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES carrier_contract_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS carrier_webhook_receipts_status_idx
  ON carrier_webhook_receipts (tenant_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS carrier_webhook_receipts_contract_idx
  ON carrier_webhook_receipts (tenant_id, contract_id);

GRANT SELECT, INSERT, UPDATE ON carrier_webhook_receipts TO app_runtime;
COMMENT ON COLUMN carrier_webhook_receipts.payload IS 'Raw validated payload for audit and compliance inspection.';
COMMENT ON COLUMN carrier_webhook_receipts.status IS 'Quarantined by default; requires explicit compliance review before operational reconciliation.';
