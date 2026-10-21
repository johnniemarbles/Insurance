# US annuity training gate, and the yearly security course

Step 1 of the US compliance plan ("PII US compliance plan: California and Texas"), and the staff training gap from the
SOC 2 readiness doc (gap 10).

## Annuity training (switch: `ANNUITY_GATE_ENABLED=1`)

California and Texas require annuity training before a producer sells annuities:

| State | Before selling annuities | After that | Source |
| --- | --- | --- | --- |
| California | 8 hours of approved annuity training (the updated course with best-interest content, from 2025) | 4 hours before each licence renewal; the first 8 never count toward the 4 | Insurance Code §1749.8, SB 263 |
| Texas | A one-time 4-hour course | 8 hours of annuity CE each two-year term (28 TAC §19.1029; confirm with TDI) | TDI |

Migration `0160_annuity_training.sql` does three things:
- adds the CE category **Annuity training**
- adds an `annuity` rule to the two US rule packs (`ca_doi`, `tx_tdi`)
- adds `annuity_training_for(user)`: a lookup that returns one advisor's annuity hours (dates and hours only), within one company

It changes no other row.

- **Logging:** advisors log annuity courses under **Training, CE**, with the category "Annuity training". The hours also count toward their CE total.
- **The CE page:** each US licence shows "Before selling annuities: X of 8 hours". Once that is done and a new term has begun, it also shows the term's renewal hours.
- **The gate:** with the switch on, a deal whose latest needs analysis is for an annuity cannot move into a stage that needs paperwork until **the deal's advisor** (its owner, whoever moves it) has finished the initial hours for every licence that carries an annuity rule. The message says who and how many hours are missing.
- **Renewal hours:** these are due by the end of the term, like other CE, and do not block a sale.
- **Who is not affected:** advisors whose licences have no annuity rule. Every Canadian licence is in this group today.
- **Why this order:** the rule checks the initial hours first, in date order. Leftover hours and every later hour count toward the current term's renewal.

## Yearly security and data handling course

A new starter course, `security-yearly`, takes about 20 minutes in 5 lessons with a 6-question quiz, in English and French. It covers:
- access and 2-step verification
- handling client data
- reporting incidents the same day
- offboarding the same business day
- using only the Chrome Web Store copy of PII

Finishing it records that the person has read the company's security policies. An auditor accepts that completion record as evidence.

Admins add it from the starter courses and assign it with a due date, to everyone at joining and to everyone once a year. PII does
not yet re-assign it every year automatically. Like the other starter courses, it is a draft: compliance (and a French reviewer)
should check it before publishing.

## Evidence

- **Tests:** `apps/api/test/annuity-training.test.ts` (5). These cover:
  - the rule: initial hours first, renewal per term, the first hours never counted toward renewal, the Texas numbers
  - blocking, then logging hours lets the deal through
  - the CE file showing the status
  - the deal's own advisor held to the rule even when a colleague moves it
  - life deals, advisors with no annuity rule, and the switch off all unaffected
  - the lookup staying inside one company
- **Existing tests still pass:** CE, file gates, LMS, and starter quiz balance (the right answer is not given away by its length, in either language).
