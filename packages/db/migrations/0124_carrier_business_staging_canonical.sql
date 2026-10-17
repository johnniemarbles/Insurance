-- Reject ambiguous whitespace or noncanonical product identifiers at storage.
-- API validation alone is not sufficient for future alternative writers.
ALTER TABLE carrier_business_submissions
 ADD CONSTRAINT carrier_submission_reference_canonical
 CHECK (external_reference=btrim(external_reference));
ALTER TABLE carrier_business_submissions
 ADD CONSTRAINT carrier_submission_product_canonical
 CHECK (product_code=upper(product_code));
