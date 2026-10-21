#!/bin/bash
# Licence check real-browser walkthrough with a stand-in Gemini (AI_FAKE_PROVIDERS, dev only): compliance uploads a
# saved register page, PII reads and compares it, compliance records the check. Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/licence-checks/screens}"
export PGPASSWORD=pw
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_lc
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_lc" -c "CREATE DATABASE pii_uat_lc"
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
psql -q -h 127.0.0.1 -U postgres -c "ALTER ROLE app_runtime WITH LOGIN PASSWORD 'pw'; ALTER ROLE app_auth WITH LOGIN PASSWORD 'pw';" 2>/dev/null || true
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"; FILES="$(mktemp -d)"
python3 -c "
from PIL import Image, ImageDraw
im = Image.new('RGB', (900, 360), 'white'); d = ImageDraw.Draw(im)
d.text((20, 20), 'SAMPLE REGISTER RESULT - TEST IMAGE FOR THE PII WALKTHROUGH', fill='black')
for i, l in enumerate(['Name: SANDHU, HARPREET KAUR', 'Licence: 12345-M', 'Class: Life and accident and sickness', 'Status: Active', 'Expiry: 2027-03-31']): d.text((20, 80 + i * 40), l, fill='black')
im.save('$FILES/register.png')"
(cd "$ROOT" && APP_ENV=dev REGION=ca-qc PORT=3105 LOG_LEVEL=warn DEV_AUTH=true LICENCE_CHECKS_ENABLED=1 AI_FAKE_PROVIDERS=1 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_lc AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_lc \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:3105 exec node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3105/healthz | grep -q ok && break; sleep 1; done
DATABASE_URL=$DB node "$HERE/seed.mjs"
set +e; python3 "$HERE/walkthrough.py" "$OUT" "$FILES"; RC=$?; kill $SRV
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_lc -Atc "SELECT status || '|' || name_matches || '|' || number_matches || '|' || (evidence_id IS NOT NULL) FROM licence_checks")
echo "status|name|number|evidence: $CHECK"; [ "$CHECK" = "active|true|true|true" ] || RC=1
exit $RC
