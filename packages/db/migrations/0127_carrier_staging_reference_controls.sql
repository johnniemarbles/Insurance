-- Enforce canonical external references for every writer, not only the HTTP route.
-- Keep the staging ledger free of embedded control characters.
ALTER TABLE carrier_business_submissions
 ADD CONSTRAINT carrier_submission_reference_no_controls
 CHECK (external_reference !~ '[[:cntrl:]]');
