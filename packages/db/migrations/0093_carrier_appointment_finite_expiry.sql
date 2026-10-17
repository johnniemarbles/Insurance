-- Require finite expiry on verified carrier appointments. An undated
-- appointment must be reviewed rather than treated as perpetual authority.
ALTER TABLE carrier_contract_cases ADD CONSTRAINT carrier_appointment_finite_expiry
 CHECK (state NOT IN ('appointment_verified','active') OR appointment_expires_on IS NOT NULL);
