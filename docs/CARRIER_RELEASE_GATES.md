# Carrier compliance release gates

Do not enable carrier selling until the following are verified and enforced at every submission endpoint: countersigned company agreement; broker licensing and E&O; carrier-specific contract signature evidence; carrier approval; appointment reference and effective date; product/jurisdiction eligibility; current training; no compliance hold.

Carrier packet preparation and carrier selection may happen during broker onboarding, but neither confers authority to transact. Require independent insurer-specific template approval and verified signing workflow. Do not allow a manual status change to impersonate a carrier signature. Reconcile historical carrier appointments before launch.

Release only after database migration validation, tenant-isolation tests, end-to-end signing tests, authorization gate tests, and legal approval of jurisdiction-specific templates.

## Additional release verification

- Verify the advisory status view uses invoker security and cannot expose another tenant's records.
- Confirm the CI test job actually starts and publishes diagnostics; an empty step list is not a passing run.
- No real carrier business submission may rely solely on preflight or officer-attested hold clearance. Enforce an authoritative hold check within the submission transaction.

## Hold and grant audit acceptance criteria
- A Compliance officer can create a contract-scoped hold, review its history, and release it with a reason. Every action is audited.
- An open hold immediately revokes outstanding product activation grants; release never reinstates them.
- Carrier activation and preflight both check unresolved holds. The invoker-secured product status view also rejects them.
- Automatic revocation must record a machine-readable source and never impersonate the officer who originally activated a product.
- Verify the contract row lock serializes hold creation against activation, and exercise concurrent hold/activation tests against PostgreSQL.
- The actual insurer submission endpoint must perform its own transactional authorization check. Preflight remains advisory.
- CI must pass migration application, tenant RLS, actor provenance, and concurrent lifecycle tests before rollout.

## Submission authorization integration contract
The database now exposes `carrier_product_submission_authorized_locked(contract_id, product_code)`. A business-submission writer must call this function in the **same transaction** as the submission record write and reject a false result before any submission side effect. It must not call preflight and then submit in a later transaction. External carrier dispatch should use a transactional outbox committed with the authorized submission, with worker revalidation immediately before dispatch. A separate integration test must prove that hold creation, expiry, or revocation between request and dispatch prevents dispatch. No live insurer submission endpoint is claimed by this change.

## Internal staging ledger (not insurer dispatch)
Migration 0121 creates `carrier_business_submissions` with tenant RLS, contract scope, product, officer identity, reference and staged-only status. Migration 0122 adds a database insert trigger that checks `carrier_product_submission_authorized_locked` in the same transaction. This is an internal ledger, not an external carrier submission, policy bind, or transactional outbox. No production dispatch may use it without separate carrier integration, worker revalidation, idempotency, authorization and end-to-end tests. The Compliance-only API route is registered at `POST /v1/compliance/carrier-contracts/:id/business-staging`. It requires `productCode` and `externalReference`, and returns staged-only status. No external carrier network call is made.

## Staging integrity acceptance
The internal staging ledger is append-only (migration 0123), requires canonical identifiers (0124), and its POST endpoint accepts only `productCode` and `externalReference`. Verify attempted UPDATE/DELETE is rejected, invalid product or reference is rejected, tenant-crossing reads are denied, and a hold created before staging prevents the insert. Test duplicate external references and confirm they never produce a second staged record. This ledger is not an insurer dispatch queue.

## Duplicate staging reference behavior
The API checks for a previously staged `externalReference` after locking the carrier contract. If it exists, it returns HTTP 409 with `duplicate_external_reference` and creates no additional record. The database unique constraint remains authoritative under concurrent requests. This is duplicate rejection, not replay of the original result; callers must not interpret a 409 as a newly staged record.
