-- A hold release does not itself restore a product grant.
-- Track release evidence independently from the historic grant that was revoked.
COMMENT ON COLUMN carrier_compliance_holds.released_at IS
 'Releasing a compliance hold never reinstates a revoked carrier product activation; a new activation is required.';
COMMENT ON COLUMN carrier_product_activations.revocation_source IS
 'manual means officer revocation; contract_state means automatic contract transition; compliance_hold means automatic revocation following an officer-created hold.';
