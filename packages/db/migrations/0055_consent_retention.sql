-- Client consents (with wording version and withdrawal), retention policies and legal holds.
CREATE TABLE client_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  box_id          uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('collection_use','carrier_sharing','electronic_comms','pink_slip_optin')),
  wording_version text NOT NULL CHECK (char_length(wording_version) BETWEEN 1 AND 40),
  channel         text NOT NULL CHECK (channel IN ('in_person','phone','email','esign')),
  granted_on      date NOT NULL,
  recorded_by     uuid NOT NULL REFERENCES app_users(id),
  recorded_by_name text NOT NULL,
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  withdrawn_at    timestamptz,
  withdrawn_by_name text,
  withdrawn_note  text CHECK (withdrawn_note IS NULL OR char_length(withdrawn_note) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_consents_box ON client_consents (box_id, kind, created_at DESC);
CREATE TABLE retention_policies (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  record_kind text NOT NULL CHECK (record_kind IN ('advice','aml','consent','ce_certificate')),
  years       int  NOT NULL CHECK (years BETWEEN 1 AND 30),
  set_by_name text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, record_kind)
);
CREATE TABLE legal_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  box_id          uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  placed_by_name  text NOT NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz,
  released_by_name text,
  release_note    text CHECK (release_note IS NULL OR char_length(release_note) <= 500)
);
CREATE UNIQUE INDEX legal_holds_one_active ON legal_holds (box_id) WHERE released_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['client_consents','retention_policies','legal_holds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
CALL apply_visibility_policies('client_consents', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
CALL apply_visibility_policies('legal_holds', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
CALL apply_visibility_policies('retention_policies', 'true');

-- Consents: a grant is permanent; only the withdrawal columns can be set, once.
REVOKE ALL ON client_consents FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (withdrawn_at, withdrawn_by_name, withdrawn_note) ON client_consents TO app_runtime;
CREATE FUNCTION client_consents_withdraw_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'This consent has already been withdrawn' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_consents_withdraw_once BEFORE UPDATE ON client_consents FOR EACH ROW EXECUTE FUNCTION client_consents_withdraw_once();
-- Holds: placed and released, never edited or removed.
REVOKE ALL ON legal_holds FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (released_at, released_by_name, release_note) ON legal_holds TO app_runtime;
CREATE FUNCTION legal_holds_release_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'This hold has already been released' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_holds_release_once BEFORE UPDATE ON legal_holds FOR EACH ROW EXECUTE FUNCTION legal_holds_release_once();
-- Policies can be changed but not deleted (a missing row means the default).
REVOKE DELETE ON retention_policies FROM app_runtime;
