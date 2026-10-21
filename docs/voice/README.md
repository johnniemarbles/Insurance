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

Inside Gmail the microphone needs extension version 1.8.0 (the PII frame must be allowed to use the microphone). Until
then it works in the web app (`/app`), on computers and phones. Read aloud works in both.

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

- `apps/api/test/voice.test.ts` (11):
  - off unless switched on
  - the company and partner switches
  - wrong type, too long or too large refused before any AI call
  - one transcription, with no speaker labels
  - nothing stored but the log line
  - edit rights on the deal, and another company's deal not found
  - Anthropic companies use PII's Gemini or OpenAI
  - the note draft uses the dictated words only and saves nothing
  - the hourly limit
- `apps/web/test/voice-text.test.ts` (2): read aloud picks only local voices in the right language; references and
  markdown are not spoken.
- Browser walkthrough `tests/uat/voice/run.sh`: Chrome's fake microphone, the stand-in AI and stand-in voices. It covers
  speaking a question, hearing the answer, dictating a note with a task and saving both, and speaking a task. Screens
  are in `screens/`.

## Turning it on

1. Update the privacy impact assessment (voice, retention: none) and add the acceptable-use line on dictating where
   others can hear (security policy 11).
2. Set `VOICE_ENABLED=1` on the Canada server; try it with head office first.
3. Then partners in Canada, then the US server.

Turning it off is `VOICE_ENABLED=0`; the buttons disappear and nothing else changes.
