#!/bin/bash
# Rebuilds a fresh DB from the real migrations, then runs the SQL-level isolation suite (Python/psycopg2).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
export PGPASSWORD=${PGPASSWORD:-pw}
psql -q -h 127.0.0.1 -U postgres -c 'DROP DATABASE IF EXISTS crm_test' -c 'CREATE DATABASE crm_test'
for f in "$ROOT"/packages/db/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d crm_test -1 -f "$f" >/dev/null
done
psql -q -h 127.0.0.1 -U postgres -c "ALTER ROLE app_runtime LOGIN PASSWORD 'pw'"
python3 "$HERE/test_isolation.py"
