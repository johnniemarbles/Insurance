# Canadian tenant data on US infrastructure — release safeguards

Status: **US hosting permitted by project owner; controls and evidence pending verification**.
Decision date: 2026-10-17.

## Deployment identity

- Logical business region: `ca-qc` (Canadian tenant partition, **not** a physical data-centre claim).
- Physical Railway API and PostgreSQL region observed: `sfo` (US).
- Intended recorded host: `HOSTED_IN=us`.
- Do not assert `PHYSICAL_REGION_VERIFIED=true` as evidence of Canadian hosting.
- `RESIDENCY_ACKNOWLEDGED=true` is an operational attestation; set it **only after** the safeguards and disclosures below have been verified and approved. An owner decision alone does not satisfy the safeguards.
- Do not change `REGION=ca-qc` to `us`: this is a tenant/database partition identity and is guarded by `deployment_info`.

## Release gates (required evidence and owner)

- [ ] **Privacy/legal** — Identify applicable federal and provincial privacy rules, sector/customer restrictions, cross-border transfer terms, and any mandatory assessments or notices; obtain qualified counsel/privacy-officer approval where needed.
- [ ] **Transparency** — Update the Canadian privacy notice and customer/processor agreements to accurately disclose US processing, access, subprocessors, and lawful foreign-government access risk. Verify public `POLICY_URL` points to the approved notice.
- [ ] **Vendor terms** — Record Railway and other subprocessor agreements, applicable data-processing terms, subprocessors, data-transfer locations, breach obligations, and onward transfers.
- [ ] **Inventory** — Map customer records, authentication data, evidence vault objects, email, telemetry/logs, backups, and third-party integrations. Confirm `VAULT_S3_REGION` and backup/restore destinations; US hosting approval is not a blanket approval for unspecified countries.
- [ ] **Security** — Verify encryption in transit/at rest, key/secret controls, least-privilege access, MFA, audit logging, tenant/node isolation, and incident-response procedures. Do not weaken RLS.
- [ ] **Retention** — Confirm retention/deletion schedules, backup expiry, data subject request handling, and contractual deletion commitments.
- [ ] **Database** — In **each** deployment, independently verify `0130_carrier_tenant_wall_drift.sql` in `schema_migrations`, both restrictive `tenant_wall` policies, forced RLS, and **zero rows** in `rls_drift`.
- [ ] **Release evidence** — Record reviewer, approval date, screenshots/query outputs, deployment commit, and any exceptions before enabling cross-border acknowledgment or real Canadian customer data.

## Read-only verification SQL

```sql
SELECT version, applied_at, checksum FROM schema_migrations
WHERE version = '0130_carrier_tenant_wall_drift.sql';

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
WHERE c.relname IN ('carrier_compliance_holds','carrier_business_submissions');

SELECT tablename, policyname, permissive, qual, with_check
FROM pg_policies
WHERE tablename IN ('carrier_compliance_holds','carrier_business_submissions')
  AND policyname = 'tenant_wall';

SELECT * FROM rls_drift;
SELECT region, environment, physical_region_verified, hosted_in, residency_acknowledged
FROM deployment_info;
```

Expected: migration 0130 recorded; RLS enabled and forced on both tables; restrictive tenant-wall policy on both; zero drift rows; `region='ca-qc'`, `hosted_in='us'` once configured; no misleading Canadian physical residency claim.

## Safe activation sequence

1. Complete evidence and approvals above.
2. Verify existing Railway variable **values** using an authorized secrets-safe method (connector currently returns names only).
3. Confirm Canadian `HOSTED_IN=us` and `REGION=ca-qc`. Do not overwrite secrets or unrelated settings.
4. Only after sign-off, set `RESIDENCY_ACKNOWLEDGED=true`; perform a controlled release, verify `deployment_info`, privacy page, and API health.
5. Do not migrate infrastructure or alter tenant partitioning as part of this change.

## Current observation

Railway Canada and US development projects report healthy API and PostgreSQL services in `sfo`. Both API startup logs report 45 newly applied migrations and 85 already applied on merge commit `b2607f9`. Logs do not expose individual migration ledger rows. The connected Railway integration cannot execute arbitrary SQL, and variable values are redacted; these checks remain open.
