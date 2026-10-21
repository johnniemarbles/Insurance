#!/bin/bash
# Voice, part 1, in a real browser: speak a question to Ask PII, hear the answer, dictate a note with a task on a deal.
# One Canada server, the stand-in Google and the stand-in AI (no real provider is called), Chrome's fake microphone.
# Screens go to $OUT.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; OUT="${OUT:-$ROOT/docs/voice/screens}"
export PGPASSWORD=pw
psql -q -h 127.0.0.1 -U postgres -c "DROP DATABASE IF EXISTS pii_uat_voice" -c "CREATE DATABASE pii_uat_voice"
DB=postgres://postgres:pw@127.0.0.1:5432/pii_uat_voice
(cd "$ROOT" && DATABASE_URL=$DB node packages/db/src/cli.ts migrate >/dev/null && DATABASE_URL=$DB node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev >/dev/null \
  && DATABASE_URL=$DB node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email sanjeev@uat.test --admin-name Sanjeev >/dev/null)
psql -q -h 127.0.0.1 -U postgres -d pii_uat_voice -c "INSERT INTO tenant_ai (tenant_id, enabled, partners_enabled, provider) SELECT id, true, true, 'gemini' FROM tenants"
(cd "$ROOT" && npm run build --workspace @pii/web >/dev/null)
mkdir -p "$OUT"
(cd "$ROOT" && exec env APP_ENV=dev LOG_LEVEL=warn GOOGLE_FAKE=1 AI_FAKE_PROVIDERS=1 COPILOT_ENABLED=1 VOICE_ENABLED=1 COOKIE_SECRET=0123456789abcdef0123456789abcdef0123456789 \
  LOCAL_KEYS=true LOCAL_KEY_SECRET=0123456789abcdef0123456789abcdef REGION=ca-qc PORT=3111 APP_ORIGIN=http://127.0.0.1:3111 DATABASE_URL=$DB \
  APP_DATABASE_URL=postgres://app_runtime:pw@127.0.0.1:5432/pii_uat_voice AUTH_DATABASE_URL=postgres://app_auth:pw@127.0.0.1:5432/pii_uat_voice node apps/api/src/main.ts) &
SRV=$!
for i in $(seq 1 40); do curl -s http://127.0.0.1:3111/healthz | grep -q ok && break; sleep 1; done
set +e; python3 "$HERE/walkthrough.py" "$OUT"; RC=$?; kill $SRV
CHECK=$(psql -h 127.0.0.1 -U postgres -d pii_uat_voice -Atc "SELECT (SELECT count(*) FROM notes WHERE body LIKE 'Called Raj Singh%') || '|' || (SELECT count(*) FROM tasks WHERE title = 'Send Raj the term 20 quote') || '|' || (SELECT count(*) FROM copilot_log WHERE kind = 'voice') || '|' || (SELECT count(*) FROM copilot_log WHERE kind = 'voice_note')")
echo "dictated note saved | task saved | voice log lines | note drafts: $CHECK"; [ "$CHECK" = "1|1|4|1" ] || RC=1
exit $RC
