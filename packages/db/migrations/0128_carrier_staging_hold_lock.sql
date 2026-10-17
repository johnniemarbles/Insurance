-- All compliance hold writes must serialize with product activation and business staging.
-- The API already locks the carrier contract, but direct app_runtime writers must
-- be held to the same transaction boundary.
CREATE OR REPLACE FUNCTION carrier_hold_contract_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_contract uuid;
BEGIN
 SELECT c.id INTO v_contract FROM carrier_contract_cases c
 WHERE c.id=NEW.contract_id AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id
 FOR UPDATE;
 IF v_contract IS NULL THEN
   RAISE EXCEPTION 'Carrier hold contract scope mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_hold_contract_lock_trigger
 BEFORE INSERT ON carrier_compliance_holds
 FOR EACH ROW EXECUTE FUNCTION carrier_hold_contract_lock();
