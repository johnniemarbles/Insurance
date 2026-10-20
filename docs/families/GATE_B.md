# Families, Gate B (insurance)

Gate B connects families to the insurance they hold. It adds the people on each policy and deal, beneficiary groups,
family totals that count each policy once, a coverage grid, and a queue of policies that are missing people. It sits on
Gate A and ships **switched off**. Plan: "PII Family Accounts Plan" v2.

## Switching it on and off

| Action | How | Effect |
| --- | --- | --- |
| Turn on | `FAMILIES_ENABLED=1` **and** `FAMILIES_INSURANCE_ENABLED=1` on `pii-ca` or `pii-us`, then redeploy | Family panel shows Insurance; Contacts shows "Policies missing people" |
| Turn off (rollback) | `FAMILIES_INSURANCE_ENABLED=0` or remove it, redeploy | Every Gate B route answers 404 and no Gate B screen shows; Gate A keeps working |

Gate B needs Gate A: with `FAMILIES_ENABLED` off, Gate B is off too. Migration `0146_family_insurance.sql` only adds tables
and one function. It changes no existing row, so it is safe with the switch off.

## Who sees what

- A policy is visible on the same terms as any record: its **producer** is the owner and its **branch** is the location.
  On a family page a partner sees only the family's policies they can see, usually those they produced.
- People on a policy or deal are shown only when the client record is visible too.
- The family total adds only the policies the viewer can see. A manager and a partner can therefore see different totals
  for the same family; that is intended.
- Only the policy's producer (or a tenant admin) can add or end people on it. Carrier rules can be changed by tenant admins only.
- The Commercial page is unchanged. Note for later: today managers and compliance users see the commercial policy list
  tenant-wide. That is older behaviour, not part of Gate B, and is flagged for a separate decision.

## What a partner can do

1. **People on a policy.** Owner, joint owner, insured, joint insured, payor, beneficiary, trustee. A person is a client
   record or, for someone who is not a client, a name only. Ending a person keeps the history.
2. **Beneficiary groups.** Shares are checked per insured life and class (primary, contingent). A group is valid when its
   percentages total exactly 100%, or it uses equal shares, or the estate alone. The policy shows "Ready to submit" or
   "Not ready to submit" with the reason in plain words.
3. **Family totals.** In-force policies only, each counted **once** however many family members are on it, and kept
   apart by currency (CAD or USD from the policy's jurisdiction). If a currency is unknown the total is marked partial.
   Lapsed, cancelled and ended policies are listed but not added. People who are only beneficiaries are shown apart.
4. **Coverage grid.** One row per family member, one column per line (Life, Disability, Critical illness, Health and
   dental, Long-term care by default). Every cell starts as **Unknown**, never as a gap.
   - **Covered** needs a policy that person is on, or a described outside policy.
   - **Potential gap** needs a signed needs analysis for that person.
   - Changes add a new row and keep the old one; nothing is edited in place.
5. **Policies missing people.** A queue from Contacts listing in-force policies with no owner or no insured, using the
   carrier's rules where they are set.

## Rules the database holds

- Party roles and their fields are checked (a beneficiary needs a class and allocation; shares are 1 to 10000 basis points).
- A person on a policy or deal must belong to the same partner tree as the record (trigger).
- Ended party rows and superseded coverage rows cannot be changed.
- Covered and potential-gap rows are rejected without their evidence.
- Every new table has FORCE row-level security and the tenant wall; `rls_drift` stays empty.

## Carrier rules (decision 6, open)

`carrier_party_profiles` holds which roles each carrier requires. A tenant default is used until a carrier is set, and
every profile shows "not confirmed with carrier" until someone confirms it. The defaults are our reading of common
practice, **not confirmed with any carrier**. Do not treat "Ready to submit" as the carrier's own check.

## Evidence

- API tests: `apps/api/test/family-insurance-rules.test.ts` (7) and `apps/api/test/family-insurance.test.ts` (10).
- Privacy isolation: section 3c of `tests/isolation/test_isolation.py` (sibling partner, other tenant, location, admin).
- Browser walkthrough: `bash tests/uat/families/run.sh` (seeds a family, policies and a signed needs analysis, then
  drives the screens and checks the switch-off).

| Screen | File |
| --- | --- |
| Family insurance: totals counted once, lapsed policy not added | `gate-b-screens/10-family-insurance.png` |
| Coverage grid with a potential gap backed by a needs analysis | `gate-b-screens/11-coverage-grid.png` |
| People on a policy: contingent shares at 50%, not ready | `gate-b-screens/12-policy-people-check.png` |
| Policies missing people | `gate-b-screens/13-missing-people-queue.png` |

## Not in Gate B

Consent and legal authority, family mail merge, carrier imports filling in people automatically, the Gmail strip, and the
left-panel item. These stay in Gates C and D.
