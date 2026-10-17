-- A missing carrier appointment expiry cannot retain active authorization.
-- Historical records require manual review before release.
CREATE INDEX carrier_contract_active_appointment_idx
 ON carrier_contract_cases(tenant_id,node_id,appointment_expires_on)
 WHERE state IN ('active','appointment_verified');
