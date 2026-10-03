#!/bin/bash
# End-to-end smoke test: migrate, bootstrap, start the API, call it. Needs Postgres with the two roles and a superuser URL.
set -e
cd "$(dirname "$0")/.."
export PGPASSWORD=pw
DB=pii_smoke
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
psql -q -h 127.0.0.1 -U postgres -c "ALTER ROLE app_runtime LOGIN PASSWORD 'pw'" 2>/dev/null || true
export APP_ENV=dev REGION=ca-qc DEV_AUTH=true PORT=3101 LOG_LEVEL=warn
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/$DB
export APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/$DB
export AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/$DB
npm run -s migrate
node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev
node packages/db/src/cli.ts create-tenant --name "Smoke Co" --country CA --admin-email smoke@example.com >/dev/null
node apps/api/src/main.ts & PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf localhost:3101/healthz >/dev/null && break; sleep 0.3; done
curl -s localhost:3101/readyz; echo
curl -s -H 'x-dev-user-email: smoke@example.com' localhost:3101/v1/me; echo
