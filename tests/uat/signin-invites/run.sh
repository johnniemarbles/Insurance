#!/bin/bash
# Sign-in across two country servers, and the two ways in after an invitation. Real browser, two servers with their own
# databases (Canada on 127.0.0.1:3109, United States on localhost:3110), and the development stand-in for Google.
# Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/signin-invites/screens}"
export PGPASSWORD=pw
STORE=https://chromewebstore.google.com/detail/bbfccaiemeckdhajpejacckieamdbajm
TOKEN=uat-invite-token-signin-invites-000000001
for c in ca us; do psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_si_$c" -c "CREATE DATABASE pii_uat_si_$c"; done
CADB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_si_ca; USDB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_si_us
(cd "$ROOT" && DATABASE_URL=$CADB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$CADB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$CADB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
(cd "$ROOT" && DATABASE_URL=$USDB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$USDB node packages/db/src/cli.ts bootstrap-deployment --region us --environment dev >/dev/null \
  && DATABASE_URL=$USDB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Broker Inc" --country US --admin-email jordan@uat.test --admin-name Jordan >/dev/null)
# A partner invitation on the Canada server, with a known link.
HASH=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)
psql -q -h 127.0.0.1 -U postgres -d pii_uat_si_ca -c "INSERT INTO invitations (tenant_id,email,node_id,role,token_hash,expires_at,invited_by)
  SELECT t.id, 'navdeep@uat.test', n.id, 'partner', decode('$HASH','hex'), now() + interval '7 days', u.id FROM tenants t JOIN org_nodes n ON n.tenant_id = t.id AND n.parent_id IS NULL JOIN app_users u ON u.tenant_id = t.id LIMIT 1" 2>/dev/null \
  || psql -q -h 127.0.0.1 -U postgres -d pii_uat_si_ca -c "INSERT INTO invitations (tenant_id,email,node_id,role,token_hash,expires_at,invited_by)
  SELECT t.id, 'navdeep@uat.test', (SELECT id FROM org_nodes WHERE tenant_id = t.id ORDER BY created_at LIMIT 1), 'partner', decode('$HASH','hex'), now() + interval '7 days', (SELECT id FROM app_users WHERE tenant_id = t.id LIMIT 1) FROM tenants t LIMIT 1"
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
common="APP_ENV=dev LOG_LEVEL=warn GOOGLE_FAKE=1 COOKIE_SECRET=0123456789abcdef0123456789abcdef0123456789 LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef PII_EXTENSION_URL=$STORE PII_ORIGIN_CA=http://127.0.0.1:3109 PII_ORIGIN_US=http://localhost:3110"
(cd "$ROOT" && exec env $common REGION=ca-qc PORT=3109 APP_ORIGIN=http://127.0.0.1:3109 DATABASE_URL=$CADB APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_si_ca AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_si_ca node apps/api/src/main.ts) &
CA=$!
(cd "$ROOT" && exec env $common REGION=us PORT=3110 APP_ORIGIN=http://localhost:3110 DATABASE_URL=$USDB APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_si_us AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_si_us node apps/api/src/main.ts) &
US=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3109/healthz | grep -q ok && curl -s http://localhost:3110/healthz | grep -q ok && break; sleep 1; done
set +e; python3 "$HERE/walkthrough.py" "$OUT" "$TOKEN"; RC=$?; kill $CA $US
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_si_ca -Atc "SELECT (SELECT count(*) FROM invitations WHERE accepted_at IS NOT NULL) || '|' || (SELECT count(*) FROM app_users WHERE email = 'jordan@uat.test')")
CHECK="$CHECK|$(psql -h 127.0.0.1 -U postgres -d pii_uat_si_us -Atc "SELECT count(*) FROM app_users WHERE email = 'jordan@uat.test' AND last_login_at IS NOT NULL")"
echo "invite accepted in CA | Jordan in CA | Jordan signed in to US: $CHECK"; [ "$CHECK" = "1|0|1" ] || RC=1
exit $RC
