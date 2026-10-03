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

## Phase 2 — Gmail side (next)
- [x] Chrome extension scaffold (InboxSDK, Manifest V3): sign-in, privacy notice, create box + contact from an email, move stages (EN / fr-CA) — needs a real-Chrome check
- [x] Sidebar: shows the box for a thread, stage, notes and tasks (needs real-Chrome check)
- [x] Link a conversation to a box: notice accepted first, content captured from the person's own Gmail tab, encrypted, deleted on unlink (no Gmail API scopes needed)
- [ ] Gmail API connection (only if we later want reminders, sync of new replies, send-later)

## Phase 3 — Learner portal / LMS
- [ ] Courses, modules, lessons, assignments by node, progress, quizzes, certificates
- [ ] Self-hosted video, captions

## Go-live gates (before any real Canadian user)
- [ ] Custom domain app.punjabinsurance.net and routing to the two regional stacks
- [ ] Move the Canadian stack to a Montréal region (AWS / Azure / GCP)
- [ ] Counsel review of privacy notice; Google OAuth verification package
- [ ] KMS-backed encryption keys
