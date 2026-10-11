# Audit notes (2026-10-11)

Web/API work only. **Chrome extension frozen** for store review (`apps/extension` untouched).

## Shipped
- Data residency: `dataCountry` follows `REGION`; staging/prod refuse `DATA_COUNTRY` mismatch
- Intake currency: CAD on ca-qc, USD on us
- Session `last_seen_at` throttled (≤ every 10 minutes)
- Rate-limit maps age out stale keys (no full clear)
- Background sweeps: Postgres advisory lock for multi-instance
- Webhooks: prefer public DNS answers; reject private IP literals
- AI: model id format check; default remains `claude-sonnet-5-5`
- HTTP cross-tenant isolation: `apps/api/test/tenant-isolation.test.ts`
- **DEMO_RESET prod safety:** `DEMO_RESET=true` ignored in prod; use `DEMO_RESET=confirm` for one-shot wipe
- **Privacy notice:** US-authorities sentence only when `stored === 'US'` (no more "Canada" + "US servers" contradiction)

## Still optional polish
- Home page privacy one-liner in `routes-pages.ts` still hardcodes United States; should follow `deps.config.dataCountry`

## Still owner / counsel
- KMS-backed field encryption before real CA client PII
- Vault key rotation + AWS root MFA (see GO_LIVE_CHECKLIST)
- Counsel on AI cross-border and privacy wording
- Montréal region host + custom domain
- Confirm demo vars on Canadian Railway (`SEED_DEMO`, `DEMO_RESET` unset unless intentional)
- Partner usability test; extension update only after Chrome review ends

## Before every push to main
1. `npm test`
2. `npm run test:isolation` (when DB available)
3. `npm run check:freeze`
4. Typecheck clean

Do not edit `apps/extension`. Keep extension endpoints backward-compatible on live hosts.
