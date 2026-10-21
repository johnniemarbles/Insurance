#!/bin/bash
# File review real-browser walkthrough: compliance draws the month's sample, records findings on the riskiest deal; the
# advisor marks them fixed; compliance closes the review. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/file-reviews/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_fr
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_fr" -c "CREATE DATABASE pii_uat_fr"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3106 LOG_LEVEL=warn DEV_AUTH=true FILE_REVIEWS_ENABLED=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_fr AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_fr \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3106 exec node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3106/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT"; RC=$?; kill $SRV
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_fr -Atc "SELECT b.name || '|' || f.status FROM file_reviews f JOIN boxes b ON b.id = f.box_id WHERE f.status <> 'open'")
echo "reviewed: $CHECK"; [ "$CHECK" = "Singh life review|closed" ] || RC=1
exit $RC
