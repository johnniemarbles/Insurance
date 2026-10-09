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
- US items: see US_COMPLIANCE.md.
