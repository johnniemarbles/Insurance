-- Phase 12: Versioned Commission Agreements, Deterministic Split Engine,
-- Reconciliation Approvals, and Commercial Audit Expansion.

-- 1. Versioned Commission Agreements
CREATE TABLE IF NOT EXISTS commission_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producer_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  version text NOT NULL CHECK (length(trim(version)) > 0 AND length(version) <= 30),
  broker_split_bps integer NOT NULL CHECK (broker_split_bps >= 0 AND broker_split_bps <= 10000),
  branch_override_bps integer NOT NULL CHECK (branch_override_bps >= 0 AND branch_override_bps <= 10000),
  mga_spread_bps integer NOT NULL CHECK (mga_spread_bps >= 0 AND mga_spread_bps <= 10000),
  holdback_bps integer NOT NULL DEFAULT 500 CHECK (holdback_bps >= 0 AND holdback_bps <= 2000),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'superseded', 'terminated')),
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, producer_node_id, carrier_id, version),
  CHECK (broker_split_bps + branch_override_bps + mga_spread_bps = 10000),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS comm_agreements_lookup
  ON commission_agreements (tenant_id, producer_node_id, carrier_id, status);

-- 2. Deterministic Commission Splits
CREATE TABLE IF NOT EXISTS commission_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES commission_imports(id) ON DELETE CASCADE,
  line_item_id uuid NOT NULL REFERENCES commission_line_items(id) ON DELETE CASCADE,
  agreement_id uuid REFERENCES commission_agreements(id) ON DELETE SET NULL,
  producer_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
  gross_amount_cents integer NOT NULL,
  broker_net_cents integer NOT NULL,
  branch_override_cents integer NOT NULL,
  mga_spread_cents integer NOT NULL,
  holdback_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated', 'approved', 'held')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comm_splits_import_idx
  ON commission_splits (tenant_id, import_id);

CREATE INDEX IF NOT EXISTS comm_splits_line_idx
  ON commission_splits (tenant_id, line_item_id);

CREATE INDEX IF NOT EXISTS comm_splits_producer_idx
  ON commission_splits (tenant_id, producer_node_id);

-- 3. Statement Approval Columns
ALTER TABLE commission_imports
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 4. Audit Log Expansion
ALTER TABLE commercial_audit DROP CONSTRAINT IF EXISTS commercial_audit_entity_type_check;
ALTER TABLE commercial_audit ADD CONSTRAINT commercial_audit_entity_type_check
  CHECK (entity_type IN ('policy_record', 'commission_import', 'commission_agreement'));

DROP TRIGGER IF EXISTS commission_agreements_audit_trigger ON commission_agreements;
CREATE TRIGGER commission_agreements_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON commission_agreements
FOR EACH ROW EXECUTE FUNCTION record_commercial_change('commission_agreement');

-- 5. Row-Level Security
ALTER TABLE commission_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_agreements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON commission_agreements
  FOR ALL TO app_runtime
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE commission_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_splits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON commission_splits
  FOR ALL TO app_runtime
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- 6. Runtime Role Permissions
GRANT SELECT, INSERT, UPDATE ON commission_agreements, commission_splits TO app_runtime;
REVOKE ALL ON commission_agreements, commission_splits FROM PUBLIC, app_auth;

COMMENT ON TABLE commission_agreements IS 'Versioned contractual commission schedule and split matrix in basis points.';
COMMENT ON TABLE commission_splits IS 'Deterministic gross/net commission breakdown calculated from approved agreements.';
