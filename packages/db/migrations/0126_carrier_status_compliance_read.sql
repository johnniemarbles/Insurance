-- Never let a non-Compliance reader infer authorization from evidence or
-- holds hidden by their row-level security policies.
DROP POLICY carrier_product_read ON carrier_product_activations;
CREATE POLICY carrier_product_read ON carrier_product_activations
 FOR SELECT USING (app_is_compliance_at_or_above(tenant_id,node_id));
-- The authorization status view is a Compliance diagnostic, not a public
-- permission token. Its invoker-security behavior remains enabled.
