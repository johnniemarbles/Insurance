# Co-pilot, step 2: ask the rulebook, letter drafts, audit-ready score

Roadmap Phase 1, features 2, 4 and 8 ("PII Product Roadmap vs BlueMind"). Built on step 1 (providers, partner keys).

## Switches

| Feature | Switch | Gate before switching on |
| --- | --- | --- |
| Ask the rulebook, letter drafts | `COPILOT_ENABLED=1` (same as step 1), plus the company's AI switch | The AI gate: privacy impact assessment, provider contracts |
| Audit-ready score | `AUDIT_READY_ENABLED=1` | None. It uses no AI and shows only paperwork the deal's stages already require |

Migration `0150_copilot_rulebook.sql` adds two tables and widens the co-pilot log's kinds. It changes no existing row.

## Ask the rulebook

- **What it reads:** documents compliance or a tenant admin uploads: PDF, Word (.docx), text or Markdown, up to 10 MB.
  - Each document is split into passages under its headings, and the text is kept, not the file.
  - Scanned PDFs with no text are refused, with the reason.
  - Removing a document hides it at once.
- **Who reads it:** everyone in the company, under its own row-level security. Partners cannot add, change or remove
  anything.
- **Asking:** in **Ask PII**, the **Company rulebook** tab.
  - Only the best 8 matching passages go to the AI service, and no client records go with them (tested).
  - The answer must quote them. The screen lists each quoted document and section with the passage text, dropping
    any citation that doesn't exist.
  - If nothing matches, no AI call is made.
- **Log:** who, when, provider, how many passages went and were cited. The question is not stored.

## Letter drafts

- **Where:** on a deal's **Advice** tab. Only someone who can change the deal can draft, so a manager cannot.
- **Kinds:**
  - **Reason-why letter:** needs a signed, current needs analysis and recommendation.
  - **Replacement letter:** needs a signed, current needs analysis and replacement disclosure.
  - **Annual review invitation.**
  - **Meeting follow-up.**

  Expired or draft records never count.
- **Sources:** the deal and its clients, the signed records, and the last five notes, each numbered.
  - The draft must cite them, and the screen lists the ones it used.
  - Anything the sources do not say is written as **[TO CONFIRM: …]**, and the letter cannot be saved until each one
    is filled in.
- **What PII does with it:** never sends it. The partner edits it and saves it to the deal as a note marked "drafted
  with AI, reviewed by the advisor". Sending, or e-signature, stays with the partner.
- **Log:** who, when, provider, counts. The letter text is not logged.

## Audit-ready score

- **The score:** for each open deal visible to the viewer, the share of paperwork its gated stages require that is on
  file (waived items do not count). 100 means nothing is missing.
- **Where:** on the Compliance page, with the average, deals with gaps listed worst first and what each is missing,
  and a per-partner average for managers.
- **Who sees what:** the viewer's own access decides, so a sibling partner's deals never appear.

## Evidence

- **Tests:** `apps/api/test/copilot-tools.test.ts` (5). These cover:
  - passages and Word or PDF text
  - upload rights
  - quotes only from real passages
  - no client data in rulebook questions
  - no call when nothing matches
  - retired documents
  - letters only from signed, current records and only by the editor
  - TO CONFIRM blocking the save
  - the switches
  - scores under the viewer's access
- **Privacy isolation:** section 3g of `tests/isolation/test_isolation.py`.
- **Browser walkthrough:** `bash tests/uat/copilot/run.sh` (steps 1 and 2, with stand-in providers).

| Screen | File |
| --- | --- |
| Ask the rulebook, with the quoted section | `screens/3-ask-rulebook.png` |
| The rulebook in Settings | `screens/4-rulebook-settings.png` |
| A letter drafted on a deal | `screens/5-letter-draft.png` |
| Audit-ready score on the Compliance page | `screens/6-audit-ready.png` |

## Next

Step 3: meeting notes from uploaded recordings (feature 3, decision 3). That step needs a choice of transcription
provider: OpenAI or Gemini, since Anthropic does not take audio.
