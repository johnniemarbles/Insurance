-- Preserve tenant isolation for the carrier authorization inspection view.
-- The view is read-only and cannot be used to grant submission permission.
COMMENT ON VIEW carrier_product_authorization_status IS
 'Read-only advisory status. Uses invoker row-level security; not a business submission authorization gate.';
