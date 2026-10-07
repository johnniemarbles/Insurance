# LMS plan, drawn from Expadio

Source: the Expadio LMS (private repo, read only). Goal: take what fits PII's multi-tenant, node-based model; skip the rest.

## Take
1. **Licence / CE status and 30/60/90 forecast, plus daily learner reminders.** Status derived from dates (valid → expiring → expired). **Done**: `packages/domain/src/forecast.ts`, `GET /v1/compliance/calendar`, "Coming up" on the Compliance page, `sweepLearnerReminders` (course due in 7 days / late; CE at risk / overdue once per term), migration 0033 `reminder_marks`, notification kinds `learning_due` and `ce_reminder` (en and fr-CA), settings `notify.learning_due`, `notify.ce_reminder`.
2. **This plan saved in docs.** Done.
3. **Versioned courses.** **Done**: publishing freezes a version (`course_versions`, immutable by trigger, migration 0034). A published course's lessons and quizzes are locked; unpublish, edit, republish releases version N+1 only if content changed. Learners who have not finished move to the new version; finished learners stay on the version they completed (`outdated` flag in `/v1/my/learning`). `GET /v1/courses/:id/versions` lists history. Not done: learners cannot keep reading version N while an author edits N+1 (unpublishing hides the course meanwhile).
4. **Assignment rules with preview.** **Done** (migration 0035): a rule covers a branch, optionally only one role, with a fixed due date or "N days after joining". `POST /v1/courses/:id/assignments/preview` shows who would be enrolled without saving; `GET .../assignments` lists rules; a 10-minute background pass re-applies every rule so people who join a branch later are enrolled too.
5. **Assessment attempt rules.** Pass mark, max attempts, cool-down, per-attempt record.
6. **Learner player: lock and resume.** Ordered lessons, resume where left off.
7. **Certificate verify page and PDF.** Public verification by code; printable PDF.
8. **Optional enrollment requests.** Learner asks, manager approves.
9. **Starter course content.** Written fresh (Expadio has none), reviewed by counsel.

## Skip
Competency frameworks, SCORM/LTI/xAPI, discussions and moderation, AI pipeline / outbox / content-asset system.

## Constraints
- Reminders are in-app only: there is no server-side email provider. Adding one is a separate decision.
- Server changes must stay compatible with the extension in review (1.4.4). Screens inside Gmail change only after the next batched extension update.
- Nothing here changes the extension manifest, so no new Chrome Web Store review.
