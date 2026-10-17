-- Restrict status-view access to authenticated application sessions.
REVOKE ALL ON carrier_product_authorization_status FROM PUBLIC;
GRANT SELECT ON carrier_product_authorization_status TO app_runtime;
