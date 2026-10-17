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
