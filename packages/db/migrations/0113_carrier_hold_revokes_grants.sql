-- Open holds immediately revoke outstanding carrier product grants.
-- Reapproval requires an explicit new activation after all checks pass.
CREATE OR REPLACE FUNCTION carrier_hold_revokes_product_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE carrier_product_activations
 SET revoked_at=now(),revoked_by=NEW.created_by,reason='Carrier compliance hold: '||NEW.id::text
 WHERE tenant_id=NEW.tenant_id AND node_id=NEW.node_id
 AND contract_id=NEW.contract_id AND revoked_at IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_hold_revokes_product_grants_trigger
 AFTER INSERT ON carrier_compliance_holds
 FOR EACH ROW EXECUTE FUNCTION carrier_hold_revokes_product_grants();
