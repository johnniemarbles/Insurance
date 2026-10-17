-- Migration 0092 already replaced the original unique constraint with a
-- partial unique index. Do not attempt to drop that constraint again:
-- PostgreSQL raises 42704 and aborts the entire migration chain.
-- Preserve the existing uniqueness guarantee while moving to the
-- tenant-qualified live-grant index used by current schema tests.
CREATE UNIQUE INDEX carrier_product_one_live_grant_idx
 ON carrier_product_activations(tenant_id,contract_id,product_code)
 WHERE revoked_at IS NULL;
DROP INDEX IF EXISTS carrier_product_one_live_grant;
