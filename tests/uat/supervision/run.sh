#!/bin/bash
# Supervision rules real-browser walkthrough: compliance writes a rule; the advisor's move is blocked, they file the
# paperwork and ask for a review; compliance approves; the deal moves. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/supervision/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_sv
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_sv" -c "CREATE DATABASE pii_uat_sv"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3104 LOG_LEVEL=warn DEV_AUTH=true SUPERVISION_ENABLED=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_sv AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_sv \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3104 exec node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3104/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT"; RC=$?; kill $SRV
STAGE=$(psql -h 127.0.0.1 -U postgres -d pii_uat_sv -Atc "SELECT s.name || '|' || (SELECT status FROM supervision_reviews) FROM boxes b JOIN stages s ON s.id = b.stage_id")
echo "stage|review: $STAGE"; [ "$STAGE" = "Submitted|approved" ] || RC=1
exit $RC
