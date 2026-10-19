-- Gate 5: Production Operations Launch
-- 1. Dual-Custody Electronic Fund Transfer (EFT/ACH / CPA 005 / NACHA) Disbursement Engine
-- 2. Insurer Production Appointment Sign-Off Registry

-- 1. Payout Batches
CREATE TABLE IF NOT EXISTS payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES commission_imports(id) ON DELETE RESTRICT,
  currency varchar(3) NOT NULL CHECK (currency IN ('CAD', 'USD')),
  total_amount_cents bigint NOT NULL CHECK (total_amount_cents >= 0),
  split_count integer NOT NULL CHECK (split_count > 0),
  batch_file_sha256 text NOT NULL CHECK (batch_file_sha256 ~ '^[a-f0-9]{64}$'),
  file_format varchar(16) NOT NULL CHECK (file_format IN ('CPA_005', 'NACHA')),
  file_content text NOT NULL,
  status text NOT NULL DEFAULT 'pending_dual_approval' CHECK (status IN ('pending_dual_approval', 'approved', 'released', 'rejected')),
  prepared_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  released_at timestamptz,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Dual-Custody Invariant: Approver MUST be distinct from Preparer
  CONSTRAINT chk_payout_batches_dual_custody CHECK (approved_by IS NULL OR approved_by <> prepared_by)
);

CREATE INDEX IF NOT EXISTS payout_batches_tenant_import_idx
  ON payout_batches (tenant_id, import_id);

CREATE INDEX IF NOT EXISTS payout_batches_status_idx
  ON payout_batches (tenant_id, status);

ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON payout_batches
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON payout_batches TO app_runtime;
REVOKE ALL ON payout_batches FROM PUBLIC, app_auth;

-- 2. Payout Splits (Individual direct deposit line items)
CREATE TABLE IF NOT EXISTS payout_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  split_id uuid NOT NULL REFERENCES commission_splits(id) ON DELETE RESTRICT,
  producer_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  routing_transit varchar(32) NOT NULL,
  account_number_masked varchar(32) NOT NULL,
  recipient_name varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_splits_batch_idx
  ON payout_splits (tenant_id, batch_id);

CREATE INDEX IF NOT EXISTS payout_splits_producer_idx
  ON payout_splits (tenant_id, producer_node_id);

ALTER TABLE payout_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_splits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON payout_splits
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON payout_splits TO app_runtime;
REVOKE ALL ON payout_splits FROM PUBLIC, app_auth;

-- 3. Insurer Production Appointment Sign-Offs
CREATE TABLE IF NOT EXISTS carrier_production_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id) ON DELETE RESTRICT,
  appointment_reference text NOT NULL CHECK (length(trim(appointment_reference)) > 0),
  insurer_signoff_contact text NOT NULL CHECK (length(trim(insurer_signoff_contact)) > 0),
  signed_off_at timestamptz NOT NULL DEFAULT now(),
  signed_off_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date NOT NULL,
  dpa_agreement_hash text NOT NULL CHECK (dpa_agreement_hash ~ '^[a-f0-9]{64}$'),
  jurisdictions text[] NOT NULL DEFAULT ARRAY['QC', 'ON', 'BC'],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_carrier_signoffs_dates CHECK (effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS carrier_signoffs_tenant_carrier_idx
  ON carrier_production_signoffs (tenant_id, carrier_id, status);

ALTER TABLE carrier_production_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_production_signoffs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON carrier_production_signoffs
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON carrier_production_signoffs TO app_runtime;
REVOKE ALL ON carrier_production_signoffs FROM PUBLIC, app_auth;

-- 4. Immutability Trigger for Released Payout Batches
CREATE OR REPLACE FUNCTION lock_released_payout_batches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'payout_batches' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'released' THEN
        RAISE EXCEPTION 'Cannot modify a released payout batch'
          USING ERRCODE = '23505';
      END IF;
      IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'released', 'rejected') THEN
        RAISE EXCEPTION 'Approved batch can only transition to released or rejected'
          USING ERRCODE = '23505';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('approved', 'released') THEN
        RAISE EXCEPTION 'Cannot delete an approved or released payout batch'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'payout_splits' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF EXISTS (
        SELECT 1 FROM payout_batches
         WHERE id = OLD.batch_id AND status IN ('approved', 'released')
      ) THEN
        RAISE EXCEPTION 'Cannot modify or delete payout splits for an approved or released batch'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_released_payout_batches ON payout_batches;
CREATE TRIGGER trg_lock_released_payout_batches
BEFORE UPDATE OR DELETE ON payout_batches
FOR EACH ROW EXECUTE FUNCTION lock_released_payout_batches();

DROP TRIGGER IF EXISTS trg_lock_released_payout_splits ON payout_splits;
CREATE TRIGGER trg_lock_released_payout_splits
BEFORE UPDATE OR DELETE ON payout_splits
FOR EACH ROW EXECUTE FUNCTION lock_released_payout_batches();
