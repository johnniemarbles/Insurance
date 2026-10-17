# Carrier connectivity: iA first, other carriers later

## Delivery status (2026-10-17)
- Internal broker onboarding, carrier contract case, review, evidence, authorization checks, holds, product activation and business staging: implemented.
- Carrier network integration (iA Financial Group / Industrial Alliance): **NOT CONNECTED**. No API credentials, contractual permission, certified endpoint, production carrier acknowledgement, or appointment sync has been verified.
- Never interpret an internally recorded carrier contract or product activation as insurer approval. Business staging is internal only.

## End-to-end integration acceptance criteria
1. Obtain iA's written authorized integration channel and technical documentation (API, portal, secure file exchange, or approved manual route), supported products and jurisdictions, sandbox/test access, security/PII terms, and named carrier integration contact.
2. Maintain a carrier profile keyed by verified legal carrier ID, supported lines/products/jurisdictions, onboarding templates, mandatory evidence and versioned requirements. No arbitrary carrier string can be treated as a verified connection.
3. Implement a carrier-specific outbound adapter behind a stable interface: validate broker eligibility and consent, produce a canonical payload, encrypt sensitive material, idempotent submission, store redacted request metadata and external reference, record carrier acknowledgment. Block external send unless credentials, carrier approval, and destination are configured.
4. Implement inbound signed/polled status reconciliation: reject unauthenticated callbacks, replay and duplicate events; keep immutable carrier evidence, timestamps, appointment dates and product-specific authority.
5. Reconcile exceptions, rejections, corrections, renewals and revocations; no positive selling authorization without independently verified carrier appointment plus internal licence/E&O/jurisdiction/product checks.
6. Test end-to-end in the carrier-authorized sandbox including failure, retry, revoked appointment, cross-tenant access, duplicate callbacks, expired licences and disaster recovery.
7. Obtain carrier/UAT approval, privacy/legal sign-off, production credentials, operational runbooks and rollback, then enable per tenant/carrier by explicit feature gate.

## Integration channel truthfulness
An insurer portal operated by a human is not an API integration. A CSV exported for manual upload is not automatic submission. A manually recorded approval is not a live carrier status sync. Display each mode separately in the product.

## Owner dependencies
Carrier-authorized technical access and contractual terms cannot be generated from source code. Without them, no system can truthfully claim a production iA integration.
