-- Advice records: the brokerage's own system of record for advice given to a client, with a signing tier.
-- A draft can be edited. Once signed, a record can never be changed or removed (trigger below).
CREATE TABLE advice_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  box_id         uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('needs_analysis','recommendation','beneficiary_designation','replacement_disclosure')),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  tier           text NOT NULL CHECK (tier IN ('builtin','vendor')),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_signature','signed')),
  client_name    text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 200),
  client_email   text,
  content_hash   text,
  otp_hash       text,
  otp_expires_at timestamptz,
  otp_attempts   int NOT NULL DEFAULT 0,
  signed_at      timestamptz,
  signed_method  text CHECK (signed_method IN ('otp','vendor')),
  vendor_name    text,
  vendor_ref     text,
  document_id    uuid REFERENCES box_documents(id) ON DELETE RESTRICT,
  created_by     uuid NOT NULL REFERENCES app_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advice_records_box ON advice_records (box_id, created_at DESC);
ALTER TABLE advice_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE advice_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON advice_records AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('advice_records', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');

CREATE FUNCTION advice_records_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed advice record cannot be changed or removed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER advice_records_lock BEFORE UPDATE OR DELETE ON advice_records FOR EACH ROW EXECUTE FUNCTION advice_records_lock();
