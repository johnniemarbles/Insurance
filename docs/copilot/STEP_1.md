# Co-pilot, step 1: AI providers, partner keys, Ask PII

This is the first build step of roadmap Phase 1 ("Co-pilot parity"), from the "PII Product Roadmap vs BlueMind" doc,
decisions 1 and 2.

It ships **switched off**. Before switching it on, the roadmap gate "AI providers + PIA" must pass:
- a privacy impact assessment
- a contract with each provider that rules out training on client data and keeps processing in Canada

## Switching it on and off

| Action | How | Effect |
| --- | --- | --- |
| Give PII its own keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (any of them). Optionally `AI_MODEL_ANTHROPIC`, `AI_MODEL_OPENAI`, `AI_MODEL_GEMINI` | The providers whose keys are set can be chosen in Settings |
| Turn on | `COPILOT_ENABLED=1`, then redeploy. The company's "AI assistant" switch must also be on, and for partners the "Partners can use the assistant too" switch | Settings → Advanced shows "AI co-pilot", and an **Ask PII** button appears on every page |
| Turn off | `COPILOT_ENABLED=0` or remove it | Every co-pilot route answers 404. The existing assistant keeps working on the default provider |

Migration `0149_copilot.sql` adds two columns to the company AI settings (both with defaults) and two tables. It changes
no existing row.

## What it does

- **Provider per company:** a company admin chooses Anthropic, Google Gemini or OpenAI from the providers this server
  has keys for. The existing deal summaries, next actions and reply drafts follow the same choice. With no choice made,
  everything works as before.
- **Partners' own keys:** only when the company allows it.
  - **Who can set one:** only the partner's administrator, and only for their own partner.
  - **Storage:** the key is stored encrypted (AES-256-GCM, bound to that company and partner), shown back only as its
    last four characters, and replaced or withdrawn, never read out.
  - **Who uses it:** everyone at that partner. If the company switches partner keys off, PII's key takes over at once.
- **Ask PII:** a question answered from the records the person asking can already see. Their row-level security
  decides; a sibling partner's client never reaches the AI service (tested).
  - **What is sent:** at most 30 short lines (clients, deals, notes, families, policies, plus renewals and tasks when
    asked), each numbered.
  - **The answer:** must cite them. The screen lists only citations that exist, with the provider and whose key
    answered.
  - **Nothing matched:** no AI call is made.
  - **What is kept:** a log line (who, when, provider, key source, model, how many records were sent and cited). The
    question and the answer are not stored.

## Not in this step

- **Rest of Phase 1:** rulebook questions (2), meeting notes from uploaded recordings (3), letter drafts (4) and the
  audit-ready score (8) come in the next steps.
- **Citations:** they name the record but do not open it yet.

## Evidence

- **API tests:** `apps/api/test/copilot.test.ts` (7). These cover:
  - the switch
  - provider choice
  - visible records only
  - real citations only
  - no call when nothing matches
  - the log holds no text
  - the partner switch
  - partner keys: allowed only, admin only, encrypted, last four shown, used, switched off, withdrawn
  - the existing assistant following the company's provider
- **Privacy isolation:** section 3f of `tests/isolation/test_isolation.py`.
- **Browser check:** `bash tests/uat/copilot/run.sh`. It uses stand-in providers (`AI_FAKE_PROVIDERS=1`, honoured only
  when `APP_ENV=dev`).

| Screen | File |
| --- | --- |
| Settings: provider and partner keys | `screens/1-copilot-settings.png` |
| Ask PII with the records used | `screens/2-ask-pii.png` |
