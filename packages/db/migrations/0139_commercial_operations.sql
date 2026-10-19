-- Phase 11: Commercial Operations Foundation
-- Policy Inventory Ledger, Idempotent Commission Import Registry, Reconciliation Foundation,
-- Append-Only Financial Audit History, and Tenant Isolation Invariants.

-- 1. In-Force Policy Inventory Ledger
CREATE TABLE IF NOT EXISTS policy_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
  producer_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  policy_number text NOT NULL CHECK (length(trim(policy_number)) > 0 AND length(policy_number) <= 80),
  plan_name text NOT NULL CHECK (length(trim(plan_name)) > 0 AND length(plan_name) <= 120),
  jurisdiction text NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(?:-[A-Z0-9]{2,10})?$'),
  annual_premium_cents integer NOT NULL CHECK (annual_premium_cents >= 0),
  modal_premium_cents integer NOT NULL CHECK (modal_premium_cents >= 0),
  premium_frequency text NOT NULL CHECK (premium_frequency IN ('annual', 'semi-annual', 'quarterly', 'monthly')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'lapsed', 'cancelled', 'surrendered', 'reinstated')),
  effective_date date NOT NULL,
  expiry_date date,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, carrier_id, policy_number),
  CHECK (expiry_date IS NULL OR expiry_date >= effective_date)
);

CREATE INDEX IF NOT EXISTS policy_records_lookup
  ON policy_records (tenant_id, carrier_id, status);

CREATE INDEX IF NOT EXISTS policy_records_branch_idx
  ON policy_records (tenant_id, branch_node_id);

CREATE INDEX IF NOT EXISTS policy_records_producer_idx
  ON policy_records (tenant_id, producer_node_id);

-- 2. Idempotent Commission Statement Import Registry
CREATE TABLE IF NOT EXISTS commission_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  statement_reference text NOT NULL CHECK (length(trim(statement_reference)) > 0 AND length(statement_reference) <= 120),
  statement_date date NOT NULL,
  file_hash_sha256 text NOT NULL CHECK (file_hash_sha256 ~ '^[a-f0-9]{64}$'),
  total_gross_cents integer NOT NULL CHECK (total_gross_cents >= 0),
  total_net_cents integer NOT NULL CHECK (total_net_cents >= 0),
  line_count integer NOT NULL CHECK (line_count >= 0),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'reconciled', 'exceptions_flagged', 'approved', 'posted')),
  payouts_disabled boolean NOT NULL DEFAULT true CHECK (payouts_disabled = true),
  imported_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, carrier_id, file_hash_sha256)
);

CREATE INDEX IF NOT EXISTS commission_imports_tenant_carrier_idx
  ON commission_imports (tenant_id, carrier_id, statement_date DESC);

-- 3. Commission Line Items & Reconciliation Linkage
CREATE TABLE IF NOT EXISTS commission_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES commission_imports(id) ON DELETE CASCADE,
  policy_number text NOT NULL CHECK (length(trim(policy_number)) > 0 AND length(policy_number) <= 80),
  policy_id uuid REFERENCES policy_records(id) ON DELETE SET NULL,
  carrier_producer_code text CHECK (carrier_producer_code IS NULL OR length(carrier_producer_code) <= 60),
  producer_node_id uuid REFERENCES org_nodes(id) ON DELETE SET NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('first_year', 'renewal', 'override', 'bonus', 'chargeback', 'fee')),
  gross_amount_cents integer NOT NULL,
  net_amount_cents integer NOT NULL,
  reconciliation_status text NOT NULL DEFAULT 'unmatched' CHECK (reconciliation_status IN ('matched', 'unmatched', 'variance_flagged', 'chargeback_linked')),
  exception_reason text CHECK (exception_reason IS NULL OR length(exception_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_lines_import_idx
  ON commission_line_items (tenant_id, import_id);

CREATE INDEX IF NOT EXISTS commission_lines_policy_num_idx
  ON commission_line_items (tenant_id, policy_number);

-- 4. Financial Audit History (Append-Only)
CREATE TABLE IF NOT EXISTS commercial_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('policy_record', 'commission_import')),
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  change_summary jsonb
);

CREATE INDEX IF NOT EXISTS commercial_audit_lookup
  ON commercial_audit (tenant_id, entity_type, entity_id, recorded_at DESC);

-- Trigger for financial audit
CREATE OR REPLACE FUNCTION record_commercial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_tenant_id uuid;
BEGIN
  v_actor := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_entity_type := TG_ARGV[0];
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_entity_id := COALESCE(NEW.id, OLD.id);

  INSERT INTO commercial_audit (
    tenant_id, entity_type, entity_id, operation, actor_id, change_summary
  ) VALUES (
    v_tenant_id,
    v_entity_type,
    v_entity_id,
    TG_OP,
    v_actor,
    CASE 
      WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW)
      WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)
      ELSE jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS policy_records_audit_trigger ON policy_records;
CREATE TRIGGER policy_records_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON policy_records
FOR EACH ROW EXECUTE FUNCTION record_commercial_change('policy_record');

DROP TRIGGER IF EXISTS commission_imports_audit_trigger ON commission_imports;
CREATE TRIGGER commission_imports_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON commission_imports
FOR EACH ROW EXECUTE FUNCTION record_commercial_change('commission_import');

-- 5. Row-Level Security (RLS) & Drift Prevention
ALTER TABLE policy_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON policy_records
  FOR ALL TO app_runtime
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE commission_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_imports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON commission_imports
  FOR ALL TO app_runtime
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE commission_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON commission_line_items
  FOR ALL TO app_runtime
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE commercial_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON commercial_audit
  FOR SELECT TO app_runtime
  USING (tenant_id = app_tenant_id());

-- 6. Runtime Role Permissions & Regression Safeguards
GRANT SELECT, INSERT, UPDATE ON policy_records, commission_imports, commission_line_items TO app_runtime;
REVOKE ALL ON policy_records, commission_imports, commission_line_items FROM PUBLIC, app_auth;

GRANT SELECT ON commercial_audit TO app_runtime;
REVOKE INSERT, UPDATE, DELETE ON commercial_audit FROM app_runtime;
REVOKE ALL ON commercial_audit FROM PUBLIC, app_auth;

-- Regression guard: reaffirm direct app_runtime permissions for carrier_certifications
GRANT SELECT, INSERT, UPDATE ON carrier_certifications TO app_runtime;
REVOKE INSERT, UPDATE, DELETE ON carrier_certification_audit FROM app_runtime;
GRANT SELECT ON carrier_certification_audit TO app_runtime;

COMMENT ON TABLE policy_records IS 'Authoritative in-force and historical policy inventory with monetary values in integer cents.';
COMMENT ON TABLE commission_imports IS 'Idempotent carrier commission statement registry keyed by SHA-256 hash.';
COMMENT ON TABLE commission_line_items IS 'Line item remittance details linked to policies and reconciliation status.';
COMMENT ON TABLE commercial_audit IS 'Append-only financial audit log with actor provenance for commercial operations.';
