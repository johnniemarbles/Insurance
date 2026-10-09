-- Live e-signature connections. The secret part of a connection is encrypted with the company's key; routes never send it back.
CREATE TABLE esign_connections (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  vendor       text NOT NULL CHECK (vendor IN ('adobe_sign')),
  config_enc   bytea NOT NULL,
  key_id       text NOT NULL,
  api_host     text NOT NULL,                  -- not secret: shown to administrators
  set_by_name  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, vendor)
);
-- One row per document sent to a vendor for signature.
CREATE TABLE esign_envelopes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  advice_id      uuid NOT NULL REFERENCES advice_records(id) ON DELETE CASCADE,
  vendor         text NOT NULL,
  external_id    text NOT NULL,
  status         text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'signed', 'cancelled', 'expired')),
  vendor_status  text,
  signer_email   text NOT NULL,
  sent_by        uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON esign_envelopes (advice_id);
CREATE INDEX ON esign_envelopes (tenant_id) WHERE status = 'sent';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['esign_connections', 'esign_envelopes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
CALL apply_visibility_policies('esign_connections', 'true');
CALL apply_visibility_policies('esign_envelopes', 'EXISTS (SELECT 1 FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = advice_id)');
