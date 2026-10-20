# Families, Gate C (regulated compliance)

Gate C adds the compliance layer to families:

- a consent ledger for each person, reusable across deals only when it still matches
- legal authority, recorded with evidence and verified by someone else
- ID checks for each person, with rules set by compliance
- a dated table of capacity rules for each jurisdiction
- life events, and a queue of reviews

It sits on Gates A and B and ships **switched off**. Plan: "PII Family Accounts Plan" v2. Decision 8 applies: **written Canadian
legal and compliance sign-off is needed before this is switched on anywhere.**

## Switching it on and off

| Action | How | Effect |
| --- | --- | --- |
| Turn on (after sign-off) | `FAMILIES_ENABLED=1` **and** `FAMILIES_COMPLIANCE_ENABLED=1` on `pii-ca`, then redeploy | The client panel shows "Consent and authority". The family panel shows a summary. Contacts shows "Compliance reviews". The deal Consent tab shows consent and ID for each person. |
| Turn off (rollback) | `FAMILIES_COMPLIANCE_ENABLED=0` or remove it, then redeploy | Every Gate C route answers 404. Deal paperwork gates behave exactly as before. The daily review check stops. |

Migration `0147_family_compliance.sql` adds tables, functions and one optional client field (province of residence). It
changes no existing row. Existing deal-level consents and ID records stay as they are. They are never copied or relabelled,
and they still satisfy deal gates exactly as before.

## What it does

1. **Consent for each person and each purpose.** There are five purposes: collection and use, sharing with insurers,
   electronic messages, electronic proof of insurance, and marketing. A consent covers either all dealings with the
   partner or one deal. It stores:
   - the notice version
   - how it was given
   - who gave it: the client, or someone acting under a named authority

   **Reuse.** An existing consent is offered for a new deal only when all of these still match: the purpose, the scope,
   the notice version, and the authority it was given under (if any). When one doesn't match, the deal screen says why,
   for example "given under notice draft-0; the current notice is draft-1".

   **Withdrawal** is recorded and never erased. Withdrawing a consent:
   - adds a task to every deal that relied on it
   - opens a review
   - for marketing and electronic messages, also stops email to the client through the existing opt-out flag.
2. **Minors and capacity.** The province of residence and the capacity rules decide whether someone is under the age of majority.
   - **Self-consent from a minor** is refused unless the partner either records the consent from a verified guardian, or
     writes a note saying why the person's own consent was accepted after review.
   - **Unknown age** (no date of birth or no province on file) blocks nothing. The screens say the age is unknown.
3. **Legal authority.** The kinds are guardian of a minor, power of attorney (property or personal care), court-appointed,
   and other representative. Each records:
   - its scope (which consents the holder may give, and whether they may act on policies)
   - its dates
   - a description of the evidence seen (document numbers are refused)
   - its status: it starts *pending*

   Verification:
   - Only compliance at or above the client's partner, or a tenant admin, may verify. **Never the person who recorded
     it.** The database enforces both rules.
   - An authority enables nothing until it is verified and in date.
   - Ending an authority stops every consent given under it at once, and opens a review of the deals that relied on them.
   - A guardian of a minor cannot be recorded for someone known to be of age.
4. **ID checks for each person.** Each check records the method, the types of document seen, the outcome, and who
   checked. ID numbers and images are never stored. A note containing six or more digits in a row is refused. Rules:
   - **Who needs ID:** compliance sets which deal roles need a check and how many months it stays current.
   - **No rule set:** a role with no rule shows "No ID rule", never "not required".
   - **Deal gates:** a deal's ID gate counts these checks when every client on the deal has a current verified check.
5. **Capacity rules.** These are dated, with one rule per jurisdiction and activity.
   - **Seeded rules:** Canadian companies get the 13 provincial and territorial ages of majority from statute (18 in AB,
     MB, ON, PE, QC and SK; 19 in BC, NB, NL, NS, NT, NU and YT), each marked **"not yet confirmed by counsel"**.
   - **Changes:** compliance adds the rules for each activity (privacy consent, applying, owning a policy, receiving a
     benefit) and records counsel's confirmation. A new rule closes the previous one, and past rules are kept.
   - **US companies** get no seeded rules (decision 9).
