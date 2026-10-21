#!/bin/bash
# Electronic ID real-browser check with stand-in providers (AI_FAKE_PROVIDERS and STRIPE_IDENTITY_FAKE, dev only):
# the company setting, PII's own check with photos, a Stripe Identity link, and a compliance decision. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/eid/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_eid
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_eid" -c "CREATE DATABASE pii_uat_eid"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"; PHOTOS="$(mktemp -d)"; python3 "$HERE/make-photos.py" "$PHOTOS"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3101 LOG_LEVEL=warn DEV_AUTH=true EID_ENABLED=1 STRIPE_IDENTITY_FAKE=1 AI_FAKE_PROVIDERS=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_eid AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_eid \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3101 node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3101/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT" "$PHOTOS"; RC=$?; kill $SRV; exit $RC
