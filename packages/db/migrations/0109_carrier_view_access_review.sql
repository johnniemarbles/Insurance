-- Prevent accidental writes through the advisory carrier status view.
REVOKE ALL ON carrier_product_authorization_status FROM PUBLIC;
GRANT SELECT ON carrier_product_authorization_status TO app_runtime;
