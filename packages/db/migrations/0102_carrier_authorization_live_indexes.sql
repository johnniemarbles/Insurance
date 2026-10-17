-- Validate that the carrier evidence and product activation hardening triggers exist.
-- Tests use the same migrated test database as the onboarding suite.
-- This migration only adds indexes; it does not grant authorization.
CREATE INDEX carrier_product_live_lookup_idx
 ON carrier_product_activations(tenant_id,contract_id,node_id,product_code)
 WHERE revoked_at IS NULL;
CREATE INDEX carrier_evidence_live_lookup_idx
 ON carrier_authorization_evidence(tenant_id,contract_id,node_id,product_code,kind)
 WHERE revoked_at IS NULL;
