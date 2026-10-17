-- Product activation cannot be granted without all four current evidence kinds.
-- Recheck evidence at insert time to protect against direct database writes.
CREATE OR REPLACE FUNCTION carrier_product_evidence_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence_count integer;
BEGIN
 SELECT count(DISTINCT kind) INTO evidence_count
 FROM carrier_authorization_evidence e
 WHERE e.tenant_id=NEW.tenant_id AND e.node_id=NEW.node_id
   AND e.contract_id=NEW.contract_id AND e.product_code=NEW.product_code
   AND e.revoked_at IS NULL
   AND e.effective_on<=CURRENT_DATE AND e.expires_on>=CURRENT_DATE
   AND e.kind IN ('training','product_scope','jurisdiction_scope','hold_clearance');
 IF evidence_count<>4 THEN
   RAISE EXCEPTION 'Incomplete carrier product authorization evidence';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_product_evidence_insert_guard_trigger
 BEFORE INSERT ON carrier_product_activations
 FOR EACH ROW EXECUTE FUNCTION carrier_product_evidence_insert_guard();
