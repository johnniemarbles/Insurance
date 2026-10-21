# Publishing the PII extension to the Chrome Web Store

The `extension-store` GitHub Action builds the extension, checks it, uploads it to the Chrome Web Store and submits it for review.
It runs when `apps/extension/public/manifest.json` changes on `main` (bump `"version"` to release), or by hand from
**Actions → extension-store → Run workflow** (with a dry-run option and a choice to stage the release).

- **Google still reviews every version.** The Action replaces the manual upload, not the review.
- It never re-sends a version the store already has (published or in review).
- Since 1.5.0, most PII screens load from the server, so a normal Railway deploy updates them in Gmail.
  A new extension version is only needed for the side panel, the top-bar mark and bell, the left-panel shell, the
  Snippets button, the frame bridge, or manifest changes.

## Signing in to Google without a key file

The Google Cloud organisation blocks service account key files (`iam.disableServiceAccountKeyCreation`). Keep it that way.
The Action uses **Workload Identity Federation** instead: for each run, GitHub proves to Google that it is this repository's
workflow on `main`, and Google hands back a short-lived token (15 minutes) for a service account allowed to publish.
No secret is stored in GitHub.

### One-time setup (Google Cloud Shell)

Use the Google Cloud project that will own the publishing identity. Replace `PROJECT_ID`.

```bash
PROJECT_ID=your-project-id
REPO=johnniemarbles/PII
SA=pii-store-publisher@${PROJECT_ID}.iam.gserviceaccount.com

# APIs: the Web Store API, plus the ones that let GitHub swap its token for a short-lived Google one.
gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

# The publishing identity (no key is ever created for it).
gcloud iam service-accounts create pii-store-publisher --display-name "PII Chrome Web Store publisher" --project "$PROJECT_ID"

# A pool for GitHub, and a provider that only accepts this repository's main branch.
gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions" --project "$PROJECT_ID"
gcloud iam workload-identity-pools providers create-oidc pii-repo \
  --location global --workload-identity-pool github --project "$PROJECT_ID" \
  --display-name "PII repository" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'"

# Let that repository act as the publishing identity.
POOL=$(gcloud iam workload-identity-pools describe github --location global --project "$PROJECT_ID" --format "value(name)")
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/${POOL}/attribute.repository/${REPO}"

# The value for the CWS_WIF_PROVIDER variable:
gcloud iam workload-identity-pools providers describe pii-repo --location global --workload-identity-pool github --project "$PROJECT_ID" --format "value(name)"
echo "CWS_SERVICE_ACCOUNT: $SA"
```

If an organisation policy also limits workload identity providers (`iam.workloadIdentityPoolProviders`), an organisation
policy administrator must allow `https://token.actions.githubusercontent.com`.

### Chrome Web Store developer dashboard

1. Sign in with the company publisher account that owns the PII listing.
2. **Account** → add the service account email (`pii-store-publisher@…`). One service account per publisher.
3. Note the **publisher ID**.
4. If the listing's visibility was ever changed by hand, publish once by hand before the API can publish.

### GitHub repository settings

**Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | publisher ID from the dashboard |
| `CWS_WIF_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/pii-repo` |
| `CWS_SERVICE_ACCOUNT` | `pii-store-publisher@<project>.iam.gserviceaccount.com` |
| `CWS_ITEM_ID` | optional; defaults to `bbfccaiemeckdhajpejacckieamdbajm` |

Optional: **Settings → Environments → `chrome-web-store` → Required reviewers** to approve every upload by hand.

Until the variables are set, the Action still runs its checks and builds the package (attached to the run), but uploads nothing.

## Try it

**Actions → extension-store → Run workflow**, tick *dry run* first, then run it for real. The run summary shows the version
submitted and the store state. Locally: `cd apps/extension && node store-publish.mjs --dry-run`.

## Notes

- Staged rollout by percentage is only offered by the store above 10,000 weekly users.
- "Skip review" in the store applies only to ad-blocking rule updates; it does not apply to PII.
- The install-page zip (`pack.mjs`, fixed key, ID `egdeindkmifjmbdfgkmbhgpddopkbpbe`) does not auto-update. Partners who
  installed it by hand should move to the store listing.
