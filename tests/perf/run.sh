#!/usr/bin/env bash
# ==============================================================================
# Performance & Concurrency Test Runner
# Bootstraps isolated test database, runs Fastify API, executes load benchmark.
# Usage:
#   bash tests/perf/run.sh
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

export PGPASSWORD="${PGPASSWORD:-pw}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="pii_perf_test"
DB_URL="postgres://${DB_USER}:${PGPASSWORD}@${DB_HOST}:5432/${DB_NAME}"
PORT=3199
TARGET_URL="http://127.0.0.1:${PORT}"

echo "=========================================================="
echo "🚀 Bootstrapping Performance Test Environment"
echo "Target DB: ${DB_NAME} on ${DB_HOST}"
echo "=========================================================="

psql -q -h "$DB_HOST" -U "$DB_USER" -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME}"

(cd "$ROOT" && DATABASE_URL="$DB_URL" node packages/db/src/cli.ts migrate >/dev/null)
(cd "$ROOT" && DATABASE_URL="$DB_URL" node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null)
(cd "$ROOT" && DATABASE_URL="$DB_URL" node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)

psql -q -h "$DB_HOST" -U "$DB_USER" -c "ALTER ROLE app_runtime WITH LOGIN PASSWORD '${PGPASSWORD}' NOBYPASSRLS;" -c "ALTER ROLE app_auth WITH LOGIN PASSWORD '${PGPASSWORD}' BYPASSRLS;" 2>/dev/null || true

echo "📦 Seeding baseline data for load test..."
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)

APP_DATABASE_URL="postgres://app_runtime:${PGPASSWORD}@${DB_HOST}:5432/${DB_NAME}"
AUTH_DATABASE_URL="postgres://app_auth:${PGPASSWORD}@${DB_HOST}:5432/${DB_NAME}"

(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=$PORT LOG_LEVEL=warn DEV_AUTH=true RATE_LIMIT_DISABLED=1 \
  DATABASE_URL="$DB_URL" APP_DATABASE_URL="$APP_DATABASE_URL" AUTH_DATABASE_URL="$AUTH_DATABASE_URL" \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN="$TARGET_URL" \
  exec node apps/api/src/main.ts) &
SRV_PID=$!

cleanup() {
  echo "🧹 Shutting down server (PID: $SRV_PID)..."
  kill "$SRV_PID" 2>/dev/null || true
  wait "$SRV_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "⏳ Waiting for API server to become ready at $TARGET_URL..."
for i in $(seq 1 40); do
  if curl -s "${TARGET_URL}/healthz" | grep -q ok; then
    echo "✅ Server is ready!"
    break
  fi
  sleep 0.5
done

# Seed initial contacts and pipelines
curl -s -X POST "${TARGET_URL}/v1/consent/first-login" -H "x-dev-user-email: sanjeev@uat.test" >/dev/null || true
PIPE_ID=$(curl -s -X POST "${TARGET_URL}/v1/pipelines" -H "x-dev-user-email: sanjeev@uat.test" -H "Content-Type: application/json" -d '{"name":"Life","sharedDown":true,"stages":[{"name":"New"}]}' | grep -o '"id":"[^"]*' | cut -d'"' -f4 || true)
for i in $(seq 1 10); do
  curl -s -X POST "${TARGET_URL}/v1/contacts" -H "x-dev-user-email: sanjeev@uat.test" -H "Content-Type: application/json" -d "{\"fullName\":\"Client $i\",\"email\":\"client$i@example.com\"}" >/dev/null || true
done

echo ""
echo "🔥 Executing Performance & Concurrency Suite..."
if command -v k6 &>/dev/null; then
  echo "Running via k6 CLI..."
  TARGET_URL="$TARGET_URL" TEST_USER="sanjeev@uat.test" k6 run "$HERE/load-test.js"
else
  echo "k6 CLI not found. Running high-throughput Node 22 benchmark runner..."
  TARGET_URL="$TARGET_URL" TEST_USER="sanjeev@uat.test" node "$HERE/benchmark.mjs"
fi

echo "🎉 Performance test suite completed successfully!"
