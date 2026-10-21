# Phase 3, step 4: network evidence packs

Roadmap Phase 3, feature 13 ("PII Product Roadmap vs BlueMind"): one export for a partner, a carrier, or a
regulator's request, with a fingerprint anyone can check with PII later.

## Switch

`EVIDENCE_PACKS_ENABLED=1`. Off: every route answers 404 and the panel does not show. Migration
`0159_evidence_packs.sql` adds one table and changes no existing row.

## Who

Compliance officers and tenant admins only. Each pack is built under the exporter's own access, so a branch officer
can only export partners, policies and deals in their branch.

## What is in a pack

The **Evidence packs** panel on the Compliance page makes one ZIP:

| Folder | Contents |
| --- | --- |
| `README.txt` | Scope, period, request reference, who made it and when, and the fingerprint |
| `registers/` | CSVs for the period: complaints, file reviews, licence checks, supervision reviews, suitability checks, ID checks, conduct decisions |
| `partners/` | Each partner's compliance file |
| `deals/` | Each client file, as the existing full audit package with its documents |
| `manifest.json` | Every file with its SHA-256 |

The scope decides which deals go in:
- **A partner:** every deal the partner owns.
- **A carrier:** every deal whose client owns or is insured on that carrier's policies.
- **A regulator request:** the request reference is required. The client files are chosen by deal name, one per
  line, as shown in PII. Each name must match exactly one deal the exporter can see, or the pack is refused and the
  name is shown.

Limits: 150 deals and 45 MB per pack.

## Checking a pack

The fingerprint is the SHA-256 of `manifest.json`. PII records every pack it issued:
- scope
- period
- counts
- fingerprint
- who made it, and when

The record can't be changed or deleted. Anyone holding a pack can paste the fingerprint into **Check a pack**:
- PII either confirms who issued it and when,
- or says it did not issue a pack with that fingerprint.

Every file can be checked against the manifest.

## Evidence

- **Tests:** `apps/api/test/evidence-packs.test.ts` (4). These cover:
  - the switch, and compliance only
  - a partner pack: registers, partner file, client files with documents, a manifest that checks out, the record,
    and no deleting
  - another branch refused
  - a carrier pack following the carrier's policies
  - a regulator pack needing its reference
  - deals chosen by ID or name, and a deal outside the exporter's access refused
- **Privacy isolation:** section 3o of `tests/isolation/test_isolation.py` (307/307).
- **Full suite:** 874 passed.
- **Browser walkthrough:** `bash tests/uat/evidence-packs/run.sh`:
  1. Compliance downloads a partner pack, and the script opens the ZIP and checks every hash.
  2. PII confirms the fingerprint and rejects a made-up one.
  3. A regulator pack refuses an unknown deal name, then succeeds with two deals.
  4. The script checks the database.

| Screen | File |
| --- | --- |
| A partner pack, checked with PII | `screens/1-partner-pack.png` |
| A regulator pack naming two deals | `screens/2-regulator-pack.png` |
