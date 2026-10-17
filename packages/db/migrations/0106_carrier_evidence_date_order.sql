-- Enforce finite validity dates on carrier authorization evidence.
ALTER TABLE carrier_authorization_evidence
 ADD CONSTRAINT carrier_authorization_valid_date_order
 CHECK (expires_on>=effective_on);
ALTER TABLE carrier_contract_cases
 ADD CONSTRAINT carrier_appointment_valid_date_order
 CHECK (appointment_expires_on IS NULL OR appointment_effective_on IS NULL
        OR appointment_expires_on>=appointment_effective_on);
