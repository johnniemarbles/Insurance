# LMS plan, drawn from Expadio

Source: the Expadio LMS (private repo, read only). Goal: take what fits PII's multi-tenant, node-based model; skip the rest.

## Take
1. **Licence / CE status and 30/60/90 forecast, plus daily learner reminders.** Status derived from dates (valid → expiring → expired). **Done**: `packages/domain/src/forecast.ts`, `GET /v1/compliance/calendar`, "Coming up" on the Compliance page, `sweepLearnerReminders` (course due in 7 days / late; CE at risk / overdue once per term), migration 0033 `reminder_marks`, notification kinds `learning_due` and `ce_reminder` (en and fr-CA), settings `notify.learning_due`, `notify.ce_reminder`.
2. **This plan saved in docs.** Done.
3. **Versioned courses.** Publish makes a version immutable (DB trigger); enrollments pin the version they started on.
4. **Assignment rules with preview.** Rule by node / role; show who would be enrolled before saving.
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
