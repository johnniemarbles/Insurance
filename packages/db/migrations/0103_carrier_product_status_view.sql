-- Keep authorization grants invalid after appointment dates lapse.
-- This is a read-only inspection view, not a sales authorization grant.
CREATE VIEW carrier_product_authorization_status WITH (security_invoker=true) AS
 SELECT g.tenant_id,g.node_id,g.contract_id,g.product_code,g.id AS grant_id,
        (g.revoked_at IS NULL AND c.state='active'
         AND c.appointment_effective_on<=CURRENT_DATE
         AND c.appointment_expires_on IS NOT NULL
         AND c.appointment_expires_on>=CURRENT_DATE
         AND (SELECT count(DISTINCT e.kind) FROM carrier_authorization_evidence e
              WHERE e.tenant_id=g.tenant_id AND e.node_id=g.node_id
                AND e.contract_id=g.contract_id AND e.product_code=g.product_code
                AND e.revoked_at IS NULL AND e.effective_on<=CURRENT_DATE
                AND e.expires_on>=CURRENT_DATE)=4) AS evidence_current
 FROM carrier_product_activations g
 JOIN carrier_contract_cases c ON c.id=g.contract_id
  AND c.tenant_id=g.tenant_id AND c.node_id=g.node_id;
