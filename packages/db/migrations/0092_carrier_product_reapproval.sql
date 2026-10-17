-- Preserve historical revoked grants while allowing a fresh verified
-- approval after re-training or carrier reappointment.
ALTER TABLE carrier_product_activations
 DROP CONSTRAINT carrier_product_activations_contract_id_product_code_key;
CREATE UNIQUE INDEX carrier_product_one_live_grant
 ON carrier_product_activations(contract_id,product_code)
 WHERE revoked_at IS NULL;
