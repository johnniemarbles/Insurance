-- A revoked activation is an immutable historical decision, not a permanent ban.
-- Keep its audit record and allow a new, explicitly reviewed activation after
-- evidence and contract checks pass again. Never allow two live grants.
ALTER TABLE carrier_product_activations
 DROP CONSTRAINT carrier_product_activations_contract_id_product_code_key;
CREATE UNIQUE INDEX carrier_product_one_live_grant_idx
 ON carrier_product_activations(tenant_id,contract_id,product_code)
 WHERE revoked_at IS NULL;
