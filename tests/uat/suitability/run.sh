#!/bin/bash
# Suitability check real-browser walkthrough with stand-in AI providers (AI_FAKE_PROVIDERS, dev only): the advisor runs
# the check, asks compliance, compliance clears it, and the deal can then move to Submitted. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/suitability/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_su
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_su" -c "CREATE DATABASE pii_uat_su"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3102 LOG_LEVEL=warn DEV_AUTH=true SUITABILITY_ENABLED=1 COPILOT_ENABLED=1 AI_FAKE_PROVIDERS=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_su AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_su \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3102 node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3102/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT"; RC=$?; kill $SRV
# The move to Submitted was saved (the gate let it through once compliance cleared the check).
STAGE=$(psql -h 127.0.0.1 -U postgres -d pii_uat_su -Atc "SELECT s.name FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE b.name = 'Singh life review'")
echo "deal stage: $STAGE"; [ "$STAGE" = "Submitted" ] || RC=1
exit $RC
