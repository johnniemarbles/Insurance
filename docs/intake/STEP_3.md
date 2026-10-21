# Phase 2, step 3: client self-intake

Roadmap Phase 2, feature 6 ("PII Product Roadmap vs BlueMind"): a secure link where clients fill in KYC details,
needs questions and consents, upload documents and confirm. Answers prefill the file, and each family member gets
their own link.

## Switch

`INTAKE_ENABLED=1`. Off: every intake route, including the client's page, answers 404 and nothing shows. Migration
`0154_intake.sql` adds two tables and changes no existing row.

## How it works

1. **The advisor sends the link.** On a deal's **Details** tab, **Client intake**:
   - Choose a client on the deal. They need an email address, because they confirm with a code sent there.
   - Choose what to ask about. Who they are is always asked. The options are their situation and goals, consents,
     documents, and the electronic ID check when Stripe Identity is on.
   - PII emails the link if it can, unless the client withdrew consent to email. The advisor can also copy it.
   - The link works for 14 days. A new link for the same client replaces the old one.
   - Each family member gets their own link, because each is a client on the deal.
2. **The client fills it in** on their own phone or computer, in English or French:
   - Answers save as they go.
   - Documents (PDF or photos, up to 8 files of 8 MB each) go onto the deal's **Files** tab.
   - The ID check, if asked, opens Stripe's page.
   - To submit, they ask for a 6-digit code by email, enter it, type their name and confirm their answers are true.
3. **On submit:**
   - The consents they ticked are recorded on the **Consent** tab, with channel "esign" and the email-code
     confirmation in the note.
   - The advisor gets an email.
   - The link stops working.
4. **The advisor reviews and applies:**
   - **Review** shows every answer, the consents, the documents and the client's confirmation.
   - **Apply to the file** updates the contact (phone, birth date, language), showing old and new values first.
   - It can also start a **draft** needs analysis from the answers. The advisor finishes it with the client before it
     is signed; nothing is ever signed by the intake.

## What is kept, and what is not

- **Answers:** checked against a fixed list of questions. Anything else is dropped; for example, a SIN typed into
  the form has no field and is not kept.
- **The link:** only its hash is stored, and only the sign-in role can read it.
- **The client's record:** once submitted, their answers, documents, consents and typed name cannot be changed
  (enforced in the database). Applied and cancelled intakes are final.
- **Who sees it:** intakes follow the deal's privacy wall.
- **Access:** the client side acts as the advisor who sent the link, with no more access than that.
- **The client's page:** loads nothing from outside, is never cached, and runs under a strict content security
  policy.

## Evidence

- **Tests:** `apps/api/test/intake.test.ts` (5). These cover:
  - answer checking
  - the switch, editor-only, and a client with an email
  - links stored as hashes, with a new link replacing the old
  - the page's headers
  - saving and uploading without changing the file
  - the code, the typed name, and consents recorded at submit
  - the record fixed after submit
  - review and apply (contact details and a draft needs analysis)
- **Privacy isolation:** section 3j of `tests/isolation/test_isolation.py` (254/254).
- **Full suite:** 851 passed.
- **Browser walkthrough:** `bash tests/uat/intake/run.sh`. The client side runs at phone size. The script also checks
  the database: applied, 2 consents, birth date set, 1 draft.

| Screen | File |
| --- | --- |
| The advisor's link | `screens/1-advisor-link.png` |
| The client's form on a phone | `screens/2-client-form.png` |
| Submitting with the code | `screens/3-client-submit.png` |
| The advisor's review | `screens/4-advisor-review.png` |
| The draft needs analysis | `screens/5-needs-draft.png` |

## Before switching on

- **Consent wording:** counsel signs off the consent wording, which is still `draft-1` in PII.
- **Privacy assessment:** the privacy impact assessment covers client-entered data and uploads.
- **Email:** a mail service (`RESEND_API_KEY`) is set up so links and codes are emailed.
