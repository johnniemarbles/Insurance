-- A product grant must not remain active when its carrier contract is no
-- longer active. This handles suspension, expiry, and termination.
CREATE OR REPLACE FUNCTION carrier_contract_state_revokes_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='active' AND NEW.state<>'active' THEN
  UPDATE carrier_product_activations
   SET revoked_at=now(),revoked_by=app_user_id(),
       reason='Carrier contract state changed from active'
   WHERE tenant_id=NEW.tenant_id AND node_id=NEW.node_id
     AND contract_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_contract_state_revokes_grants_trigger
 AFTER UPDATE OF state ON carrier_contract_cases
 FOR EACH ROW EXECUTE FUNCTION carrier_contract_state_revokes_grants();
