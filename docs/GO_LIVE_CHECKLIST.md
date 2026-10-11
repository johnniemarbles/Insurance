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

## 7. Before real Canadian users (residency and keys)
- Confirm `REGION=ca-qc` on the Canadian Railway service and that `DATA_COUNTRY` is unset or `CA` (the app refuses a mismatch in staging/prod).
- Confirm the privacy page (EN and fr-CA) says data is held in Canada — open `/privacy?lang=fr` on the live Canadian host.
- Move the Canadian stack to a Montréal region host when ready; set physical region verified in `deployment_info`.
- Replace `LOCAL_KEYS` with KMS-backed field encryption before storing real client PII at rest.
- Custom domain `app.punjabinsurance.co` routed to the two regional stacks.

## 8. Demo company on the Canadian server
- Railway > pii-ca API service > Variables: if `DEMO_RESET` (or equivalent) is **on**, each deploy resets the demo company. Switch it **off** before any real demo users you want to keep.
- After a deploy, sign in as the demo admin once and confirm the company is still there if reset is off.

## 9. Chrome extension review
- Do not change anything under `apps/extension` while the package is under Chrome Web Store review.
- Keep the listed extension endpoints backward-compatible on the live hosts until review finishes.
- After approval or rejection, a new extension version needs its own review if the package changes.
