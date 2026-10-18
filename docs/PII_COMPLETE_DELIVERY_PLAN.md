# PII — Consolidated delivery program (October 2026)
Status: engineering work plan, **not** a certification of carrier connectivity or production readiness.

## Verified baseline
Partner Directory V2, Partner Profile 360, carrier contracting dashboard, embedded contracting actions, compliance evidence and tenant/branch access controls are present. Existing go-live and carrier release gates remain applicable. The iA integration acceptance document explicitly records **NOT CONNECTED**. The internal business-staging ledger is not an insurer dispatch service.

## Package A — Identity, scope, dashboards and user journeys
- Server-resolved role/country/tenant/branch context, including multi-role and delegated roles.
- Unified dashboard endpoint with typed, permission-scoped cards for admin, compliance, HO, branch, broker, learner, trainer and auditor.
- Distinguish loading, empty, forbidden, stale and partial states. Invalidate data when scope changes.
- Link cards to authorized Partner 360, LMS, CRM, vault, compliance, carrier cases and notifications.
- Test sibling branch, tenant, five-level descendants, revoked role, HO and US/CA boundaries.
- Acceptance: no client-side role label grants access; every drill-down is server authorized.

## Package B — Carrier contract lifecycle and eligibility
- One canonical carrier contract state machine and case ownership; no parallel status writer.
- Requirements, signed templates, signer provenance, real document digests, consent, review, dispatch, response and appointment expiry.
- Explicit distinction between requested, submitted, acknowledged, approved, verified and currently eligible.
- Transactional product/jurisdiction/hold/CE/licence/E&O check at every business submission.
- Outbox and worker revalidation before external dispatch; idempotent retry and dead-letter queue.
- Acceptance: no positive selling status without independently verified appointment and all live eligibility gates.

## Package C — External carrier connectivity (iA first)
- Obtain carrier's written permission, sandbox, API/file/portal documentation, destination, identity and legal agreements.
- Carrier profile: verified carrier ID, channel, permitted operations, products, jurisdictions, template versions, per-tenant enablement.
- Adapter interface and registry must fail closed if missing/unverified. No default to another carrier, tenant or platform credential.
- Canonical payload, encryption, outbound idempotency, signed/polled inbound reconciliation, replay prevention, audit evidence.
- Carrier-authorized sandbox certification: positive, duplicate, timeout, revoked, hold, expiry, tenant isolation and retry.
- Other carriers: Manulife, Sun Life and Canada Life only after each separately approves an integration method.
- Acceptance: carrier-issued acknowledgment and independent appointment evidence; never claim live integration based on email export.

## Package D — Operational security, privacy and infrastructure
- Reconcile Railway environment name, APP_ENV, region, HOSTED_IN, readiness payload and deployment policies.
- Verify migrations and RLS in each database; audit actual hosting location, backups, restore, vault, KMS and key rotation.
- Canadian US-hosting disclosures and contractual safeguards; no unsupported physical residency claim.
- Rotate any exposed AWS vault keys; MFA, least-privilege IAM, audit, retention, incident response, data deletion.
- Verify signed document storage actually stores the bytes whose digest is recorded; hash alone is not a vault upload.
- Acceptance: restore drill, negative auth tests, privacy/legal approval and documented deployment evidence.

## Package E — Production release and operational acceptance
- Run scripts/verify-pii-release.sh on exact release commit; retain logs and test count.
- Browser E2E for every role, every 360 tab, branch changes, signing consent, vault retrieval, carrier workflow.
- Carrier sandbox integration only when approved. Test no-op when connection disabled or credentials absent.
- Canary/rollback, health/readiness, tracing, alerts, audit export, on-call runbook, documented owner signoff.
- No destructive infrastructure changes without explicit approval.
- Acceptance: independently captured build, isolation, functional, security, carrier and infrastructure results.

## Delivery sequencing and dependencies
A + B can proceed in parallel; D starts immediately; C adapter contracts can be built but **live activation depends on carrier access**. E only after A-D gates are satisfied. Work should be integrated in large PRs by package, not isolated UI fragments.

## External dependencies that code cannot supply
Carrier-authorized credentials and endpoints, insurer legal/technical approval, privacy counsel approval, physical hosting evidence, vault key rotation by credential owner, and actual end-to-end sandbox responses.

## Scope of this change
Adds a fail-closed carrier transport contract and unit tests, plus one non-destructive verification script. **It does not create or activate a real iA/Manulife/Sun Life/Canada Life network integration.** Existing production endpoints are unchanged.
