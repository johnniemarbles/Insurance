# Disaster recovery and backups

SOC 2 Availability criteria (A1.2, A1.3), and finding L-04 of the 21 October 2026 code review. The owner is Sanjeev Sood. Review this
runbook once a year and after every real incident.

## Targets (confirmed by the owner, 21 October 2026)

| Target | Value | Meaning |
| --- | --- | --- |
| Recovery time (RTO) | 4 hours | A country server is back within 4 hours of an outage being declared |
| Recovery point (RPO) | 24 hours | At most one day of data is lost in the worst case |
| Signed paperwork | 0 loss | Kept in each country's S3 vault with Object Lock, outside Railway |

## What runs where

| Part | Canada | United States | Holds |
| --- | --- | --- | --- |
| App server | Railway project `pii-ca`, service `api` | Railway project `pii-us`, service `api` | Nothing permanent: rebuilt from GitHub `main` |
| Database | Railway `pii-ca` Postgres | Railway `pii-us` Postgres | Clients, deals, notes, compliance records, users |
| Vault | Canada S3 bucket (Object Lock) | US S3 bucket (Object Lock) | Signed paperwork and archived client files |
| Sign-in | Google | Google | Sign-in only |
| Email | Resend | Resend | Messages in flight |
| Extension | Chrome Web Store, item `bbfccaiemeckdhajpejacckieamdbajm` | Same | Code only |
| Code | GitHub `johnniemarbles/PII` | Same | Everything needed to rebuild a server |

## Backups

1. **Database (Railway volume backups):** turned on 21 October 2026 for both Postgres services, with a manual backup taken the same day. Check monthly in each Postgres service's **Backups** tab that they are still on.

   | | Canada (`pii-ca`) | United States (`pii-us`) | Kept |
   | --- | --- | --- | --- |
   | Daily | 08:29 UTC | 06:28 UTC | 6 days |
   | Weekly | Saturday 03:09 UTC | Saturday 09:03 UTC | 27 days |
   | Monthly | 1st, 22:46 UTC | 1st, 17:17 UTC | 89 days |

   The daily backup meets the 24-hour RPO. These are snapshots of the 50 GB database volume, kept inside the same Railway account,
   so they cover mistakes and corruption but not the loss of the Railway account or region (step 2).
2. **A copy outside Railway** (to build): a nightly encrypted `pg_dump` of each country's database to that country's S3 bucket, kept 35 days. Until it exists, a Railway account or region failure could lose more than the RPO.
3. **Before risky changes:** take a manual Railway backup before a large migration, a demo reset in production, or any manual data fix.
4. **Secrets:** keep every Railway variable in a password manager the owner controls, with `COOKIE_SECRET` and `LOCAL_KEY_SECRET` (or the KMS key once moved). Without `LOCAL_KEY_SECRET`, encrypted fields such as documents and email bodies cannot be read, even from a good backup.

## Scenarios

| What happened | Do this |
| --- | --- |
| A country server is down or crashing | Railway shows the failing deployment: **Redeploy** the last good one (deployments list, Rollback). Check `/readyz` on that server. |
| A bad release | Roll back in Railway to the previous deployment, then revert the merge on GitHub so the next deploy does not bring it back. |
| Data deleted or corrupted by mistake | Stop writes if needed (scale the api service to 0). Restore the latest good Railway backup into a new Postgres service, compare, then point `DATABASE_URL`, `APP_DATABASE_URL` and `AUTH_DATABASE_URL` at it and redeploy. |
| Railway region or account unavailable | Create a new Railway project, or another host, from GitHub `main`. Restore the latest database copy from S3 (step 2 above), set the saved variables and redeploy. Change the DNS for `ca.` or `us.punjabinsurance.co` at GoDaddy. |
| A secret leaked | Rotate it at the source: Google client secret, Resend, Stripe, AWS keys, OpenAI, Gemini and Anthropic keys. Then update Railway and redeploy. Rotating `COOKIE_SECRET` signs everyone out. Never rotate `LOCAL_KEY_SECRET` without re-encrypting first. Follow the incident response policy for notices. |
| Google sign-in is down | No workaround: users wait. Never turn on `DEV_AUTH` in production; PII refuses to start if you try. |
| The Chrome Web Store copy is broken | The PII screens come from the server, so most fixes ship with a server deploy. Shell fixes need a new version through the store workflow. Users can work in the browser at `/app` meanwhile. |

## Restore check after any recovery

1. `GET /readyz` on the server answers `ok` with the right region.
2. Data walls are intact. In the database, `SELECT * FROM rls_drift;` returns no rows.
3. Sign in through Gmail and the web app, open a deal, and open a signed document from the vault.
4. Record the incident: start time, detection, recovery time, data lost (if any), cause, and follow-ups.

## Restore test (every quarter)

Restore the latest backup of one country's database into a scratch Postgres service, then run steps 2 and 3 above against it. Record the result below and delete the scratch service.

| Date | Country | Backup taken at | Time to restore | Checks passed | By |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
