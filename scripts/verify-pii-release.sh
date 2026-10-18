#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "PII release verification: no deploy, no migrations, no carrier dispatch."
node --version
npm run typecheck
npm run build --workspace @pii/web
npm run test:isolation
npm test
echo "Local static/test gates passed. External approvals and live smoke checks remain mandatory."
