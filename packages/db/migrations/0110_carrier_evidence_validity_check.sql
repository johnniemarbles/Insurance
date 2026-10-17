-- Require carrier evidence validity dates to be finite and ordered.
-- Existing invalid rows must be remediated before applying this migration.
ALTER TABLE carrier_authorization_evidence
 ADD CONSTRAINT carrier_authorization_dates_currently_ordered
 CHECK (effective_on<=expires_on);
