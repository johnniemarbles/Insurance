# Packages C+D+E — implementation and release acceptance
Status: partial engineering implementation; carrier integrations remain disabled.

## C — carrier connectivity
- Added HMAC SHA-256 inbound authenticity verification with timestamp bound to event ID and raw body.
- Added durable unique carrier event receipt ledger with tenant RLS and quarantine state.
- Added explicit external dispatch environment policy with sandbox/production approvals.
- Existing adapter registry still requires an actual insurer-authorized transport implementation.
- Before enabling: carrier's signed integration agreement, verified endpoint, supported payload, credentials, sandbox certification, idempotency, retries, actual receipt and status reconciliation.
- **Never treat a signed event alone as an appointment**. Reconcile independently with carrier and enforce all eligibility gates.
- Receipt ledger migration is not a public callback endpoint; callbacks require approved carrier-specific signature protocol, authentication and routing.

## D — privacy and infrastructure
- Verify APP_ENV and Railway environment separately; readiness labels are not hosting evidence.
- Verify HOSTED_IN, backup region, vault bucket, KMS, retention, logs, audit access and disaster recovery.
- For Canadian tenants using US hosting, publish approved cross-border notices; do not claim Canadian physical residency.
- Rotate previously exposed AWS vault credentials. Do not commit credentials to repository.
- Re-run migration/RLS drift and restore a backup in an isolated environment.
- Confirm external dispatch remains OFF until carrier technical and legal sign-off.

## E — production acceptance
- Run bash scripts/verify-pii-release.sh against the exact candidate commit.
- Test roles: admin, HO, compliance, manager, broker, trainer, learner, auditor and staff.
- Test tenant/branch isolation, revoked access, evidence hashes, consent, vault bytes, expiry, holds, idempotency, retries and reconciliation.
- Verify health, readiness, metrics, alerting, runbooks, rollback and signed release record.
- Run carrier-specific sandbox E2E only after carrier grants access.
- No production carrier integration or dispatch is claimed by this change.

## Follow-on code not included in this PR
Carrier-specific approved outbound adapter, per-carrier webhook endpoint and payload schema, database-backed worker with row leasing and transactional revalidation, authenticated carrier reconciliation, operational console, monitoring and external UAT. These depend on verified carrier specifications and operational review.
