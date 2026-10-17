-- Authoritative contract-scoped compliance holds; no inferred clearance from attestations.
CREATE TABLE carrier_compliance_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 released_by uuid REFERENCES app_users(id),
 released_at timestamptz,
 release_reason text,
 CHECK ((released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
 OR (released_at IS NOT NULL AND released_by IS NOT NULL AND length(btrim(coalesce(release_reason,'')))>=8))
);
ALTER TABLE carrier_compliance_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_compliance_holds FORCE ROW LEVEL SECURITY;
CREATE POLICY carrier_hold_tenant ON carrier_compliance_holds AS RESTRICTIVE
 USING (tenant_id=app_tenant_id()) WITH CHECK (tenant_id=app_tenant_id());
CREATE POLICY carrier_hold_read ON carrier_compliance_holds FOR SELECT
 USING (app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY carrier_hold_insert ON carrier_compliance_holds FOR INSERT
 WITH CHECK (app_can_write() AND created_by=app_user_id() AND app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY carrier_hold_update ON carrier_compliance_holds FOR UPDATE
 USING (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id))
 WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id));
GRANT SELECT,INSERT,UPDATE ON carrier_compliance_holds TO app_runtime;
CREATE INDEX carrier_open_holds_idx ON carrier_compliance_holds(tenant_id,contract_id,node_id)
 WHERE released_at IS NULL;
