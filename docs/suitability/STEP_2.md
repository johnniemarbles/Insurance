# Phase 2, step 2: suitability check before submission

Roadmap Phase 2, feature 5 ("PII Product Roadmap vs BlueMind"). The check advises; it never approves. A person
always decides.

## Switches

| Switch | What it does |
| --- | --- |
| `SUITABILITY_ENABLED=1` | Turns the check on. Off: every route answers 404, nothing shows, and a stage that requires a suitability review does not wait for one. |
| `COPILOT_ENABLED=1` plus the company's AI switch | Adds the AI review on top of PII's own rules. Without it, the rules still run and nothing goes to an AI service. |
| **Stage editor → Required paperwork → Suitability review** | Compliance makes a stage (for example "Submitted") wait for a decided check. Offered only while the check is switched on. |
| **Settings → Company rules → "A gap found by the suitability check needs compliance to clear it"** | Off (default): an advisor may proceed past a gap with a written reason. On: every gap goes to compliance. Questions never need compliance. |

Migration `0153_suitability.sql` adds one table, allows the new required-paperwork type, and widens the co-pilot
log's kinds. It changes no existing row.

## How it works

1. **Run the check.** On a deal's **Advice** tab, the advisor runs it. It needs a signed recommendation linked to a
   current signed needs analysis.
2. **PII's rules** always run, on the structured answers:
   - **Gaps:**
     - cover below the uncovered need
     - premium over the client's budget
     - replacement without a signed replacement disclosure
     - an investment or savings element with no risk tolerance
   - **Questions:**
     - a need set by the advisor
     - the client chose less or declined
     - a replacement with a disclosure on file
     - a recommendation with little reasoning
3. **The AI review** runs when it's on for the person. It reads:
   - the needs analysis
   - the recommendation
   - any replacement disclosure
   - up to six matching passages from the company rulebook

   It adds findings, each of which must cite those records. Findings that cite nothing real are dropped. If the AI
   service does not answer, the rules-only result is kept and the screen says so.
4. **The advisor decides:**
   - **Proceed**, with a written reason.
   - **Ask compliance**, with a note.
   - If nothing was found, the check counts straight away.
5. **Compliance** works from **Suitability reviews** on the Compliance page:
   - It **clears** the check or **sends it back**, with a note.
   - The person who ran a check cannot clear it.
   - The same panel lists recent checks where an advisor proceeded past a gap.
6. **The gate:** a stage that requires a suitability review lets the deal in once the current recommendation has a
   check that found nothing, was proceeded, or was cleared. A newer signed recommendation needs a new check.

## What is kept

- **Kept:**
  - the findings (rule or AI, severity, text, cited records)
  - who ran the check and when
  - the advisor's reason
  - compliance's decision and note
- **Rules on changes:** only these moves are allowed:
  - open to proceeded
  - open to referred
  - referred to cleared
  - referred to returned

  Everything else is final, enforced in the database.
- **Who sees it:** checks follow the deal's privacy wall.
- **AI log:** AI use is logged with counts only.

## Evidence

- **Tests:** `apps/api/test/suitability.test.ts` (7). These cover:
  - the rules
  - AI findings kept only with real citations
  - the switch, including the gate standing aside when off
  - no uploads typed as a suitability review
  - editor-only runs
  - the company rule on gaps
  - refer, clear and return
  - a stale check after a new recommendation
  - rules only with the co-pilot off
- **Privacy isolation:** section 3i of `tests/isolation/test_isolation.py` (241/241 with step 1).
- **Full suite:** 846 passed.
- **Browser walkthrough:** `bash tests/uat/suitability/run.sh`. It runs the check, asks compliance, compliance clears
  it, and the deal moves to Submitted (checked in the database).

| Screen | File |
| --- | --- |
| The check's findings on a deal | `screens/1-suitability-findings.png` |
| Compliance's queue | `screens/2-compliance-queue.png` |
| Cleared by compliance | `screens/3-cleared.png` |

## Before switching on

The roadmap's gate for Phase 2: counsel confirms the wording, so that a finding is not read as advice to the client
and the check is not read as an approval.
