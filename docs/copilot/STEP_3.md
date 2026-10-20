# Co-pilot, step 3: meeting notes from an uploaded recording

Roadmap Phase 1, feature 3 ("PII Product Roadmap vs BlueMind"), decision 3: recordings are uploaded first; live
call capture comes later. Built on steps 1 and 2.

## Switch

Same as step 1: `COPILOT_ENABLED=1` plus the company's AI switch. The AI gate (privacy impact assessment, provider
contracts) applies before switching on. Migration `0151_copilot_meetings.sql` only widens the co-pilot log's kinds
to include `meeting`. It changes no existing row.

## How it works

- **Where:** on a deal's **Activity** tab. Only someone who can change the deal sees it, so a manager cannot.
- **Before upload:** the advisor must tick "The client was told this meeting was recorded and agreed". The server
  refuses the upload without it.
- **Files:** MP3, M4A, WAV, WebM or OGG, up to 20 MB.
- **Transcription:**
  - Uses the person's chosen provider if it takes audio (OpenAI or Gemini).
  - Anthropic does not take audio. When it is the chosen provider, PII's own OpenAI or Gemini key transcribes, and
    the screen says which one did.
  - If the server has neither, the answer is "Meeting notes need an OpenAI or Google Gemini key on this server".
  - OpenAI's model is `AI_TRANSCRIBE_MODEL_OPENAI`, defaulting to `gpt-4o-mini-transcribe`.
- **Notes:** the transcript goes to the chosen provider, which returns:
  - a summary
  - follow-ups, with suggested due dates
  - possible changes to the needs analysis
  - points for the compliance file
- **Review:** the advisor edits the summary, picks which follow-ups become tasks, and chooses whether to keep the
  transcript.
- **Saving:** **Save to the deal** writes one note headed "Meeting notes (from a recording, client consent confirmed;
  summarised with AI, reviewed by the advisor)" and the chosen tasks, assigned to the advisor. It also adds an audit
  entry.
- **What is never kept:** the recording itself. Nothing is saved before the advisor presses Save.
- **Log:** who, when, provider, counts. No transcript or summary text.

## Evidence

- **Tests:** `apps/api/test/copilot-meetings.test.ts` (5). These cover:
  - checking the model's notes
  - consent, audio types only, and editor only
  - no storage before saving
  - Anthropic falling back to PII's Gemini, and the 503 when no audio provider exists
  - saving a note plus tasks
- **Full suite:** 831 passed. Privacy isolation: 211/211.
- **Browser walkthrough:** `bash tests/uat/copilot/run.sh` (steps 1 to 3, with stand-in providers).

| Screen | File |
| --- | --- |
| Meeting notes ready for review on a deal | `screens/7-meeting-notes.png` |

## Before switching on

- Provider contracts must cover audio: OpenAI and Google both process it in their own regions unless a Canadian
  region is contracted.
- The consent wording on the screen should be checked by compliance against provincial recording rules.
