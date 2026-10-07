# Extension freeze: what must not change without a Chrome Web Store review

Every upload is reviewed. These items also risk an in-depth review or a "please accept new permissions" prompt for every user. They are locked in `apps/extension/freeze.json` and checked by `npm run check:freeze`, which fails the build when they drift.

## Locked (changing any of these needs a deliberate, batched release)
- `permissions`: storage, scripting
- `host_permissions`: https://mail.google.com/*, https://*.punjabinsurance.co/*
- content script matches: https://mail.google.com/*
- `content_security_policy`, `options_ui`, `web_accessible_resources`
- Listing: single purpose, privacy-practices data categories (personal communications, PII, authentication, user activity, files), privacy policy URL, Limited Use statement
- Every server the extension talks to must be under `*.punjabinsurance.co`

## Ships from the server (no upload)
API responses, pipelines, templates, settings, nav (`/v1/nav`), rule packs, courses, AI features, permissions, copy that comes from the API.

## Needs an upload (batch these, aim for one release a month)
Anything under `apps/extension/src` and `apps/web/src` (the UI is bundled into the extension), InboxSDK upgrades, new Gmail UI hooks.

## Rules
1. Never add a permission, host or match pattern in a normal release. If a feature needs one, park it for the next batched release.
2. Never load or evaluate code fetched at runtime.
3. Raise `MIN_EXT_VERSION` only for security or data-correctness fixes.
4. New data kinds (for example health or financial fields) must be inside the declared categories before they ship.
