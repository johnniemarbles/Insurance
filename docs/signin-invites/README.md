# Sign-in across Canada and the US, and invitations with Gmail and web links

This change fixes two things:
- The PII mark in Gmail sent everyone to whichever country the browser last used.
- An accepted invitation led to the home page, with no way into the web app and no Chrome Web Store link.

Audit and plan: "PII sign-in and invites across Canada and US: audit and plan" (project doc `claude/signin-regions-audit.md`).

## Server (ships with a Railway deploy)

| What | Where |
| --- | --- |
| Sign-in returns to the page it started from (`next`, only `/app`, `/install` or `/guide` on the same server). The web app signs in with `next=/app`. | `routes-auth.ts`, `countries.ts` `safeNext` |
| A Google account with no user in this country is sent once to the other country's sign-in, with the same account suggested (`fb=1`). If that country has none either: "isn't invited in Canada or the United States". The two servers never share who their users are. | `routes-auth.ts` |
| Every refused sign-in is logged with its reason (`sign-in refused`, `reason`). | `routes-auth.ts` |
| The error page's switch button starts sign-in on the other country, and it explains an already-linked Google account and turned-off access. | `routes-pages.ts` `/login` |
| The signed-in and welcome page names the country, offers **Add PII to Gmail** (the store) and **Open PII** (the web app), and shows "Added to Gmail" once the extension checks in. | `routes-pages.ts` `signedInPage` |
| The invitation page names the country. | `routes-pages.ts` `/accept` |
| Home pages: a country's home has **Sign in to PII** (to `/app`). punjabinsurance.co has **Sign in: Canada** and **Sign in: United States**. Both link the store. | `routes-pages.ts` |
| Invitation emails name the country and offer the store and the web app, both in the partner onboarding email and in the email sent from the inviter's Gmail (`GET /v1/access-links`). | `partner-invite.ts`, `people.tsx` |
| `/install` points to the Chrome Web Store for anyone. The zip download is retired (410) once the store link is set. Gmail copies from the old zip see a banner asking them to switch. | `routes-extension.ts`, `app.tsx` |
| Someone using only the web app reads and accepts the privacy notice there, instead of being told to open Gmail. | `app.tsx` `ConsentGate` |
| The PII page in Gmail, when signed out, shows **Sign in: Canada / Sign in: United States**. If the person is already signed in to the other country, it switches there. | `app.tsx` `SignIn` |

### Settings (Railway, both projects)

| Variable | Value |
| --- | --- |
| `PII_EXTENSION_URL` | `https://chromewebstore.google.com/detail/bbfccaiemeckdhajpejacckieamdbajm` |
| `EXTENSION_ORIGINS` | includes `chrome-extension://bbfccaiemeckdhajpejacckieamdbajm` |
| `PII_ORIGIN_CA`, `PII_ORIGIN_US` | optional; default from the `ca.`/`us.` address (`https://ca.punjabinsurance.co`, `https://us.punjabinsurance.co`) |

`GOOGLE_FAKE=1` turns on a stand-in Google for browser walkthroughs. It only works with `APP_ENV=dev` and an `http://`
address, so it can never run on the real `https://` servers.

## Extension 1.7.0 (Chrome Web Store)

| What | Where |
| --- | --- |
| Signed out, the PII mark opens **Sign in: Canada / Sign in: United States**. | `web/src/header.tsx` |
| The country is kept per Gmail account on this computer (`chrome.storage.local` `regionByAccount`). The old browser-wide value counts until an account has its own. | `content.ts` |
| The country is saved only after a sign-in works: the tab reaches `?signed_in=1` on whichever country let the person in. The tab then closes (a new invitation's welcome page stays open) and Gmail redraws at once. | `background.ts` |
| On install and on update, the extension finds the country each person is already signed in to. A new partner who has just accepted never picks one, and a browser stuck on the wrong country is put right. | `background.ts` `onInstalled` |
| The Options "Server address" is for development builds only (`PII_DEV_BUILD=1`). | `options.ts`, `build.mjs` |
| Permissions unchanged (freeze check passes). The store upload now defaults to the approved listing `bbfccaiemeckdhajpejacckieamdbajm`. | `manifest.json`, `store-publish.mjs` |

## Evidence

- **API tests:** `apps/api/test/signin-regions.test.ts` (8) runs two servers with their own databases. It covers:
  - return pages, with outside addresses refused
  - US-only and neither-country accounts
  - the error page
  - invitation to welcome page, then the install shown
  - the store install page, the zip retired, and zip copies detected
  - the home pages
- **Extension tests:** `apps/extension/test/background.test.ts` (4) covers:
  - found on install
  - saved only after success, with the other country's fallback kept
  - welcome tabs left open
  - the server address ignored in store builds
- **Browser walkthrough:** `bash tests/uat/signin-invites/run.sh`, on two servers. The script checks both databases.

| Screen | File |
| --- | --- |
| A US partner opens the Canada web app and lands in the US one (privacy notice accepted in the web app) | `screens/1-fallback-to-us.png` |
| The invitation page names the country | `screens/2-invitation.png` |
| After Accept: Add PII to Gmail, or Open PII in the browser | `screens/3-welcome.png` |
| Invited in neither country | `screens/4-neither-country.png` |
| The install page points to the Chrome Web Store | `screens/5-install.png` |
