# PII Chrome extension (Gmail sidebar)

Manifest V3 + InboxSDK. Adds a "PII" panel beside an open conversation:
sign in with Google, accept the privacy notice (first time), create a box (and a contact from the sender) from the email, and move recent boxes between stages.

## Build and load
```
npm install                      # from the repo root
cd apps/extension
INBOXSDK_APP_ID=sdk_yourid PII_API_BASE=https://your-api-host npm run build
```
Chrome → `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`.

## One-time setup
1. Register the app at https://www.inboxsdk.com/ to get an App ID (free) and pass it as `INBOXSDK_APP_ID`.
2. Copy the extension's origin (`chrome-extension://<id>`) from `chrome://extensions` into the server variable `EXTENSION_ORIGINS` (comma separated). Without it the server refuses writes from the extension (CSRF guard). To keep the id stable between builds, add a `key` to the manifest before publishing.
3. The server address can be changed in the extension's options page.

## Where the screens come from (1.5.0+)
The full-page PII screens (Home, Pipelines, Compliance, Partners, Commercial, Training, Settings…) are loaded from the server
(`<server>/app?embed=1`) in a frame, so **every server deploy updates them in Gmail with no Web Store update**.
The extension passes the frame a short-lived token (`/v1/embed-token`) and bridges the few things only it can do:
Gmail compose (mail merge, invitations), the country switch, sign-in, left-panel navigation, and calls to the other country's server.
If the frame does not load within 15 seconds the copy built into the extension is shown instead; Options has a troubleshooting
switch to always use the built-in copy.

Still built into the extension (changing these needs a new store version): the conversation side panel, the PII mark and bell
in Gmail's top bar, the left-panel shell and icons, the compose Snippets button, and the bridge itself.

## Privacy
The panel reads only the subject and first sender of the open conversation. Nothing is sent until the person clicks Create. The session cookie stays in the browser's cookie jar and is used by the background worker only; Gmail's page never sees it.

## Not yet built
Linking a whole thread to a box (cached content for linked threads only), notes and tasks in the panel, Gmail connection and sync, compose features.
