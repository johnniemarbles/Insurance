#!/bin/bash
# Gates A, B and C real-browser acceptance for families: fresh local database, server with FAMILIES_ENABLED=1, demo data,
# the walkthrough (English and fr-CA), then the same server with the switch off. Screenshots go to $OUT.
# Needs: Postgres 16 on 127.0.0.1 with postgres/pw and the roles from infra/init-roles.sql; Python Playwright + Chromium.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/families/gate-a-screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat
serve() {
  (cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3100 LOG_LEVEL=warn DEV_AUTH=true FAMILIES_ENABLED="$1" FAMILIES_INSURANCE_ENABLED="$1" FAMILIES_COMPLIANCE_ENABLED="$1" DATABASE_URL=$DB \
    APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat \
    LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3100 node apps/api/src/main.ts) &
  SRV=$!
  for i in $(seq 1 40); do curl -s http://127.0.0.1:3100/healthz | grep -q ok && return; sleep 1; done
  echo "server did not start"; exit 1
}
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat" -c "CREATE DATABASE pii_uat"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
serve 1; node "$HERE/seed.mjs"; DATABASE_URL=$DB node "$HERE/seed-insurance.mjs" && DATABASE_URL=$DB node "$HERE/seed-compliance.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT" && mkdir -p "${OUT_B:=$ROOT/docs/families/gate-b-screens}" && python3 "$HERE/walkthrough-insurance.py" "$OUT_B" && mkdir -p "${OUT_C:=$ROOT/docs/families/gate-c-screens}" && python3 "$HERE/walkthrough-compliance.py" "$OUT_C"; RC=$?; kill $SRV; sleep 1; set -e
[ $RC -ne 0 ] && exit $RC
serve 0; set +e; python3 "$HERE/switched_off.py" "$OUT"; RC=$?; kill $SRV
exit $RC
