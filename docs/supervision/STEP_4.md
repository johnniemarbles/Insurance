# Phase 2, step 4: supervision rules and escalation

Roadmap Phase 2, feature 9 ("PII Product Roadmap vs BlueMind"). Compliance sets rules (required documents by
product, province or amount), review queues, escalation paths and deadlines, without code.

## Switch

`SUPERVISION_ENABLED=1`. Off: every route answers 404, nothing shows, and stage moves are not checked against rules.
Migration `0155_supervision.sql` adds two tables. It also gives the sign-in role read access to a few columns so the
background sweep can find overdue reviews. It changes no existing row.

## How it works

1. **Compliance writes a rule.** On the Compliance page, **Supervision rules** (compliance or a tenant admin only):
   - **When a deal:**
     - is in a pipeline, or any pipeline
     - enters a stage, or any won stage
     - and, optionally, has a deal value or recommended cover of at least an amount, a product line (life and health,
       or annuities), a client province, or is replacing existing cover
   - **Then it needs:**
     - extra paperwork (any of the usual types)
     - and/or a compliance review within a number of hours
     - if the review is late, PII tells a named person (or every compliance officer)
   - **Risk:** low, medium or high, which sorts the queue.
   - Rules can be edited or switched off. Each shows a plain description, such as "entering 'Submitted', in Life,
     deal value at least $1,000,000".
2. **The gate.** A deal entering the stage is refused until:
   - the rule's paperwork is on file. Compliance can waive it like any other paperwork.
   - its review is approved.

   The message names the rule.
3. **The deal.** On a deal's **Files** tab, **Company rules for this deal** lists each rule that applies, what is
   still to file, and the review's status. The advisor asks for the review there, with an optional note.
4. **The queue.** On the Compliance page, **Reviews requested** shows waiting reviews, late and high-risk first:
   - Compliance approves or rejects with a note of at least 10 characters.
   - The person who asked can never decide their own review.
   - Compliance is notified when a review is asked for, and the advisor when it is decided.
5. **Escalation.** The ten-minute background sweep finds reviews past their deadline. It notifies the rule's named
   person (or every compliance officer) once, by notification and email.

## Facts a rule can test

| Fact | Where it comes from |
| --- | --- |
| Deal value | The deal's Value |
| Recommended cover | The latest recommendation (signed first) |
| Product line, replacing | The latest needs analysis (signed first) |
| Province | The client's own answer in a submitted intake, else the advisor's province on the needs analysis |

A condition the deal has no fact for does not match.

## Evidence

- **Tests:** `apps/api/test/supervision.test.ts` (5). These cover:
  - matching
  - who can write rules
  - escalating only to compliance
  - blank conditions staying blank
  - the switch
  - blocking until paperwork and review are done
  - requests only where the rule applies
  - notifications
  - the queue
  - escalating once, by notification and email
  - decisions, which are final
  - switching a rule off
- **Privacy isolation:** section 3k of `tests/isolation/test_isolation.py` (270/270).
- **Full suite:** 856 passed.
- **Browser walkthrough:** `bash tests/uat/supervision/run.sh`:
  1. Compliance writes a rule.
  2. The advisor is blocked, files the ID and asks for a review.
  3. Compliance approves.
  4. The deal moves. The script checks the database: Submitted, approved.

| Screen | File |
| --- | --- |
| Writing a rule | `screens/1-rule-form.png` |
| The rules | `screens/2-rules.png` |
| A blocked move | `screens/3-blocked.png` |
| Review asked for on the deal | `screens/4-review-asked.png` |
| Compliance's queue | `screens/5-queue.png` |
