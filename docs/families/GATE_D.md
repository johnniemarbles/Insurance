# Families, Gate D (productivity)

Gate D adds the tools that make families save time:

- **Family email:** one email per family.
- **Family import:** a dry run lists every problem first.
- **Family timeline.**
- **Gmail side panel:** a family strip with private suggestions.
- **Families item in Gmail's left panel.**

It sits on Gates A to C and ships **switched off**. Plan: "PII Family Accounts Plan" v2.

## Switching it on and off

| Action | How | Effect |
| --- | --- | --- |
| Turn on | `FAMILIES_ENABLED=1` **and** `FAMILIES_PRODUCTIVITY_ENABLED=1`, then redeploy | Contacts shows "Email families" and "Import families". The family panel shows a timeline. Gmail's side panel shows the family strip, and the left panel shows Families (extension 1.6.0 or later). |
| Turn off (rollback) | `FAMILIES_PRODUCTIVITY_ENABLED=0` or remove it, then redeploy | Every Gate D route answers 404 and deal merges work exactly as before. Family emails not yet sent are skipped, not sent. The left panel drops Families on its next refresh. |

Migration `0148_family_tools.sql` adds three things:
- an `audience` column on merges (every existing merge is a deal merge)
- `family_id` and `facts` columns on merge recipients
- two new tables

It changes no existing row.

## Family email

- **Who gets it:** the family's Head, or each adult (the Head and spouse or partner) when the family's mailing preference
  is "each adult".
- **Who is skipped, with the reason shown:** people with no email, people who opted out, the deceased, and minors (by
  Gate C's capacity rule when that is on, otherwise under 18). An address is used once per send.
- **Who can send:** only the partner who serves the family, or a tenant admin. Managers can see the family but cannot
  send to it.
- **What each person sees:**
  - their own name
  - the family's name and salutation
  - the policies **they** own or jointly own (`{{myPolicies}}`, `{{nextRenewal}}`)

  Another member's policies never appear, not even the fact that they exist. Deal fields (`{{box}}`, `{{stage}}`, …)
  are refused, and so is `{{myPolicies}}` in a subject. `{{unsubscribe}}` is required, as for every merge.
- **Preview:** shows each person's message and the list of facts in it. You can click any recipient to see their version.
- **Sending:** uses the existing Mail merge, so the same daily cap, pacing, Gmail compose and unsubscribe page apply.
  Every message is checked again just before it goes out. Someone who has opted out, died or left the family since
  is skipped.
- **Send log:** keeps, for each message, the subject and the list of facts used (keys and policy ids, not the text).

## Family import

- **The file:** a CSV with one row per person.
  - Columns: `family`, `role`, and then `full_name` or `email`. Optional: `client_id`, `family_id`, `phone`,
    `date_of_birth`, `preferred_language`, `same_name_ok`.
  - Common header aliases are understood (Household, Name, E-mail, DOB, …). Unknown columns are listed and ignored.
- **Dry run first:** "Check the file" lists every problem, line by line, and writes nothing.
  - Import is enabled only when no row has a problem.
  - The commit checks everything again and writes all of it in one transaction or none of it.
- **No merging:**
  - An existing client is linked only by `client_id` or an exact email for the same partner. Their name, phone, date of
    birth and language on file are never changed, and the report says so.
  - A different client with the same name is an error. The fix is to add their `client_id` or email, or
    `same_name_ok=yes` when it really is a different person.
- **Family rules:** the same as the screens. A new family needs exactly one Head, and nobody can be in two families.
  Adding to an existing family needs its `family_id`, and the family must belong to the importing partner.
- **Log:** each committed import is logged with its counts and a hash of the file, not the file itself.

## Timeline

Newest first, under the viewer's access. It shows:

- the family being created or archived
- people joining and leaving
- policy roles (Gate B)
- coverage records (Gate B)
- life events (Gate C)
- consents (Gate C)
- authority (Gate C)
- family emails sent

The send log is private to the sender, so a manager sees the family's history but not the partner's emails.

## Gmail (extension 1.6.0)

- **Family strip:** in the conversation side panel, when the sender or a recipient is a client the partner can see, the
  panel shows their family and its members.
  - **Lookup:** the addresses of the open conversation are sent to the server in a request body, never in the URL, so
    they stay out of logs. They are matched only against clients the partner can already see, and nothing is stored.
  - **Suggestions:** when a client in the conversation is in no family, the panel suggests adding them to the family
    shown, with the reasons ("In this conversation", "Same last name"). Suggestions are private to the partner and
    computed fresh each time. Nothing changes until the partner picks a role and presses **Add**. "Not now" is
    remembered for that partner only.
- **Left panel:** a Families item beside Contacts, with a new icon. The server shows it only to extensions that say they
  are 1.6.0 or later, so 1.5.0 never shows a broken icon.
- **Store review:** permissions, host access and the other frozen manifest fields are unchanged (`check-freeze` passes).
  This is a code-only update, but it still needs a Chrome Web Store review because the extension's own code changed.

## Who sees what

- **Sibling partner:** cannot see the family, plan an email to it, preview it, open its timeline, import into it, or get
  a strip for its clients. A sibling's client in a conversation returns nothing, not even a name.
- **Manager:** sees families, timelines and strips, but cannot send, import for the partner, or act on suggestions.
- **Suggestion dismissals:** private to each person (own-rows policy).
- **Import log:** follows the CRM wall.

## Evidence

- **Rules tests:** `apps/api/test/family-tools-rules.test.ts` (4).
- **API tests:** `apps/api/test/family-tools.test.ts` (10). These cover:
  - the switch
  - the left-panel version gate
  - who receives
  - template rules
  - per-person facts
  - re-checks at sending
  - the import dry run, refused commit, commit and log
  - the timeline
  - the strip and dismissals
- **Privacy isolation:** section 3e of `tests/isolation/test_isolation.py`.
- **Browser walkthrough:** `bash tests/uat/families/run.sh` covers Gates A to D, plus the switch-off check. The Gmail
  strip runs the real side-panel code on a test page (`tests/uat/families/harness`).

| Screen | File |
| --- | --- |
| One email per family: who gets it, Raj's own policies, the facts listed | `gate-d-screens/20-family-email-preview.png` |
| The send waiting in Mail merges | `gate-d-screens/21-family-send-in-mail-merges.png` |
| Import dry run: every problem listed, Import disabled | `gate-d-screens/22-import-dry-run.png` |
| Import done | `gate-d-screens/23-import-done.png` |
| Family timeline | `gate-d-screens/24-family-timeline.png` |
| Gmail side panel: family strip and a suggestion | `gate-d-screens/25-gmail-family-strip.png` |
| Suggestion added by hand | `gate-d-screens/26-gmail-strip-added.png` |
