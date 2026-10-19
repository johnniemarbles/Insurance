-- Phase 7 Follow-Up: Append-only carrier certification audit history with transaction actor provenance.

CREATE TABLE IF NOT EXISTS carrier_certification_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  operation text NOT NULL CHECK (
    operation IN ('INSERT', 'UPDATE', 'DELETE')
  ),
  actor_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  previous_record jsonb,
  current_record jsonb,
  UNIQUE (tenant_id, carrier_id, revision)
);

CREATE INDEX IF NOT EXISTS carrier_cert_audit_lookup
ON carrier_certification_audit
(tenant_id, carrier_id, recorded_at DESC);

ALTER TABLE carrier_certification_audit
ENABLE ROW LEVEL SECURITY;

ALTER TABLE carrier_certification_audit
FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall
ON carrier_certification_audit
FOR SELECT TO app_runtime
USING (tenant_id = app_tenant_id());

GRANT SELECT ON carrier_certification_audit TO app_runtime;

REVOKE ALL ON carrier_certification_audit
FROM PUBLIC, app_auth;

REVOKE INSERT, UPDATE, DELETE ON carrier_certification_audit FROM app_runtime;

CREATE OR REPLACE FUNCTION record_carrier_certification_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- Use a trusted, transaction-scoped identity established
  -- by the authentication middleware via app.user_id.
  v_actor := NULLIF(
    current_setting('app.user_id', true), ''
  )::uuid;

  INSERT INTO carrier_certification_audit (
    tenant_id,
    carrier_id,
    revision,
    operation,
    actor_id,
    previous_record,
    current_record
  )
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    COALESCE(NEW.carrier_id, OLD.carrier_id),
    COALESCE(NEW.revision, OLD.revision),
    TG_OP,
    v_actor,
    CASE WHEN TG_OP = 'INSERT'
      THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE'
      THEN NULL ELSE to_jsonb(NEW) END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS carrier_certification_audit_trigger ON carrier_certifications;

CREATE TRIGGER carrier_certification_audit_trigger
AFTER INSERT OR UPDATE OR DELETE
ON carrier_certifications
FOR EACH ROW
EXECUTE FUNCTION record_carrier_certification_change();

COMMENT ON TABLE carrier_certification_audit IS 'Append-only audit history of carrier certification changes recorded by trigger with transaction actor provenance.';
