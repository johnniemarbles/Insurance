#!/bin/bash
# Client intake real-browser walkthrough: the advisor sends a link, the client fills it in on a phone-sized screen,
# uploads a document, gives consent and submits with the code; the advisor reviews and applies it. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/intake/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_in
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_in" -c "CREATE DATABASE pii_uat_in"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"; FILES="$(mktemp -d)"; printf '%%PDF-1.4\n%% sample policy statement for the walkthrough\n' > "$FILES/policy-statement.pdf"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3103 LOG_LEVEL=warn DEV_AUTH=true INTAKE_ENABLED=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_in AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_in \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3103 exec node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3103/healthz | grep -q ok && break; sleep 1; done
node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT" "$FILES"; RC=$?; kill $SRV
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_in -Atc "SELECT (SELECT status FROM client_intakes) || '|' || (SELECT count(*) FROM client_consents) || '|' || (SELECT date_of_birth FROM contacts LIMIT 1) || '|' || (SELECT count(*) FROM advice_records WHERE status = 'draft')")
echo "intake|consents|dob|drafts: $CHECK"; [ "$CHECK" = "applied|2|1980-04-12|1" ] || RC=1
exit $RC
