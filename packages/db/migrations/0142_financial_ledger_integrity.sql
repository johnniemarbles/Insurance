-- Phase 14: Financial Ledger Integrity
-- Prevent concurrent overlapping agreements, block modification of approved financial records,
-- freeze approval snapshots, block changes to line items and splits after statement approval,
-- and mandate immutable reversal workflows for financial corrections.

-- 1. Concurrent Overlapping Agreement Prevention
-- Require btree_gist extension for engine-level exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Update trigger check_commission_agreement_overlap to acquire a transaction-level advisory lock
-- serializing concurrent agreement validation for the same tenant, producer, and carrier.
CREATE OR REPLACE FUNCTION check_commission_agreement_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    -- Serialize concurrent agreement validations for the same tenant, producer, and carrier
    PERFORM pg_advisory_xact_lock(
      hashtext(NEW.tenant_id::text || ':' || NEW.producer_node_id::text || ':' || NEW.carrier_id::text)
    );

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

-- Engine-level GiST exclusion constraint on active agreements
ALTER TABLE commission_agreements
  DROP CONSTRAINT IF EXISTS comm_agreements_no_overlap;
ALTER TABLE commission_agreements
  ADD CONSTRAINT comm_agreements_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    producer_node_id WITH =,
    carrier_id WITH =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (status = 'active');

-- 2. Enhanced Financial Ledger Record Locking
-- Completely block modification of approved statements, snapshots, line items, and splits.
CREATE OR REPLACE FUNCTION lock_approved_commission_records()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'commission_imports' THEN
    IF TG_OP = 'UPDATE' THEN
      -- If statement was already approved or posted, block ANY modification
      IF OLD.status IN ('approved', 'posted') THEN
        RAISE EXCEPTION 'Cannot modify an approved or posted commission statement'
          USING ERRCODE = '23505';
      END IF;
      -- If approval_snapshot is already present, prevent mutating it
      IF OLD.approval_snapshot IS NOT NULL AND NEW.approval_snapshot IS DISTINCT FROM OLD.approval_snapshot THEN
        RAISE EXCEPTION 'Cannot modify approval snapshot once created'
          USING ERRCODE = '23505';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('approved', 'posted') THEN
        RAISE EXCEPTION 'Cannot delete an approved commission statement'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'commission_line_items' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF EXISTS (
        SELECT 1 FROM commission_imports
         WHERE id = OLD.import_id AND status IN ('approved', 'posted')
      ) THEN
        RAISE EXCEPTION 'Cannot modify or delete line items for an approved or posted statement'
          USING ERRCODE = '23505';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF EXISTS (
        SELECT 1 FROM commission_imports
         WHERE id = NEW.import_id AND status IN ('approved', 'posted')
      ) THEN
        RAISE EXCEPTION 'Cannot add line items to an approved or posted statement'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  ELSIF TG_TABLE_NAME = 'commission_splits' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      IF EXISTS (
        SELECT 1 FROM commission_imports 
         WHERE id = OLD.import_id AND status IN ('approved', 'posted')
      ) THEN
        RAISE EXCEPTION 'Cannot modify or delete commission splits for an approved or posted statement'
          USING ERRCODE = '23505';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF EXISTS (
        SELECT 1 FROM commission_imports 
         WHERE id = NEW.import_id AND status IN ('approved', 'posted')
      ) THEN
        RAISE EXCEPTION 'Cannot insert commission splits for an approved or posted statement'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RETURN NULL;
END;
$$;

-- Drop and recreate triggers across all relevant tables
DROP TRIGGER IF EXISTS trg_lock_approved_commission_imports ON commission_imports;
CREATE TRIGGER trg_lock_approved_commission_imports
BEFORE UPDATE OR DELETE ON commission_imports
FOR EACH ROW EXECUTE FUNCTION lock_approved_commission_records();

DROP TRIGGER IF EXISTS trg_lock_approved_commission_line_items ON commission_line_items;
CREATE TRIGGER trg_lock_approved_commission_line_items
BEFORE INSERT OR UPDATE OR DELETE ON commission_line_items
FOR EACH ROW EXECUTE FUNCTION lock_approved_commission_records();

DROP TRIGGER IF EXISTS trg_lock_approved_commission_splits ON commission_splits;
CREATE TRIGGER trg_lock_approved_commission_splits
BEFORE INSERT OR UPDATE OR DELETE ON commission_splits
FOR EACH ROW EXECUTE FUNCTION lock_approved_commission_records();

COMMENT ON FUNCTION lock_approved_commission_records() IS 
  'Enforces financial ledger immutability: approved statements, line items, and splits are sealed and cannot be modified or deleted. Financial adjustments require reversal accounting.';
