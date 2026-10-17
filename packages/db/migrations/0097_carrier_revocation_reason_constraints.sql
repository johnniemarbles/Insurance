-- A revoked evidence record must carry a meaningful reason.
ALTER TABLE carrier_authorization_evidence ADD CONSTRAINT carrier_evidence_revocation_reason_required
 CHECK (revoked_at IS NULL OR length(btrim(coalesce(revocation_reason,'')))>=8);
-- A revoked product activation must retain a reason for audit.
ALTER TABLE carrier_product_activations ADD CONSTRAINT carrier_product_revocation_reason_required
 CHECK (revoked_at IS NULL OR length(btrim(coalesce(reason,'')))>=8);
