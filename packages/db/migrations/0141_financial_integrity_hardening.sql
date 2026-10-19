-- Phase 13: Financial Integrity Hardening
-- Non-overlapping agreement validity, contractual holdback controls,
-- split deduplication, immutable approval snapshots, and chargeback accounting.

-- 1. Tighten Contractual Holdback Controls on commission_agreements
-- Remove the automatic default of 500 BPS (holdback must be contractual and explicit)
ALTER TABLE commission_agreements
  ALTER COLUMN holdback_bps DROP DEFAULT;

-- Enforce holdback cannot exceed the broker's split share
ALTER TABLE commission_agreements
  DROP CONSTRAINT IF EXISTS comm_agreements_holdback_le_broker;
ALTER TABLE commission_agreements
  ADD CONSTRAINT comm_agreements_holdback_le_broker
  CHECK (holdback_bps <= broker_split_bps);

-- 2. Non-Overlapping Active Agreement Validity Enforcement
-- Prevents overlapping date ranges for active agreements with the same tenant, producer, and carrier
CREATE OR REPLACE FUNCTION check_commission_agreement_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1
        FROM commission_agreements
       WHERE tenant_id = NEW.tenant_id
         AND producer_node_id = NEW.producer_node_id
         AND carrier_id = NEW.carrier_id
         AND status = 'active'
         AND id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') &&
             daterange(NEW.effective_from, coalesce(NEW.effective_to, 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'Active commission agreement date range overlaps with an existing agreement for this producer and carrier'
        USING ERRCODE = '23P01'; -- exclusion_violation
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_commission_agreement_overlap ON commission_agreements;
CREATE TRIGGER trg_check_commission_agreement_overlap
BEFORE INSERT OR UPDATE ON commission_agreements
FOR EACH ROW EXECUTE FUNCTION check_commission_agreement_overlap();

-- 3. Split Deduplication & Line Uniqueness
-- Prevents duplicate splits for the same statement line item
CREATE UNIQUE INDEX IF NOT EXISTS comm_splits_line_unique
  ON commission_splits (tenant_id, import_id, line_item_id);

-- Expand commission_splits status to support clawbacks
ALTER TABLE commission_splits
  DROP CONSTRAINT IF EXISTS commission_splits_status_check;
ALTER TABLE commission_splits
  ADD CONSTRAINT commission_splits_status_check
  CHECK (status IN ('calculated', 'approved', 'held', 'clawback'));

-- 4. Immutable Statement Approval Snapshots
ALTER TABLE commission_imports
  ADD COLUMN IF NOT EXISTS approval_snapshot jsonb;

-- Prevent modification or deletion of splits belonging to approved or posted statements
CREATE OR REPLACE FUNCTION lock_approved_commission_records()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'commission_splits' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF EXISTS (
        SELECT 1 FROM commission_imports 
         WHERE id = OLD.import_id AND status IN ('approved', 'posted')
      ) THEN
        RAISE EXCEPTION 'Cannot modify or delete commission splits for an approved or posted statement'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN OLD;
  ELSIF TG_TABLE_NAME = 'commission_imports' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status IN ('approved', 'posted') AND NEW.status NOT IN ('approved', 'posted') THEN
        RAISE EXCEPTION 'Cannot revoke or alter status of an approved statement'
          USING ERRCODE = '23505';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('approved', 'posted') THEN
        RAISE EXCEPTION 'Cannot delete an approved commission statement'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_approved_commission_splits ON commission_splits;
CREATE TRIGGER trg_lock_approved_commission_splits
BEFORE UPDATE OR DELETE ON commission_splits
FOR EACH ROW EXECUTE FUNCTION lock_approved_commission_records();

DROP TRIGGER IF EXISTS trg_lock_approved_commission_imports ON commission_imports;
CREATE TRIGGER trg_lock_approved_commission_imports
BEFORE UPDATE OR DELETE ON commission_imports
FOR EACH ROW EXECUTE FUNCTION lock_approved_commission_records();

COMMENT ON COLUMN commission_imports.approval_snapshot IS 'Immutable JSON snapshot of applied agreements, line calculations, and audit metadata at moment of approval.';
