-- Staging is a write-once evidence ledger. Never allow editing or deletion
-- of a previously authorized staging decision.
CREATE OR REPLACE FUNCTION carrier_business_submission_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Carrier business staging history is immutable';
END $$;
CREATE TRIGGER carrier_business_submission_immutable_trigger
 BEFORE UPDATE OR DELETE ON carrier_business_submissions
 FOR EACH ROW EXECUTE FUNCTION carrier_business_submission_immutable();
REVOKE UPDATE,DELETE,TRUNCATE ON carrier_business_submissions FROM app_runtime;
