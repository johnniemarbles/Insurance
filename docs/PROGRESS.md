# PII build progress

Legend: [x] done · [~] in progress · [ ] not started

## Phase 0 — Foundation
- [x] Monorepo, config guards, migrations, Postgres row-level security (92 isolation checks)
- [x] Org graph: Tenant > Location > Partner > Sub-partner (5 levels), invitations, audit log
- [x] Google sign-in (OIDC + PKCE), sessions, CSRF guard, first-login privacy notice (EN / fr-CA)
- [x] Railway dev stacks (US and "CA" synthetic-only), CI, Docker
- [x] Branding: "PII by Punjab Insurance" logo and icons

## Phase 1 — CRM core (API)
- [x] 1. Pipelines, stages, custom fields (`/v1/pipelines`)
- [x] 2. Boxes: create, list, move stage, edit, delete, contact links (`/v1/boxes`)
- [x] 3. Contacts and accounts (`/v1/contacts`, `/v1/accounts`)
- [x] 4. Notes and tasks (`/v1/boxes/:id/notes`, `/v1/tasks`)
- [x] 5. Tests (56 passing) and deploy

Rules proven by tests: siblings never see each other; ancestors see downward but cannot edit;
a partner serving several locations must say which location a record is for; every partner role (including learner and trainer) can use both CRM and LMS; only admins/managers define pipelines.

## Phase 1B — Pipeline UI (Streak-style, built better) — plan shared as a document
- [x] 1 Foundation: stage/column edit APIs, stage history, counts; web app; Gmail left-menu page
- [x] 2 Pipeline page: stage bar, table, filters, hierarchy switch, record panel
- [x] 3 Board view (drag and drop), bulk move  · [x] saved views, stuck + owner filters
- [x] 4 Edit-pipeline drawer, insurance templates (4), colour themes
- [x] 5 Streak/spreadsheet import (records + contacts), reminders, notes, last-email columns  · [x] CSV export, contacts page
- [x] 6 Keyboard, fr-CA, accessibility pass (focus, contrast, labels), speed test (20,000 records ≈ 0.25 s)  · [ ] partner usability test

## Phase 2 — Gmail side
- [x] Chrome extension scaffold (InboxSDK, Manifest V3): sign-in, privacy notice, create box + contact from an email, move stages (EN / fr-CA) — needs a real-Chrome check
- [x] Sidebar: shows the box for a thread, stage, notes and tasks (needs real-Chrome check)
- [x] Link a conversation to a box: notice accepted first, content captured from the person's own Gmail tab, encrypted, deleted on unlink (no Gmail API scopes needed)
- [ ] Gmail API connection (only if we later want reminders, sync of new replies, send-later)

## Phase 3 — Learner portal / LMS
- [x] Courses, lessons (reading, link, video link, quiz), assignment to a node and everyone beneath, progress, quizzes (answer key server-side), certificate codes, Quebec French-before-publish rule, learner + author screens
- [ ] Certificate PDF, reminders by email, SCORM, modules UI
- [ ] Self-hosted video, captions

## Go-live gates (before any real Canadian user)
- [ ] Custom domain app.punjabinsurance.net and routing to the two regional stacks
- [ ] Move the Canadian stack to a Montréal region (AWS / Azure / GCP)
- [ ] Counsel review of privacy notice; Google OAuth verification package
- [ ] KMS-backed encryption keys


## Pipeline plan v2 (Streak parity + trends)
Plan doc: Claude Docs "PII – Pipeline Plan: Streak parity + modern CRM".
- [x] Phase A: unified filter/sort/group bar, chips, multi-stage and owner filters, email-age filters, stacked sorts, group-by sections with totals, quick add, first-run checklist, kebab menu, Alt+R
- [x] Phase B: column picker and order, automatic columns (freshness, last interaction, email, task and note counts), owner avatars, inline editing with undo, frozen name column
- [x] Phase C: pie, column and weekly charts, Reports (funnel, win rate, forecast, by owner), Newsfeed, Ctrl/Cmd+K command palette
- [x] Phase D (part 1): stage-entry automations, required fields per stage, shared team views
- [ ] Phase D (part 2): snippets, send later, mail merge (Gmail compose integration)
- [ ] Phase E: AI and opt-in tracking