6. **Life events.** These are separation, death, a guardianship change, a move, a marriage or partnership, a birth or
   adoption, and other. Recording one **changes nothing else**. It opens one review listing what to look at: the
   family, the policies the person is on, open deals, and authorities. A death or a guardianship change is due in 7 days;
   the others in 14.
7. **Reviews.**
   - **Coming of age:** a daily check opens a review when someone reaches the age of majority within 60 days, or has
     already reached it while a guardian authority is still open.
   - **Authorities ending:** verified authorities ending within 30 days also open a review.
   - **Resolving:** the client's partner or compliance resolves a review with a written note.
   - **Running it by hand:** tenant admins can run the check now from the API.

## Who sees what

Everything in Gate C follows the client's record: the owning partner, managers above them, the location the client is
marked for, and tenant admins.

- **Sibling partner:** sees nothing and gets 404.
- **Manager:** can see, but cannot record or change anything.
- **Compliance:** sees through the same wall and can verify authority below its node.
- **Verification queue:** shows only authorities the viewer may verify, and never the viewer's own.
- **Audit entries:** carry purposes, kinds and outcomes only, never notes or evidence details.

## Rules the database holds

- **Append-only records:** ID checks and life events. The runtime role has no UPDATE or DELETE on them.
- **Consents:** a consent can only be withdrawn, once. Its purpose, scope, version and authority never change.
- **Who did it:** consents, authorities, ID checks and consent uses must be recorded as the signed-in user.
- **Authority:**
  - It starts pending.
  - It is decided once, by someone other than the recorder who is compliance or a tenant admin.
  - It is ended once.
- **Consent under authority:** needs `authority_in_effect` (verified, in date, purpose covered) on the date given.
- **Using a consent on a deal:** needs `person_consent_in_force`, and the person must be on that deal.
- **Same partner:** the client, the authority holder and the record must all belong to the same partner.
- **Capacity rules:** a partner can only add the unconfirmed statute default. Counsel's confirmation and closed rules
  cannot be changed.
- **Row-level security:** every new table has FORCE row-level security and the tenant wall, and `rls_drift` stays empty.

## Not in Gate C, and open items

- **Notice wording** is still the existing draft (`draft-1`) until counsel approves it. That is the same limitation as
  the deal-level consents.
- **Evidence is described in words.** The API can link a document stored on a deal, but the screens don't offer that
  yet. Uploading a document to the person directly is a later item.
- **Needs analysis:** each participant acknowledging it stays as it is today. The plan lists it under compliance, but
  this gate does not change it.
- **Gate D, still to come:** family mail merge (which will check consent and opt-outs), imports, the family timeline,
  the Gmail strip and the left-panel item.

## Evidence

- **Rules tests:** `apps/api/test/family-compliance-rules.test.ts` (5).
- **API tests:** `apps/api/test/family-compliance.test.ts` (13). These cover:
  - the switch
  - capacity rules
  - minors
  - verifying authority, including that the person who recorded it cannot
  - reuse, with notice versions
  - withdrawal side effects
  - ending an authority
  - ID rules and gates
  - life events changing nothing else
  - coming of age
  - the family summary
  - the privacy wall
  - append-only grants
- **Privacy isolation:** section 3d of `tests/isolation/test_isolation.py`.
- **Browser walkthrough:** `bash tests/uat/families/run.sh` (Gates A, B and C, then the switch-off check).

| Screen | File |
| --- | --- |
| A client's consents, ID check, and a guardian authority waiting for compliance | `gate-c-screens/14-person-consents.png` |
| A 12-year-old's own consent refused, with the reason | `gate-c-screens/15-minor-consent-refused.png` |
| Compliance queue: authority to verify, coming-of-age review | `gate-c-screens/16-compliance-queue.png` |
| Consent given under the verified guardian authority | `gate-c-screens/17-consent-under-authority.png` |
| Family summary: minors, authority, consents, ID | `gate-c-screens/18-family-compliance.png` |
| A life event opens a review and changes nothing else | `gate-c-screens/19-life-event-review.png` |
