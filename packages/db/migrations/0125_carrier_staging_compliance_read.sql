-- Carrier staging contains officer-only business workflow evidence.
-- Remove the broader node-member read path: the API already requires Compliance.
DROP POLICY carrier_submission_read ON carrier_business_submissions;
CREATE POLICY carrier_submission_read ON carrier_business_submissions
 FOR SELECT USING (app_is_compliance_at_or_above(tenant_id,node_id));
