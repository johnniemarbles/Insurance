# Phase 3, step 3: conduct risk flags and a complaints log

Roadmap Phase 3, feature 11 ("PII Product Roadmap vs BlueMind"): explainable flags for replacement churn, early
lapses, many policies on one client, premium out of line with income, complaints, and missing reviews. Rules first;
a model only once there is data to train it.

## Switch

`CONDUCT_FLAGS_ENABLED=1`. Off: every route, including the complaints log, answers 404 and nothing shows. Migration
`0158_conduct_flags.sql` adds two tables and changes no existing row.

## The rules

Flags are worked out each time compliance opens them, under the viewer's own access, so a branch officer sees their
branch only. Nothing is scored in the background or shown to the person flagged.

| Flag | About | Raised when | High when |
| --- | --- | --- | --- |
| Replacement churn | Advisor | 3 or more of their signed recommendations in 12 months replaced cover, and that is at least 30% of them | 50% or more |
| Early lapses | Advisor | 2 or more policies lapsed, cancelled or surrendered within 24 months of starting (counted over the last 12 months), at least 10% of policies issued in 36 months | 20% or more |
| Many policies | Client | Owner or insured on 3 or more policies that started in 24 months | 5 or more |
| Premium high for income | Deal | The signed recommendation's annual premium is over 15% of household income on the needs analysis | over 25% |
| Complaints | Advisor | 2 or more complaints in 12 months | 4 or more |
| Complaint not resolved | Advisor | Any complaint open more than 30 days | Always high |
| No recent review | Client | Owns a policy more than a year old, with no signed needs analysis in 24 months | Always low |

Each flag shows the numbers behind it, for example "3 of 4 recommendations in the last 12 months replaced existing
cover (75%)".

## Deciding

Compliance writes a note of at least 10 characters and records **No concern** or **Action taken**. The flag goes
quiet until its numbers change, then opens again with the last decision shown. Decisions are visible only to
compliance and tenant admins. A partner can never clear a flag about themselves (enforced in the database).

## Complaints

The deal's **Files** tab has a **Complaints** log:
- **Who records:** the advisor or compliance.
- **What is recorded:** date received, how it came in (including from the regulator or the insurer), what it is
  about, and what the client says.
- **Resolving:** only compliance resolves a complaint, with an outcome. A resolved complaint can't change.

Complaints feed the two complaint flags.

## Evidence

- **Tests:** `apps/api/test/conduct.test.ts` (4). These cover:
  - thresholds, severities and fingerprints
  - the switch, and compliance only
  - each branch officer seeing only their branch
  - complaints recorded and resolved, and raising flags
  - stale numbers refused
  - decisions quieting a flag until its numbers change
- **Privacy isolation:** section 3n of `tests/isolation/test_isolation.py` (302/302).
- **Full suite:** 870 passed.
- **Browser walkthrough:** `bash tests/uat/conduct/run.sh`:
  1. Four flags show with their reasons.
  2. One is decided and goes quiet.
  3. A complaint is logged and resolved. The script checks the database.

| Screen | File |
| --- | --- |
| The flags, with the numbers behind each | `screens/1-flags.png` |
| A complaint on a deal | `screens/2-complaint.png` |

## Later

The thresholds are in one place (`apps/api/src/conduct.ts`, `RULES`) and could become company settings. A trained
model is for when a year of decided flags and outcomes exists. Even then, a flag will always show its reason.
