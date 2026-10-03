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
- [ ] Get notified, mail-merge automation, native integrations, Transfer Data, API keys
