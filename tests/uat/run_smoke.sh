#!/usr/bin/env bash
# ==============================================================================
# Playwright End-to-End (E2E) Smoke Gate
# Executes critical user journey walkthroughs in headless mode.
# Default suites: licence, intake (Core Onboarding & Compliance Verification)
# Usage:
#   bash tests/uat/run_smoke.sh [suites...]
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

export PGPASSWORD="${PGPASSWORD:-pw}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_USER="${DB_USER:-postgres}"

if [ "$#" -gt 0 ]; then
  SUITES=("$@")
else
  SUITES=("licence" "intake")
fi

echo "=========================================================="
echo "🚀 Starting Playwright E2E Smoke Gate"
echo "Suites: ${SUITES[*]}"
echo "=========================================================="

# Ensure database roles for runtime and auth can log in
psql -q -h "$DB_HOST" -U "$DB_USER" -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD 'pw' NOBYPASSRLS;
  ELSE
    ALTER ROLE app_runtime WITH LOGIN PASSWORD 'pw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth WITH LOGIN PASSWORD 'pw' NOBYPASSRLS;
  ELSE
    ALTER ROLE app_auth WITH LOGIN PASSWORD 'pw';
  END IF;
END
\$\$;" 2>/dev/null || true

# 1. Prebuild web application assets
echo "🔨 Building web bundle..."
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)

FAILED=0
RESULTS=()

for suite in "${SUITES[@]}"; do
  SUITE_DIR="$HERE/$suite"
  if [ ! -d "$SUITE_DIR" ] || [ ! -f "$SUITE_DIR/run.sh" ]; then
    echo "⚠️  Suite '$suite' not found at $SUITE_DIR"
    RESULTS+=("❌ $suite: NOT_FOUND")
    FAILED=$((FAILED + 1))
    continue
  fi

  echo ""
  echo "▶️  Running E2E Walkthrough: $suite"
  START_TIME=$(date +%s)
  
  if bash "$SUITE_DIR/run.sh"; then
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    echo "✅ Suite '$suite' passed in ${DURATION}s"
    RESULTS+=("✅ $suite: PASSED (${DURATION}s)")
  else
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    echo "❌ Suite '$suite' failed in ${DURATION}s"
    RESULTS+=("❌ $suite: FAILED (${DURATION}s)")
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=========================================================="
echo "📊 Playwright E2E Smoke Gate Summary"
echo "=========================================================="
for res in "${RESULTS[@]}"; do
  echo "$res"
done
echo "=========================================================="

if [ "$FAILED" -ne 0 ]; then
  echo "❌ E2E Smoke Gate FAILED with $FAILED errors."
  exit 1
fi

echo "🎉 All E2E Smoke suites passed successfully!"
exit 0
