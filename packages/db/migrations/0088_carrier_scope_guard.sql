-- Carrier contracts must refer to an onboarding case from the same tenant and node.
CREATE OR REPLACE FUNCTION carrier_case_scope_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM onboarding_cases oc
                WHERE oc.id=NEW.onboarding_case_id
                  AND oc.tenant_id=NEW.tenant_id AND oc.node_id=NEW.node_id) THEN
   RAISE EXCEPTION 'Carrier onboarding scope mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_case_scope_guard
 BEFORE INSERT OR UPDATE OF tenant_id,onboarding_case_id,node_id
 ON carrier_contract_cases FOR EACH ROW EXECUTE FUNCTION carrier_case_scope_check();
CREATE INDEX carrier_expiry_queue_idx ON carrier_contract_cases(tenant_id,appointment_expires_on)
 WHERE state IN ('active','appointment_verified');
