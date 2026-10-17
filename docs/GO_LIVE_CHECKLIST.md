# Go-live checklist (owner tasks)

Things only the account owner can do. Each is short. Tick them off in order.

## 1. AWS: rotate the vault key (the old one appeared in a chat)
1. AWS Console > IAM > Users > the vault user > Security credentials > **Create access key** (use case: application running outside AWS). Keep the page open: the secret is shown once.
2. Railway > pii-ca project > the API service > Variables: set `VAULT_AWS_ACCESS_KEY_ID` and `VAULT_AWS_SECRET_ACCESS_KEY` to the new pair. Railway redeploys by itself.
3. In PII: Compliance > Archive vault. Click **Archive now**, then **Verify copy** on the existing document. It must say "The copy is intact."
4. Only then: back in IAM, set the old key to **Inactive**, wait a day, then **Delete** it.
5. Check the vault user's policy: it should allow only the vault bucket (`s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObjectRetention`, `s3:GetObjectRetention`, `s3:ListBucket`), and nothing else.

## 2. AWS: protect the root account
Console > account menu > Security credentials > **Assign MFA device** on the root user (authenticator app or hardware key). Do not create root access keys. Use a named admin user for daily work, also with MFA.

## 3. Database backups
Railway > each Postgres service > Backups: confirm automatic backups are on and note the retention. Take a manual backup before turning real users on. (Signed paperwork is also in the vault, but clients, notes and pipelines are only in Postgres.)

## 4. Email sending
Resend shows `punjabinsurance.co` verified. Real client emails go out from `notifications@punjabinsurance.co`. Test with your own address before inviting users. An address that bounces is suppressed by Resend afterwards: fix the typo and remove the suppression in Resend > Suppressions.

## 5. Adobe Acrobat Sign (waiting on Adobe)
When Adobe approves API access: Compliance > Vendors > Adobe: enter the access point, client id, client secret and refresh token, save, confirm "Connected". Then send one beneficiary designation from the Advice tab to your own email, sign it, and click **Check**. Tell Claude when you do and it will watch the logs.

## 6. Decisions for counsel
- Vault lock: `GOVERNANCE` (can be overridden by a privileged AWS user) or `COMPLIANCE` (cannot be undone). Switch `VAULT_LOCK_MODE` only after counsel confirms.
- Continuing-education grace periods, privacy and consent wording, French wording of starter courses, retention periods, and the purge job.
- AI assistance: data can leave the region when a company admin turns AI on. Get counsel sign-off on the cross-border wording before real Canadian users use AI.
- US items: see US_COMPLIANCE.md.

## 7. Before real Canadian users (approved US-hosting path)
- **Decision:** Canadian tenants may use US infrastructure, subject to safeguards and applicable legal/contractual requirements. See [Canadian US-hosting safeguards](CANADA_US_HOSTING_SAFEGUARDS.md). Do **not** claim physical Canadian residency.
- Keep logical `REGION=ca-qc` for Canadian tenant isolation; set `HOSTED_IN=us` only after checking existing values and recording the actual host. Do not mark `PHYSICAL_REGION_VERIFIED=true` as Canadian-location evidence.
- Verify English and French Canadian privacy pages disclose US hosting and cross-border processing accurately, including relevant service providers; obtain privacy/legal approval before enabling `RESIDENCY_ACKNOWLEDGED=true`.
- Complete the independent migration 0130, forced RLS, tenant-wall, and zero-drift SQL checks in both databases. Record outputs and reviewer.
- Verify vault bucket region, backups, encryption and keys, least-privilege access, incident response, retention, deletion, and customer/processor terms. Rotate previously exposed vault credentials as required by step 1.
- Replace `LOCAL_KEYS` with approved KMS-backed field encryption before real client PII is stored, as required by the existing security plan.
- Confirm custom domain `app.punjabinsurance.co` routing and test cross-border disclosure in both supported languages.
- **Release hold:** A hosting decision alone does not certify safeguards; do not enable real Canadian customer data until documented gates are signed off.

## 8. Demo company on the Canadian server
- Railway > pii-ca API service > Variables:
  - `SEED_DEMO=true` creates/keeps the demo company at deploy.
  - **`DEMO_RESET`:** in **prod**, only `DEMO_RESET=confirm` wipes demo CRM data ( `DEMO_RESET=true` is ignored so a leftover flag cannot reset every deploy). In non-prod, `DEMO_RESET=true` still rebuilds. Always **remove** `DEMO_RESET` after a one-shot rebuild.
- After a deploy, sign in as the demo admin once and confirm the company is still there if you did not intend a reset.

## 9. Chrome extension review
- Do not change anything under `apps/extension` while the package is under Chrome Web Store review.
- Keep the listed extension endpoints backward-compatible on the live hosts until review finishes.
- After approval or rejection, a new extension version needs its own review if the package changes.
