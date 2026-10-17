-- Harden carrier contract evidence and event provenance. Existing rows are validated
-- on deployment: fail the migration rather than silently accept inconsistent evidence.
ALTER TABLE carrier_contract_cases
 ADD CONSTRAINT carrier_signature_evidence_nonblank CHECK (signature_evidence_ref IS NULL OR length(btrim(signature_evidence_ref)) >= 8),
 ADD CONSTRAINT carrier_approval_evidence_nonblank CHECK (carrier_approval_ref IS NULL OR length(btrim(carrier_approval_ref)) >= 8),
 ADD CONSTRAINT carrier_appointment_evidence_nonblank CHECK (appointment_reference IS NULL OR length(btrim(appointment_reference)) >= 8),
 ADD CONSTRAINT carrier_signature_evidence_complete CHECK (
   (signature_evidence_ref IS NULL AND signature_verified_by IS NULL AND signature_verified_at IS NULL)
   OR (signature_evidence_ref IS NOT NULL AND signature_verified_by IS NOT NULL AND signature_verified_at IS NOT NULL)
 ),
 ADD CONSTRAINT carrier_approval_evidence_complete CHECK (
   (carrier_approval_ref IS NULL AND carrier_approved_by IS NULL AND carrier_approved_at IS NULL)
   OR (carrier_approval_ref IS NOT NULL AND carrier_approved_by IS NOT NULL AND carrier_approved_at IS NOT NULL)
 ),
 ADD CONSTRAINT carrier_appointment_evidence_complete CHECK (
   (appointment_reference IS NULL AND verified_by IS NULL AND verified_at IS NULL AND appointment_effective_on IS NULL AND appointment_expires_on IS NULL)
   OR (appointment_reference IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND appointment_effective_on IS NOT NULL)
 );

-- An event must belong to the same tenant and broker node as its contract.
-- The trigger also makes event history append-only, even for elevated roles.
CREATE OR REPLACE FUNCTION enforce_carrier_event_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN
   RAISE EXCEPTION 'Carrier contract event history is append-only';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM carrier_contract_cases c
   WHERE c.id = NEW.contract_id AND c.tenant_id = NEW.tenant_id AND c.node_id = NEW.node_id
 ) THEN
   RAISE EXCEPTION 'Carrier event tenant, node or contract mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carrier_event_provenance
 BEFORE INSERT OR UPDATE OR DELETE ON carrier_contract_events
 FOR EACH ROW EXECUTE FUNCTION enforce_carrier_event_provenance();

CREATE INDEX carrier_events_history_idx
 ON carrier_contract_events (tenant_id,contract_id,recorded_at DESC,id DESC);
