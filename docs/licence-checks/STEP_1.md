# Phase 3, step 1: licence checks against the regulators

Roadmap Phase 3, feature 12 ("PII Product Roadmap vs BlueMind"), decision 5: FSRA (Ontario) and the Insurance
Council of British Columbia first. Gemini reads the register result.

## Switch

`LICENCE_CHECKS_ENABLED=1`. Off: every route answers 404, nothing shows, and "cleared to transact" ignores register
checks. Reading a saved page needs `GEMINI_API_KEY`; without it, compliance records the result by hand.

Migration `0156_licence_checks.sql` adds one table and the `licence_check` notification. It changes no existing row.
A new company rule, **Check each licence on the regulator's register every (days)**, defaults to 90.

## How it works

1. **The list.** The Compliance page shows **Licence checks**, for compliance or a tenant admin. It lists every
   partner licence in Ontario or British Columbia with:
   - its regulator and a link to the public register
   - the last check
   - when the next one is due

   Problems come first, then checks that are due.
2. **A check:**
   1. Open the register and look the partner up.
   2. Save the result as a PDF or a screenshot, and upload it.
   3. PII's Gemini key reads the name, licence number, class, status, expiry, conditions and any discipline. PII
      compares them with the licence on file: name, number and expiry.
   4. Compliance confirms the status and records the check.
   - The saved page is kept with the partner's compliance documents as evidence.
   - The next check is set from the company rule.
3. **A problem:**
   - **What counts:** the register shows the licence as suspended, revoked, lapsed or not found.
   - **What it needs:** a note of at least 10 characters.
   - **What happens:** the partner shows on **Not cleared to transact** ("Regulator register shows a licence
     problem"), and every compliance officer and administrator is told by notification and email. Discipline on the
     register also triggers the alert.
4. **Reminders:** the background sweep reminds compliance once per licence per due date.
5. **Who can do what:** checks are records. Nobody can change or delete one, and partners can see their own checks
   but not record them.

## Why not look the register up automatically

Neither regulator offers a public API, and the registers are interactive web pages. Copying them automatically could
break their terms of use and would break whenever the pages change. Saving the result and having Gemini read it
keeps a person in the loop and keeps the exact evidence the auditor will ask for. An automatic lookup can be added
later behind the same screen if a regulator offers a data feed.

## Evidence

- **Tests:** `apps/api/test/licence-checks.test.ts` (5). These cover:
  - regulators by province
  - reading and comparing a register page
  - the switch, and compliance only
  - evidence kept and the next date set
  - checks that cannot be changed
  - an adverse result clearing the partner and telling compliance
  - reminders sent once per due date
- **Privacy isolation:** section 3l of `tests/isolation/test_isolation.py` (279/279).
- **Full suite:** 861 passed.
- **Browser walkthrough:** `bash tests/uat/licence/run.sh`, with a stand-in Gemini and a plainly fake register image.
  The script checks the database: active, name and number matched, evidence kept.

| Screen | File |
| --- | --- |
| A licence due for a check | `screens/1-due.png` |
| What the register shows, compared with the file | `screens/2-read.png` |
| The check recorded | `screens/3-recorded.png` |

## Sources for the register links

- [Insurance Council of BC licensee directory](https://insurancecouncilofbc.com/licensee-directory/)
- [FSRA](https://www.fsrao.ca). The link opens FSRA's site, where compliance uses its licensee search. Confirm the
  exact search page with FSRA, and it can be set per regulator later.
