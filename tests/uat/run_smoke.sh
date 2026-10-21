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

SUITES=("${@:-licence intake}")

echo "=========================================================="
echo "🚀 Starting Playwright E2E Smoke Gate"
echo "Suites: ${SUITES[*]}"
echo "=========================================================="

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
