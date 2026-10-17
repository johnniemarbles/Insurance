-- Preserve the global RLS drift contract for newly introduced carrier tables.
-- The existing restrictive carrier tenant policies remain in place.
CREATE POLICY tenant_wall ON carrier_compliance_holds AS RESTRICTIVE
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY tenant_wall ON carrier_business_submissions AS RESTRICTIVE
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
