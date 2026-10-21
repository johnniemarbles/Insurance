#!/bin/bash
# Evidence packs real-browser walkthrough: compliance downloads a partner pack, checks its fingerprint with PII, then
# makes a regulator pack naming two deals. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/evidence-packs/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_ep
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_ep" -c "CREATE DATABASE pii_uat_ep"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3108 LOG_LEVEL=warn DEV_AUTH=true CONDUCT_FLAGS_ENABLED=1 EVIDENCE_PACKS_ENABLED=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_ep AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_ep \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3108 exec node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3108/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT"; RC=$?; kill $SRV
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_ep -Atc "SELECT string_agg(scope || ':' || deal_count, ',' ORDER BY created_at) FROM evidence_packs")
echo "packs: $CHECK"; [ "$CHECK" = "partner:2,regulator:2" ] || RC=1
exit $RC
