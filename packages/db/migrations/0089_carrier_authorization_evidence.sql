-- Compliance-controlled carrier authorization evidence, scoped to an individual
-- contract and product. Missing, revoked, or expired evidence never authorizes sales.
CREATE TABLE carrier_authorization_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 kind text NOT NULL CHECK (kind IN ('training','product_scope','jurisdiction_scope','hold_clearance')),
 product_code text NOT NULL CHECK (length(btrim(product_code)) BETWEEN 1 AND 80),
 evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 8 AND 500),
 verified_by uuid NOT NULL REFERENCES app_users(id),
 verified_at timestamptz NOT NULL DEFAULT now(),
 effective_on date NOT NULL,
 expires_on date NOT NULL,
 revoked_at timestamptz,
 revoked_by uuid REFERENCES app_users(id),
 revocation_reason text,
 CHECK (expires_on >= effective_on),
 CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
 UNIQUE (contract_id,kind,product_code,evidence_ref)
);
ALTER TABLE carrier_authorization_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_authorization_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_authorization_evidence AS RESTRICTIVE
 USING (tenant_id=app_tenant_id()) WITH CHECK (tenant_id=app_tenant_id());
CREATE POLICY evidence_read ON carrier_authorization_evidence FOR SELECT
 USING (app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY evidence_insert ON carrier_authorization_evidence FOR INSERT
 WITH CHECK (app_can_write() AND verified_by=app_user_id() AND app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY evidence_update ON carrier_authorization_evidence FOR UPDATE
 USING (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id))
 WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id));
GRANT SELECT,INSERT,UPDATE ON carrier_authorization_evidence TO app_runtime;
CREATE INDEX carrier_evidence_lookup ON carrier_authorization_evidence(tenant_id,contract_id,product_code,kind,expires_on)
 WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION carrier_authorization_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM carrier_contract_cases c
   WHERE c.id=NEW.contract_id AND c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id) THEN
   RAISE EXCEPTION 'Carrier evidence scope mismatch';
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (OLD.tenant_id,OLD.contract_id,OLD.node_id,OLD.kind,OLD.product_code,
       OLD.evidence_ref,OLD.verified_by,OLD.verified_at,OLD.effective_on,OLD.expires_on)
      IS DISTINCT FROM
      (NEW.tenant_id,NEW.contract_id,NEW.node_id,NEW.kind,NEW.product_code,
       NEW.evidence_ref,NEW.verified_by,NEW.verified_at,NEW.effective_on,NEW.expires_on)
   THEN
     RAISE EXCEPTION 'Carrier evidence is immutable; revoke and create a new record';
   END IF;
   IF OLD.revoked_at IS NOT NULL AND
     (NEW.revoked_at,NEW.revoked_by,NEW.revocation_reason) IS DISTINCT FROM
     (OLD.revoked_at,OLD.revoked_by,OLD.revocation_reason) THEN
     RAISE EXCEPTION 'Carrier evidence revocation is immutable';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_authorization_evidence_guard_trigger
 BEFORE INSERT OR UPDATE ON carrier_authorization_evidence
 FOR EACH ROW EXECUTE FUNCTION carrier_authorization_evidence_guard();
