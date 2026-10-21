# Voice, part 1: speak, dictate, read aloud

Part 1 of the "PII voice assistant plan". Partners can talk to PII instead of typing: ask a question, dictate a note or a
task, and have answers read aloud. Speech only fills in text that the person checks; nothing is sent to the assistant or
saved on a deal until they press Ask or Save.

## Switches

| Setting | Effect |
| --- | --- |
| `VOICE_ENABLED=1` (server) | Turns voice on. Off (default): every `/v1/voice/*` route answers 404 and no microphone or speaker button shows. |
| Company AI switch (Settings, AI) | Needed for the microphone. Off: read aloud still works, speaking is refused. |
| Partner switch ("Partners can use the assistant too") | Needed for people whose only roles are partner roles, as for the assistant. |

Speaking also needs a provider that takes audio: the company's own provider if it is OpenAI or Gemini, else PII's
`OPENAI_API_KEY` or `GEMINI_API_KEY`, the same as meeting notes. With neither, the microphone stays hidden.

## Where it shows

- **Ask PII** (records and rulebook): Speak under the question box; Listen under the answer.
- **Home assistant:** Speak under the question box; Listen under the answer.
- **A deal, Activity tab:** "Dictate a note" (speak, review the tidied note and suggested tasks, save), and Speak in the task box.
- **A deal, Advice tab, letter drafts:** Speak for the instructions; Listen under the draft.

### Inside Gmail

PII's screens in Gmail are the server's own page in a frame that the extension places in Gmail. A frame may use the
microphone only when it is created with permission to, and only if Gmail allows it.

- **Extension 1.8.0** creates the PII frame with `allow="microphone"`, so the Speak button records right in the panel.
  Only the PII site in that frame can ask; Chrome still asks the person once. The extension needs no new permission.
- **Before 1.8.0, or if Gmail blocks the frame's microphone,** the Speak button opens a small **PII voice window**
  (`/voice-recorder`, on the same PII site). It only records: the audio goes back to the PII page that opened it,
  addressed to that same site, and that page sends it signed in as usual. The window makes no API calls and cannot be
  framed. If Chrome blocks pop-ups, the button says how to allow them.
- **The extension's built-in copy** (shown only when the server cannot be reached) runs in Gmail's own page, so it
  shows no microphone there.

To check on a real Gmail account after 1.8.0 is live:
1. Open the PII panel and press Speak; Chrome should ask for the microphone for the PII site.
2. If a small window opens instead, Gmail blocks the frame's microphone and the window path is the one in use. That is
   fine, but tell me so the docs say which.

Read aloud works everywhere.

## How it works

1. The page records up to 60 seconds (WebM in Chrome, M4A on iPhone) and sends it to `POST /v1/voice/transcribe` on the
   person's own country server.
2. The server checks the switches, the person's edit rights when the words are for a deal, the size (2 MB) and the
   hourly limit (60 recordings a person), then transcribes it once in memory, as a single speaker, and drops the audio.
3. The words come back into the box for the person to check and edit.
4. For "Dictate a note", `POST /v1/voice/note-draft` sends only the dictated words (no other deal data) to the AI to tidy
   them into a note and suggested tasks. The person reviews, unticks what they don't want, and saves through the usual
   note and task routes.
5. Read aloud uses the browser's speech with voices that run on the device only (online voices are skipped), so no
   text leaves the device. References like [C3] are not read out. With no local voice for the language, the button
   does not show.

## What is kept

Nothing of the audio. The words are kept only if the person saves them as a question, note or task. Each recording adds
one line to the assistant log (`copilot_log`, kind `voice`): who, when, provider, key source, characters returned and
seconds of audio. A note draft adds a `voice_note` line with the character count. Migration `0161_voice.sql` adds those
two kinds and the `audio_seconds` column; it changes no existing row.

## Tests

- `apps/api/test/voice.test.ts` (12):
  - off unless switched on
  - the company and partner switches
  - wrong type, too long or too large refused before any AI call
  - one transcription, with no speaker labels
  - nothing stored but the log line
  - edit rights on the deal, and another company's deal not found
  - Anthropic companies use PII's Gemini or OpenAI
  - the note draft uses the dictated words only and saves nothing
  - the hourly limit
  - the PII voice window: off with the switch, cannot be framed, makes no API calls, safe ids only
- `apps/web/test/voice-text.test.ts` (3): read aloud picks only local voices in the right language; references and
  markdown are not spoken; where the microphone is used (page, PII window, or not at all in Gmail's own page).
- Browser walkthrough `tests/uat/voice/run.sh`: Chrome's fake microphone, the stand-in AI and stand-in voices. It covers
  speaking a question, hearing the answer, dictating a note with a task and saving both, speaking a task, and the PII
  voice window handing its recording back to the page that opened it. Screens are in `screens/`.
- `apps/extension/test/embed.test.ts`: the PII frame is created with `allow="microphone"`.

## Turning it on

1. Update the privacy impact assessment (voice, retention: none) and add the acceptable-use line on dictating where
   others can hear (security policy 11).
2. Set `VOICE_ENABLED=1` on the Canada server; try it with head office first.
3. Then partners in Canada, then the US server.

Turning it off is `VOICE_ENABLED=0`; the buttons disappear and nothing else changes.
