-- Record the reason and timestamp when authorization evidence is revoked.
ALTER TABLE carrier_authorization_evidence
 ADD CONSTRAINT carrier_evidence_revocation_reason_length
 CHECK (revoked_at IS NULL OR length(btrim(coalesce(revocation_reason,''))) BETWEEN 8 AND 500);
