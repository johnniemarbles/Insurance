-- Internal carrier business submissions are staged, never sent to a carrier by this table.
-- The transaction that inserts a row must check locked carrier authorization.
CREATE TABLE carrier_business_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id),
 product_code text NOT NULL CHECK (product_code ~ '^[A-Z0-9_-]{1,80}$'),
 external_reference text NOT NULL CHECK (length(btrim(external_reference)) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'staged' CHECK (status='staged'),
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,contract_id,external_reference)
);
ALTER TABLE carrier_business_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_business_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY carrier_submission_tenant ON carrier_business_submissions AS RESTRICTIVE
 USING (tenant_id=app_tenant_id()) WITH CHECK (tenant_id=app_tenant_id());
CREATE POLICY carrier_submission_read ON carrier_business_submissions FOR SELECT
 USING (app_is_compliance_at_or_above(tenant_id,node_id) OR EXISTS
 (SELECT 1 FROM user_node_roles WHERE node_id=carrier_business_submissions.node_id AND user_id=app_user_id()));
CREATE POLICY carrier_submission_insert ON carrier_business_submissions FOR INSERT
 WITH CHECK (app_can_write() AND created_by=app_user_id() AND app_is_compliance_at_or_above(tenant_id,node_id));
GRANT SELECT,INSERT ON carrier_business_submissions TO app_runtime;
CREATE INDEX carrier_submission_queue_idx ON carrier_business_submissions(tenant_id,contract_id,created_at DESC);
