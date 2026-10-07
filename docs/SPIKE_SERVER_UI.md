# Spike: serving the PII UI from the server inside Gmail (2026-10-07)

Goal: UI changes ship from the server so the extension rarely needs a Chrome Web Store upload.

Method: headless Chromium with a test extension, a stand-in "Gmail" page with a strict CSP (`frame-src https://*.google.com 'self'`) and a stand-in PII server on a different site. Not tested against real Gmail.

| Test | Result |
|---|---|
| iframe created by page script | Blocked by the page CSP (control) |
| iframe created by the extension's content script | Loads despite the page CSP |
| iframe of an extension page that frames the server | Loads |
| Session cookie `SameSite=Lax` inside the iframe | Not sent: user looks signed out |
| Session cookie `SameSite=None; Secure` inside the iframe | Sent |

## Challenges
1. Cookie: today's session cookie is Lax. In an iframe it needs `SameSite=None` (weakens built-in CSRF defence: add Origin check or CSRF token), and Incognito/third-party-cookie blocking would still break it. Safer: the extension's service worker fetches a short-lived embed token from the server and hands it to the frame.
2. `/app` has no `frame-ancestors`: lock it to Gmail and the extension before embedding.
3. A fixed message bridge (open thread, recipients, capture, compose, nav) becomes the frozen contract between extension and server UI.
4. Policy risk: Chrome may judge a shell that only frames a website a thin wrapper, or flag remote UI. Not verifiable without submitting.
5. Real Gmail CSP and InboxSDK sidebar sizing were not tested.
