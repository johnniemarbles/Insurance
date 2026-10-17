# Unified broker onboarding and carrier contracting — implementation contract

Status: implementation initiated; **not production-ready**. The carrier authorization policy in packages/domain/src/carrier-contracting.ts is a pure rule module only. It is NOT yet connected to API submission gates.

## Desired flow
1. Compliance initiates case; broker verifies profile and uploads required records.
2. Compliance validates licence, E&O, ownership, identity, consents, jurisdiction and required screening.
3. Broker signs the company agency agreement; authorized Compliance Manager countersigns; store immutable signed version and evidence.
4. Broker chooses one or more carriers *within the same onboarding case*. Create a carrier subcase for each selected carrier. Carrier-specific requirements and templates are versioned.
5. Broker signs each carrier packet through a supported verified signature flow. Capture evidence separately from the company agreement.
6. Compliance reviews and submits packets. Carrier review, correction requests, approval and verified appointment are recorded separately.
7. Broker-level clearance and carrier-specific authorization are separate. Only verified active carrier appointments permit carrier business, subject to valid licence, E&O, jurisdiction, products, training and no compliance hold.

## Required next changes
- Migration: carrier_contract_cases (tenant_id, onboarding_case_id, node_id, carrier_id, jurisdiction, state, template_revision_id, created_by, timestamps), append-only state events, evidence refs, carrier appointment effective/expiry dates and products.
- Carrier catalog + jurisdiction-aware template/requirements registry. Do not accept an arbitrary carrier string as proof of a real appointment.
- APIs: list/select carriers, packet preparation, broker signature, compliance submission, carrier outcome, appointment verification, suspension; each transition role-checked and audited.
- UI: a Carriers step in the broker onboarding wizard and a Compliance Department queue with filters, outstanding actions and per-carrier status.
- Reconcile legacy compliance_profiles.agreement_status with onboarding_agreements; do not allow manual signed flag to bypass verified agreement evidence.
- Integrate carrierAuthorizationBlocks with every business-submission endpoint, in the same transaction as the submission; fail closed when data is missing.
- Tests: cross-tenant and branch isolation, forged signatures, replay, expired licences, revoked appointments, suspended brokers, wrong jurisdictions, concurrent transitions, unverified carriers, incomplete evidence.
- Counsel approval: electronic signature standards, insurer-specific contracts, privacy and retention, and regional licensing rules.
- Operational gates: deployment migration, production data reconciliation, staging end-to-end verification and rollback plan.

## Existing code to integrate
- apps/api/src/routes-onboarding.ts: carrier-packets endpoint currently requires active broker; retain this restriction until replacement workflows and submission gates are wired.
- apps/api/src/routes-onboarding-sign.ts: two-party company agreement signing and evidence.
- apps/api/src/routes-compliance.ts: legacy manually recorded agreement status and separate carrier appointments.
- apps/web/src/onboarding-partner.tsx, apps/web/src/compliance.tsx: user-facing steps and compliance workspace.
- packages/db/migrations/0083_agreement_template.sql and 0085_agreement_vault.sql: template revision and vault foundations.

## Compliance Department information architecture
Overview; Onboarding; Broker Registry; Agreements; Carrier Contracting; Verification; Training; Renewals; Evidence Vault; Administration.
All views must use existing regional/tenant isolation and least-privilege roles. Branch managers see progress, not confidential checks.
