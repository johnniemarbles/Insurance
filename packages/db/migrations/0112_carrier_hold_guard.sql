-- Prevent cross-contract scope changes and preserve hold history.
CREATE OR REPLACE FUNCTION carrier_compliance_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM carrier_contract_cases c WHERE c.id=NEW.contract_id
 AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id) THEN
 RAISE EXCEPTION 'Carrier hold contract scope mismatch'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.id,OLD.tenant_id,OLD.contract_id,OLD.node_id,OLD.reason,OLD.created_by,OLD.created_at)
  IS DISTINCT FROM (NEW.id,NEW.tenant_id,NEW.contract_id,NEW.node_id,NEW.reason,NEW.created_by,NEW.created_at)
  OR OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'Carrier hold history is immutable'; END IF;
  IF NEW.released_at IS NULL OR NEW.released_by IS NULL THEN
   RAISE EXCEPTION 'Carrier hold updates may only release an open hold'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_compliance_hold_guard_trigger
 BEFORE INSERT OR UPDATE ON carrier_compliance_holds
 FOR EACH ROW EXECUTE FUNCTION carrier_compliance_hold_guard();
