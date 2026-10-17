-- Product activation is separate from the carrier contract's overall state.
-- A contract's active status never automatically activates every product.
CREATE TABLE carrier_product_activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 product_code text NOT NULL CHECK (product_code ~ '^[A-Z0-9_-]{1,80}$'),
 activated_by uuid NOT NULL REFERENCES app_users(id),
 activated_at timestamptz NOT NULL DEFAULT now(),
 revoked_by uuid REFERENCES app_users(id),
 revoked_at timestamptz,
 reason text,
 UNIQUE(contract_id,product_code),
 CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
ALTER TABLE carrier_product_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_product_activations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_product_activations AS RESTRICTIVE
 USING (tenant_id=app_tenant_id()) WITH CHECK (tenant_id=app_tenant_id());
CREATE POLICY carrier_product_read ON carrier_product_activations FOR SELECT USING
 (app_is_compliance_at_or_above(tenant_id,node_id) OR EXISTS
  (SELECT 1 FROM user_node_roles WHERE node_id=carrier_product_activations.node_id AND user_id=app_user_id()));
CREATE POLICY carrier_product_insert ON carrier_product_activations FOR INSERT WITH CHECK
 (app_can_write() AND activated_by=app_user_id() AND app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY carrier_product_update ON carrier_product_activations FOR UPDATE USING
 (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id))
 WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id));
GRANT SELECT,INSERT,UPDATE ON carrier_product_activations TO app_runtime;
CREATE OR REPLACE FUNCTION carrier_product_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM carrier_contract_cases c
    WHERE c.id=NEW.contract_id AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id) THEN
    RAISE EXCEPTION 'Carrier product scope mismatch';
 END IF;
 IF TG_OP='UPDATE' AND
    (OLD.tenant_id,OLD.contract_id,OLD.node_id,OLD.product_code,OLD.activated_by,OLD.activated_at)
    IS DISTINCT FROM
    (NEW.tenant_id,NEW.contract_id,NEW.node_id,NEW.product_code,NEW.activated_by,NEW.activated_at)
 THEN RAISE EXCEPTION 'Product activation identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_product_scope_guard_trigger
 BEFORE INSERT OR UPDATE ON carrier_product_activations
 FOR EACH ROW EXECUTE FUNCTION carrier_product_scope_guard();
