-- Make grant revocation robust when a non-interactive reconciliation runs.
CREATE OR REPLACE FUNCTION carrier_contract_state_revokes_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='active' AND NEW.state<>'active' THEN
  UPDATE carrier_product_activations
   SET revoked_at=now(),revoked_by=coalesce(app_user_id(),activated_by),
       reason='Carrier contract state changed from active'
   WHERE tenant_id=NEW.tenant_id AND node_id=NEW.node_id
     AND contract_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
