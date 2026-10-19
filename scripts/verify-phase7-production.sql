-- Phase 7 & 7 Follow-Up: Production Migration & Governance Verification SQL
-- Run separately against Canada and US production databases via read-only admin connection.

-- 1. Verify migrations 0137 and 0138 are applied
SELECT version, checksum, applied_at
FROM schema_migrations
WHERE version LIKE '%0137%'
   OR version LIKE '%0138%'
ORDER BY version;

-- 2. Verify Row-Level Security is ENABLED and FORCED
SELECT
  relname,
  relrowsecurity,
  relforcerowsecurity
FROM pg_class
WHERE relname IN (
  'carrier_certifications',
  'carrier_certification_audit'
)
ORDER BY relname;

-- 3. Verify zero RLS drift across tenant-isolated tables
SELECT * FROM rls_drift
WHERE table_name IN ('carrier_certifications', 'carrier_certification_audit');

-- 4. Find any expired or invalid certification states (must return 0 rows)
SELECT
  tenant_id,
  carrier_id,
  tier,
  tier_expires_on,
  revision
FROM carrier_certifications
WHERE tier IN ('certified', 'live')
  AND (
    tier_expires_on IS NULL
    OR tier_expires_on <= CURRENT_DATE
  );

-- 5. Confirm audit trigger exists and is enabled
SELECT
  tgname,
  tgenabled
FROM pg_trigger
WHERE tgrelid = 'carrier_certifications'::regclass
  AND NOT tgisinternal;
