-- Every staged submission must be authorized under the same transaction's contract lock.
-- The database trigger prevents bypass through a different API writer.
CREATE OR REPLACE FUNCTION carrier_business_submission_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM carrier_contract_cases c WHERE c.id=NEW.contract_id
   AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id
 ) THEN RAISE EXCEPTION 'Carrier submission contract scope mismatch'; END IF;
 IF NEW.created_by IS DISTINCT FROM app_user_id() THEN
  RAISE EXCEPTION 'Carrier submission actor mismatch'; END IF;
 IF NOT carrier_product_submission_authorized_locked(NEW.contract_id,NEW.product_code) THEN
  RAISE EXCEPTION 'Carrier product submission not authorized'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_business_submission_guard_trigger
 BEFORE INSERT ON carrier_business_submissions
 FOR EACH ROW EXECUTE FUNCTION carrier_business_submission_guard();
