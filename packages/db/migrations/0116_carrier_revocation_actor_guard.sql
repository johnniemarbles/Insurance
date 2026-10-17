-- Ensure manual product revocations are attributed to an actual officer.
-- Automated revocations retain their explicit source and may have no user actor.
CREATE OR REPLACE FUNCTION carrier_product_revocation_provenance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
  IF NEW.revocation_source='manual' AND NEW.revoked_by IS DISTINCT FROM app_user_id() THEN
   RAISE EXCEPTION 'Manual carrier grant revocation actor mismatch';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_product_revocation_provenance_guard_trigger
 BEFORE UPDATE ON carrier_product_activations
 FOR EACH ROW EXECUTE FUNCTION carrier_product_revocation_provenance_guard();
