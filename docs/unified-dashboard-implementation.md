# Unified role-aware dashboard — implementation contract

Status: incremental foundation; not production-certified.

## Current connections verified in source
- `GET /v1/home` serves CRM task, risk, renewal, recent-record and saved-view data.
- `GET /v1/dashboard` serves CRM totals, monthly metrics, aging and stage breakdown.
- `GET /v1/onboarding/dashboard` serves self-report, expiry and recheck alerts.
- `GET /v1/nav` derives navigation from layout and limited feature flags.
- Frontend `home.tsx` requests Home, CRM dashboard, newsfeed and pipelines separately.

## Immediate change in this branch
Authenticated users without CRM capability receive an empty, permission-safe Home payload rather than a CRM authorization error. CRM-capable users retain the existing contract. This does **not** grant compliance or other module access.

## Follow-on implementation requirements
1. Resolve effective capabilities on the backend from active tenant, country, org node and role assignments. Never infer access from UI role labels.
2. Return permitted workspace modules and authorized scope options in a typed `/v1/dashboard/context` contract. Enforce chosen scope again in every underlying query.
3. Build independent dashboard widgets with explicit loading, empty, forbidden, partial and error states. Do not turn failed requests into zero metrics.
4. Separate CRM, compliance, onboarding, training, carrier, audit and notifications into authorized aggregation adapters. Do not create a superuser database connection for dashboard aggregation.
5. Route actions through existing specialist workspaces, with server-side record permission checks.
6. Clear cached widgets and in-flight requests on country or organization change.
7. Keep cross-country aggregation limited to approved totals with an explicit authorization and data-minimization review.
8. Do not label internal carrier appointments as live carrier API integrations.

## Release gate
- Positive and negative role tests for admin, manager, trainer, partner, learner, compliance, auditor and staff.
- Multi-role user tests with conflicting org assignments.
- Tenant isolation, sibling-branch isolation, partner-descendant boundaries (five levels), country switch and revoked-access tests.
- RLS tests using actual authenticated request transactions.
- UI-to-API contract tests and drill-down tests.
- Distinct empty, forbidden, unavailable, stale and partial states.
- Canadian/US privacy review and audit-event verification.

No production deployment is authorized by this document.
