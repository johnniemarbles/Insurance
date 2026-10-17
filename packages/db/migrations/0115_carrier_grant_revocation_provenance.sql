-- Distinguish automated revocation from an officer's manual decision.
-- Never attribute an unattended worker's action to the original activating officer.
ALTER TABLE carrier_product_activations
 ADD COLUMN revocation_source text NOT NULL DEFAULT 'manual'
 CHECK (revocation_source IN ('manual','contract_state','compliance_hold'));
ALTER TABLE carrier_product_activations
 DROP CONSTRAINT carrier_product_activations_check;
ALTER TABLE carrier_product_activations
 ADD CONSTRAINT carrier_grant_revocation_provenance CHECK (
  (revoked_at IS NULL AND revoked_by IS NULL AND revocation_source='manual')
  OR (revoked_at IS NOT NULL AND (
    (revocation_source='manual' AND revoked_by IS NOT NULL)
    OR (revocation_source IN ('contract_state','compliance_hold'))
  ))
 );
CREATE OR REPLACE FUNCTION carrier_contract_state_revokes_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='active' AND NEW.state<>'active' THEN
  UPDATE carrier_product_activations
  SET revoked_at=now(),revoked_by=app_user_id(),revocation_source='contract_state',
      reason='Carrier contract state changed from active'
  WHERE tenant_id=NEW.tenant_id AND node_id=NEW.node_id
    AND contract_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION carrier_hold_revokes_product_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE carrier_product_activations
 SET revoked_at=now(),revoked_by=NEW.created_by,revocation_source='compliance_hold',
     reason='Carrier compliance hold: '||NEW.id::text
 WHERE tenant_id=NEW.tenant_id AND node_id=NEW.node_id
   AND contract_id=NEW.contract_id AND revoked_at IS NULL;
 RETURN NEW;
END $$;
