# Phase 3, step 2: file review sampling

Roadmap Phase 3, feature 10 ("PII Product Roadmap vs BlueMind"): random and risk-weighted file samples each month
for each compliance officer, with a checklist, findings and a fix-by date. The existing advice reviews look at one
signed piece of advice; a file review looks at the whole deal.

## Switch

`FILE_REVIEWS_ENABLED=1`. Off: every route answers 404 and nothing shows. Migration `0157_file_reviews.sql` adds one
table, plus narrow read access for the background sweep. It changes no existing row. A new company rule, **Deals
sampled for file review each month, per compliance officer**, defaults to 5; 0 turns the monthly draw off.

## How it works

1. **The sample.** On the 1st (in the background sweep), or when an officer presses **Draw this month's sample**:
   - Each compliance officer gets a sample of the deals they can see. These are deals that are not lost and were
     active in the last 60 days, or had advice signed in the last 90.
   - Excluded: deals already reviewed in the last 12 months, and the officer's own deals.
   - Up to half are the riskiest deals scoring 20 or more; the rest are picked at random. Each deal is sampled once a
     month, across all officers.
   - Compliance can also add a deal by hand ("Added by compliance").
2. **The risk score** (0 to 100) uses facts PII already holds:

   | Factor | Points |
   | --- | --- |
   | An open screening hit | 25 |
   | A replacement | 20 |
   | A deal value or recommended cover of $1M or more | 15 |
   | Large cash | 15 |
   | An advisor added in the last 90 days | 15 |
   | Past findings for the advisor | 15 |
   | No ID record | 10 |
   | No privacy consent | 10 |
   | Flags on signed advice | 10 each, up to 30 |

   The reasons show next to each deal.
3. **The checklist** has 11 items:
   - **PII suggests an answer for eight,** from the file: ID, privacy consent, a current needs analysis, a
     recommendation linked to it, a replacement disclosure, the suitability check, screening, and meeting notes.
   - **The reviewer answers three:** advice explained, documents complete and legible, and appropriate client
     communications.
   - Every item needs an answer. Any "no" means the review records findings with a fix-by date; a clean checklist
     can pass.
4. **The advisor** is notified and sees the findings on the deal's **Files** tab (**Compliance file reviews**). They
   say what they fixed and mark it fixed. The reviewer can't mark their own findings fixed.
5. **The reviewer** checks the fix, then closes the review or reopens it with a new date and what is still missing.
6. **Late fixes:** when the fix-by date passes, the advisor and the reviewer are told once.

The database enforces who does what: only the assigned reviewer decides or closes, and a passed or closed review
can't change.

## Evidence

- **Tests:** `apps/api/test/file-reviews.test.ts` (5). These cover:
  - the risk score and the draw
  - the switch, and officers only
  - each officer sampling only their own branch, drawn once a month
  - checklist suggestions, complete answers, and "no" meaning findings
  - fix, reopen and close
  - late reminders sent once
  - adding a deal by hand, never the officer's own
- **Privacy isolation:** section 3m of `tests/isolation/test_isolation.py` (289/289).
- **Full suite:** 866 passed.
- **Browser walkthrough:** `bash tests/uat/file-reviews/run.sh`:
  1. Compliance draws the sample.
  2. Compliance records findings on the riskiest deal.
  3. The advisor marks them fixed.
  4. Compliance closes the review. The script checks the database: closed.

| Screen | File |
| --- | --- |
| The month's sample, riskiest first | `screens/1-sample.png` |
| The checklist with PII's suggestions | `screens/2-checklist.png` |
| The advisor's fix on the deal | `screens/3-advisor-fix.png` |
