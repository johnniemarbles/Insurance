# Google OAuth consent screen: answers to paste

Google Cloud Console > APIs & Services > OAuth consent screen (the app's "Google Auth Platform").
Do this once for the project that owns the OAuth client. Both country servers share one client.

## 1. What the app asks Google for

Sign-in only. No Gmail API, no Drive, no Calendar.

| Scope | Shown by Google as | Class |
|---|---|---|
| `openid` | Associate you with your personal info on Google | Non-sensitive |
| `.../auth/userinfo.email` | See your primary Google Account email address | Non-sensitive |
| `.../auth/userinfo.profile` | See your personal info, including any personal info you've made publicly available | Non-sensitive |

Because every scope is non-sensitive, the app does not need Google's sensitive-scope verification or the restricted-scope security assessment (the expensive one for apps that read Gmail through the API). Google may still ask for brand verification (app name, logo, domains); the answers below cover it.

Why there is no Gmail scope: the Chrome extension shows the PII panel inside the Gmail page and reads the conversation the person has open, in their own browser, only when they choose to link it. It does not call the Gmail API and the server never has access to the mailbox.

## 2. App information

| Field | Answer |
|---|---|
| User type | External |
| App name | PII by Punjab Insurance |
| User support email | support@punjabinsurance.ca |
| App logo | `brand/icon-128.png` (square; Google wants 120x120 to 1000x1000, under 1 MB) |
| Developer contact email | privacy-officer@punjabinsurance.ca (or your own; Google writes here about review) |

## 3. App domain

| Field | Answer |
|---|---|
| Application home page | https://ca.punjabinsurance.co/support  (must be a live public page about the app; replace with your marketing page on punjabinsurance.ca if it describes the app) |
| Application privacy policy link | https://ca.punjabinsurance.co/privacy |
| Application terms of service link | https://ca.punjabinsurance.co/terms |
| Authorized domains | punjabinsurance.co |

Notes:
- Google requires the home page, privacy and terms links to sit on an authorized domain. All three are on `punjabinsurance.co`, so only that domain is needed. Add punjabinsurance.ca and punjabinsurance.com only if you point those links at the country websites instead.
- Verify domain ownership of `punjabinsurance.co` in Google Search Console with the same Google account that owns the Cloud project (add a DNS TXT record, like you did for Railway).
- The privacy policy already contains Google's required statement that use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements.

## 4. Scopes screen

Add: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else. If a justification box appears, paste:

> PII signs invited users in with their Google account. We read only the user's name and email address, to match them to the invitation their administrator sent and to show who they are signed in as. We do not request access to Gmail, Drive, Calendar or any other Google data, and we do not use Google user data for advertising.

## 5. OAuth client (already set up; double check)

Credentials > OAuth 2.0 Client ID (Web application):

- Authorized JavaScript origins: not needed (server-side flow).
- Authorized redirect URIs, exactly:
  - https://ca.punjabinsurance.co/auth/google/callback
  - https://us.punjabinsurance.co/auth/google/callback
- Remove any old `up.railway.app` redirect URIs once nobody uses them.

## 6. Publish

1. OAuth consent screen > Audience > **Publish app** (moves from Testing to In production).
2. Until then, only listed test users can sign in and Google caps refresh tokens at 7 days.
3. With only non-sensitive scopes the app is usually live right away. If Google asks for brand verification, expect a short wait and an email to the developer contact above.

## 7. What a reviewer may ask, and the honest answers

- *Why does an app that works in Gmail not use Gmail scopes?* The extension runs in the user's browser and reads the open conversation locally when the user links it; the server receives only what the user chooses to link.
- *What do you store?* Name, email and sign-in details; the conversations a user explicitly links (encrypted at rest); CRM records the user creates. See the privacy policy.
- *Where is data stored?* On secure servers in the United States (disclosed to Canadian users in the sign-in notice and the privacy policy).
- *Is it public?* No. It is invitation-only; access requires an invitation from the user's organization administrator.
- *Do you sell data or use it for ads?* No.

## 8. Chrome Web Store link-up

The Chrome Web Store listing (see `STORE_LISTING.md`) uses the same privacy policy URL. Keep the two identical.
