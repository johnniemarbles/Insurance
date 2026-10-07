# LMS plan, drawn from Expadio

Source: the Expadio LMS (private repo, read only). Goal: take what fits PII's multi-tenant, node-based model; skip the rest.

## Take
1. **Licence / CE status and 30/60/90 forecast, plus daily learner reminders.** Status derived from dates (valid → expiring → expired). **Done**: `packages/domain/src/forecast.ts`, `GET /v1/compliance/calendar`, "Coming up" on the Compliance page, `sweepLearnerReminders` (course due in 7 days / late; CE at risk / overdue once per term), migration 0033 `reminder_marks`, notification kinds `learning_due` and `ce_reminder` (en and fr-CA), settings `notify.learning_due`, `notify.ce_reminder`.
2. **This plan saved in docs.** Done.
3. **Versioned courses.** **Done**: publishing freezes a version (`course_versions`, immutable by trigger, migration 0034). A published course's lessons and quizzes are locked; unpublish, edit, republish releases version N+1 only if content changed. Learners who have not finished move to the new version; finished learners stay on the version they completed (`outdated` flag in `/v1/my/learning`). `GET /v1/courses/:id/versions` lists history. Not done: learners cannot keep reading version N while an author edits N+1 (unpublishing hides the course meanwhile).
4. **Assignment rules with preview.** **Done** (migration 0035): a rule covers a branch, optionally only one role, with a fixed due date or "N days after joining". `POST /v1/courses/:id/assignments/preview` shows who would be enrolled without saving; `GET .../assignments` lists rules; a 10-minute background pass re-applies every rule so people who join a branch later are enrolled too.
5. **Assessment attempt rules.** **Done** (migration 0036; rules in `packages/domain/src/assessment.ts`): pass mark, attempt cap, a cool-down between tries (`cooldownMinutes`, set on the lesson while the course is a draft), a pass ends the quiz, and each try is numbered and records the course version. Learners see attempts left or when they can retry. Not done: a screen for authors to set the cool-down (API only), and a way for a manager to grant extra attempts.
6. **Learner player: lock and resume.** **Done** (migration 0037): an author can mark a course step by step (set while it is a draft); learners then cannot open or finish a lesson until the required lessons before it are done (authors are never held back). The course page has Start / Continue, which goes to the last lesson opened, or the first unfinished one. Rules in `packages/domain/src/assessment.ts`.
7. **Certificate verify page and PDF.** **Done** (migration 0038). The public page `/c/:code` already existed; it now shows the course version, and CE hours come from the version that was completed, so a later course edit cannot change an old certificate. `/c/:code/pdf` downloads an A4 PDF. Limit: names or titles in alphabets the standard PDF fonts cannot draw (for example Gurmukhi) fall back to the printable page. Embedding a Unicode font would fix that.
8. **Optional enrollment requests.** **Done** (migration 0039): an author can mark a course "people must ask to join". Learners then cannot open it until approved (assigned learners are already enrolled). They send a request with an optional note; the people who lead their branch are notified and can approve or decline with a reason; the learner is notified of the answer, and a declined request can be sent again. `POST /v1/courses/:id/request`, `GET /v1/course-requests`, `POST /v1/course-requests/:id/decision`.
9. **Starter course content.** Written fresh (Expadio has none), reviewed by counsel. **Done (drafts).** Three courses (E&O basics, Privacy and client information, Ethics and fair treatment), each 3 lessons + 5-question quiz, English and fr-CA, general principles only. Authors add them from Training > Starter course; they arrive as unpublished drafts. Counsel/compliance must review before publishing. Not yet written: handling client money.

## Skip
Competency frameworks, SCORM/LTI/xAPI, discussions and moderation, AI pipeline / outbox / content-asset system.

## Constraints
- Reminders are in-app only: there is no server-side email provider. Adding one is a separate decision.
- Server changes must stay compatible with the extension in review (1.4.4). Screens inside Gmail change only after the next batched extension update.
- Nothing here changes the extension manifest, so no new Chrome Web Store review.


## Follow-ups (done)
- **Email reminders via Resend.** Learning-due, CE and licence-expiry reminders are also emailed (en / fr-CA by the person's language), unless the person turns off "Email reminders" on their Notifications page. Needs `RESEND_API_KEY` (and optionally `MAIL_FROM`, default `PII by Punjab Insurance <reminders@punjabinsurance.co>`; the sending domain must be verified in Resend). With no key, reminders stay in-app only.
- **Fourth starter course:** Handling client money (draft, en + fr-CA, counsel review needed).
- **Unicode PDF certificates:** Gurmukhi, Devanagari and accented Latin names print with Noto fonts (no more redirect to the printable page).
- **Quiz rules in the editor** (pass mark, max attempts, wait between tries) and **managers can give a learner extra attempts**.
