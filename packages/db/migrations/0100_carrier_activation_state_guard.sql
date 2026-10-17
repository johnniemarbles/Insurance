-- Keep product activation scoped to carrier appointments that are ready.
CREATE OR REPLACE FUNCTION carrier_product_evidence_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence_count integer;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM carrier_contract_cases c WHERE c.id=NEW.contract_id
   AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id
   AND c.state IN ('appointment_verified','active')
 ) THEN RAISE EXCEPTION 'Carrier contract is not ready for product activation'; END IF;
 SELECT count(DISTINCT kind) INTO evidence_count FROM carrier_authorization_evidence e
 WHERE e.tenant_id=NEW.tenant_id AND e.node_id=NEW.node_id
 AND e.contract_id=NEW.contract_id AND e.product_code=NEW.product_code
 AND e.revoked_at IS NULL AND e.effective_on<=CURRENT_DATE AND e.expires_on>=CURRENT_DATE;
 IF evidence_count<>4 THEN RAISE EXCEPTION 'Incomplete carrier product evidence'; END IF;
 RETURN NEW;
END $$;
