# Phase 2, step 1: electronic ID check (driver's licence and selfie)

Roadmap Phase 2, feature 7 ("PII Product Roadmap vs BlueMind"), decision 4: a driver's licence and a selfie, checked
through Stripe Identity or PII's own check (Google Gemini reads the licence; a person confirms).

## Switches

| Switch | What it does |
| --- | --- |
| `EID_ENABLED=1` | The server offers electronic ID at all. Off: every route answers 404 and nothing shows. |
| `STRIPE_IDENTITY_SECRET_KEY` | A restricted Stripe key with Identity permissions. Without it the Stripe route is unavailable. |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | The signing secret of the Stripe webhook pointing at `/v1/webhooks/stripe-identity`. |
| `GEMINI_API_KEY` | PII's own check uses PII's Gemini key, whatever AI provider the company picked for the co-pilot. |
| **Settings → Advanced → Electronic ID** | A tenant admin or compliance chooses Stripe, PII's own check, or both, and whether Stripe deletes its copy afterwards (on by default). |

Migration `0152_eid.sql` adds two tables and lets ID records have the method `electronic`. It changes no existing
row.

## How it works

- **Where:** on a deal's **ID & AML** tab, above the manual ID record. The client must be on the deal.
- **Stripe Identity:**
  1. The advisor presses **Send a Stripe Identity link** and sends the link to the client.
  2. On their phone, the client photographs their driver's licence and takes a live selfie on Stripe's page.
  3. Stripe's signed webhook tells PII the result. PII compares the name and birth date Stripe read with the client
     record.
  4. If everything matches, the client is verified. If not, the check goes to compliance.
  5. Once there's an outcome, PII asks Stripe to delete its copy (company setting, on by default).
  - Stripe gets no client details from PII, only internal IDs.
  - If the client has to retry, the reason shows on the deal.
- **PII's own check:**
  1. The advisor uploads the licence photo and a selfie the client gave them, and ticks that the client agreed.
  2. Gemini reads the photos once. Only the photos are sent, no name, birth date or other record data.
  3. The screen shows what was found: a tick or cross for each check, plus the name, birth date and expiry as read.
  4. The advisor looks at the photos and confirms. Only the person who uploaded them can confirm.
  - If everything matches, the client is verified. If not, the check goes to compliance.
- **Compliance:** a tenant admin or compliance accepts or rejects a mismatched check, with a note of at least 10
  characters and no ID numbers.
- **The result:** a verified check adds an ID record with method "Electronic check (licence and selfie)", which the
  deal's paperwork gates count. Nobody can type an electronic record by hand.

## What PII keeps

- **Kept:** who was checked, how, by whom, the status, and a yes, no or unknown for each check:
  - name matches
  - birth date matches
  - not expired
  - selfie matches
  - looks genuine

  Also kept: short reason codes, the document type and the issuing province or country.
- **Never kept:**
  - the licence number
  - the photos
  - the name or birth date as read from the card
  - the address

  The database refuses anything else (tested). If Gemini writes a number it shouldn't, it is dropped before anything
  is shown or stored.
- **Who sees it:** checks follow the deal's own privacy wall, so a sibling partner sees nothing.
- **Changes:** a finished check cannot be changed or deleted.

## Evidence

- **Tests:** `apps/api/test/eid.test.ts` (8). These cover:
  - name, birth date and expiry comparison
  - webhook signatures
  - the switches and who can change them
  - consent, photo types, editor-only, and client-on-deal checks
  - no client data sent to Gemini
  - nothing read from the card is stored
  - confirm leading to an ID record
  - compliance decisions
  - Stripe links, webhook, a repeated webhook, retry and cancel
  - deletion at Stripe
  - database permissions
- **Privacy isolation:** section 3h of `tests/isolation/test_isolation.py` (228/228).
- **Browser walkthrough:** `bash tests/uat/eid/run.sh`, with a stand-in Stripe and Gemini and plainly fake photos.

| Screen | File |
| --- | --- |
| The company setting | `screens/1-eid-settings.png` |
| PII's own check: what it found | `screens/2-own-check-result.png` |
| Verified, with the ID record | `screens/3-own-check-verified.png` |
| A Stripe Identity link | `screens/4-stripe-link.png` |
| Compliance deciding a mismatch | `screens/5-compliance-review.png` |

## Before switching on

- **Stripe:**
  1. Open a Stripe account with Identity enabled and create a restricted key with Identity read and write.
  2. Add a webhook for the `identity.verification_session.*` events.
  3. Stripe Identity is priced per check.
- **Contracts and privacy:**
  - The Stripe and Google contracts must cover ID images: processing region, retention, and no training.
  - Add both to the privacy impact assessment.
- **Client records:** clients need a date of birth on file, or the birth date check goes to compliance every time.
