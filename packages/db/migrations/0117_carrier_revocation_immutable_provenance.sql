-- Keep manual revocation provenance immutable after the first revocation.
-- An automated revocation must never be rewritten as a manual officer action.
CREATE OR REPLACE FUNCTION carrier_product_revocation_provenance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.revoked_at IS NOT NULL AND
    (NEW.revocation_source,NEW.revoked_by,NEW.revoked_at,NEW.reason)
    IS DISTINCT FROM (OLD.revocation_source,OLD.revoked_by,OLD.revoked_at,OLD.reason)
  THEN RAISE EXCEPTION 'Carrier grant revocation provenance is immutable'; END IF;
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
   IF NEW.revocation_source='manual' AND NEW.revoked_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'Manual carrier grant revocation actor mismatch';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
