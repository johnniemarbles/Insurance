-- Product revocations must be permanent; a new approval must use a
-- separate, audited activation cycle instead of clearing revoked_at.
CREATE OR REPLACE FUNCTION carrier_product_revocation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.revoked_at IS NOT NULL AND
    (NEW.revoked_at,NEW.revoked_by,NEW.reason) IS DISTINCT FROM
    (OLD.revoked_at,OLD.revoked_by,OLD.reason) THEN
   RAISE EXCEPTION 'Product grant revocation is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_product_revocation_immutable_trigger
 BEFORE UPDATE ON carrier_product_activations
 FOR EACH ROW EXECUTE FUNCTION carrier_product_revocation_immutable();