## Integrations & Automation (done)
- [x] Capture from forms: hosted public form per pipeline (honeypot, rate limit, privacy sentence)
- [x] Capture from schedulers/Zapier: private inbound webhook link
- [x] Send to other apps: signed outbound webhooks (HMAC-SHA256, SSRF guard, auto-pause after 10 failures)
- [x] Automate repetitive tasks: stage automations
- [x] More automations: add note, move stage, copy to pipeline, "stale for N days", "first received email"; each acts once per stay
- [x] Recipes catalog: Typeform, Google Forms, Jotform, Calendly (direct); Wufoo, Gravity, Webflow, Facebook, ScheduleOnce, SavvyCal, Calendar (Zapier); Sheets in/out (Apps Script)
- [x] Get notified: in-app weekly summary + `digest.weekly` event + send-test-message for subscribers
- [x] Transfer data: export records/contacts CSV, import, Open in Sheets
- [ ] Mail merge and its automations (needs Gmail compose slice D2), create-box-from-every-new-email (needs Gmail sync), Slack (deferred by choice), API keys

## Phase D2 — Compose tools (done)
- Snippets (private or shared downward), inserted from a "PII snippets" button in Gmail compose.
- Mail merge: token templates with fallbacks, mandatory {{unsubscribe}} (CASL), public /u/:token opt-out, 400/day cap, 6–12 s pacing, sends through the user's own Gmail compose window; Gmail tab must stay open.
- Automation action "add to mail merge" (works with forms/Calendly intake).
- Deferred: send later (needs gmail.send OAuth); reply/view-based merge automations and open tracking (Phase E, need thread sync).

## Phase E1 — Assistant (done)
- Off by default; a company admin switches it on (and separately allows linked email text). Every use is audited.
- Per record: summary, next step, reply draft (en / fr-CA), saved with the record; visible only to people who can see the record.
- "Needs attention" panel: stalled, overdue, past close date, no next step, unowned (plain rules, no AI).
- Needs ANTHROPIC_API_KEY (optional AI_MODEL) on the server. Data goes to Anthropic's API (outside Quebec): get privacy counsel sign-off before real Canadian users.
- Not yet: open tracking, auto-generated alerts by email, thread sync.

## Phase S1–S3 — Settings and left panel (done)
- Layered settings (person / branch / company), locks enforced by a database trigger, history, audit. Registry in packages/domain/src/settings.ts; add a setting there and it appears on the page.
- Settings page (Me, Left panel, Email and compose, Team and company) with search, undo and a live preview of the panel; AI switch moved here.
- Gmail left panel: collapsible PII section built from the person's layout (Home, Pipelines with each pipeline, Contacts, Mail merges, Training, Settings), counts, redrawn when settings change.
- Home ("My day"): tasks due, needs attention, merges in progress, recently updated.
- Not yet: notifications grid, privacy centre, impact line on shared changes, role presets, saved views under each pipeline, Gmail Settings tab injection.

## Phase N1 — Notifications (done)
- In-app notifications (assigned, task, mention, note, stage change, capture, merge done, unsubscribed); per-person filters in Settings > Notifications; unread count in left panel.
- Deferred: email delivery, morning digest, quiet hours (need mail provider), browser notifications.

## Phase P1 — Privacy centre (done)
- Settings > Privacy: what is held about you, JSON export, access / withdraw / erase requests (30-day clock), admin queue to resolve.
- Not automated: erasure itself is done by an admin; no automatic deletion yet.

## Phase O1 — Company, branch and partner setup (done)
- Settings > Company and people (admins only): tree of company/branches/partners, rename, switch off, add branch/partner, invite (copy link), roles, switch person off, withdraw invitation.
- Invitation emails are not sent yet (needs mail provider); link is copied by hand.
- Invitations are sent from the inviter's own Gmail (compose window) when running inside Gmail; link copy is the fallback. Server-sent mail (digest, notifications) via Gmail API needs the Gmail connect + gmail.send OAuth, not built yet.

## Phase O2 — Adding people, invitation status, Activity (done)
- /accept page (was missing: invite links went nowhere), link-opened recorded, accepted + stuck-invite notifications.
- Invitation states: ready, sent, link opened, active, not sent, expired; delivery reported back from the Gmail compose window; resend makes a new link.
- Settings > Company and people: People (list, Add person dialog), Structure, Activity (audit log with filters and CSV, branch-scoped).
- Not verified in real Gmail: sending from the compose window and reporting back.
- Later: Gmail connect + gmail.send for server-sent mail.
