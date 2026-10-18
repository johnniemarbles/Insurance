-- Transactional carrier dispatch outbox with worker revalidation and dead-letter queue.
CREATE TABLE IF NOT EXISTS carrier_dispatch_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id),
  operation text NOT NULL CHECK (operation IN ('contract_packet', 'business_submission', 'appointment_status')),
  jurisdiction text NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{2,10})?$'),
  idempotency_key text NOT NULL UNIQUE,
  evidence_reference text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'dispatched', 'failed', 'dead_letter')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  last_error text,
  receipt jsonb,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS carrier_dispatch_outbox_status_idx ON carrier_dispatch_outbox(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS carrier_dispatch_outbox_contract_idx ON carrier_dispatch_outbox(tenant_id, contract_id);

ALTER TABLE carrier_dispatch_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_dispatch_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON carrier_dispatch_outbox
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON carrier_dispatch_outbox TO app_runtime;
REVOKE ALL ON carrier_dispatch_outbox FROM PUBLIC, app_auth;

COMMENT ON TABLE carrier_dispatch_outbox IS 'Transactional carrier dispatch outbox with worker revalidation and dead-letter queue.';
