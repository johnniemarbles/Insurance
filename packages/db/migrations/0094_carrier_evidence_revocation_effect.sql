-- Revoke an active product grant when its supporting evidence is revoked.
CREATE OR REPLACE FUNCTION carrier_evidence_revocation_effect()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
   UPDATE carrier_product_activations
      SET revoked_at=NEW.revoked_at,revoked_by=NEW.revoked_by,
          reason='Authorization evidence revoked'
    WHERE tenant_id=NEW.tenant_id AND contract_id=NEW.contract_id
      AND node_id=NEW.node_id AND product_code=NEW.product_code
      AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_evidence_revocation_effect_trigger
 AFTER UPDATE OF revoked_at ON carrier_authorization_evidence
 FOR EACH ROW EXECUTE FUNCTION carrier_evidence_revocation_effect();
