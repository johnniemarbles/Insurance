# PII platform (Phase 0)

Gmail-native CRM + LMS for Punjab Insurance Agency Inc. App: https://app.punjabinsurance.net

## What is here
| Path | What |
| --- | --- |
| `packages/db/migrations` | `0001` schema, `0002` roles and grants, `0003` visibility hardening |
| `packages/domain` | Pure rules: org model, request context, consent notices (EN / fr-CA) |
| `packages/db` | Migration runner, request transaction wrapper (`withRequestTx`), tenant/deployment bootstrap, login lookup |
| `packages/platform` | Config with safety rails, field encryption (AES-GCM) behind a `KeyProvider`, token hashing |
| `apps/api` | Fastify API: health, `/v1/me`, org graph, invitations, audit |
| `tests/isolation` | SQL-level isolation suite (92 checks) against the real migrations |

## Run it locally
```
docker compose up -d db                 # or any Postgres 16 with the roles in infra/init-roles.sql
cp .env.example .env                    # then load it into your shell
npm install
npm run migrate
node packages/db/src/cli.ts bootstrap-deployment --region ca-qc --environment dev
node packages/db/src/cli.ts create-tenant --name "Punjab Insurance Agency Inc" --country CA --admin-email you@example.com
npm run dev
curl -H 'x-dev-user-email: you@example.com' localhost:3000/v1/me
```
Tests: `npm test` (needs `TEST_ADMIN_URL`, a superuser URL; default `postgres://postgres:pw@127.0.0.1:5432/postgres`), `npm run typecheck`, `npm run test:isolation`.

## Rules the code enforces
- Every user request runs inside `withRequestTx`, which sets the tenant, user, nodes and admin flags for row-level security. Without them the app role sees no rows.
- A database belongs to one region. The app refuses to start, and a tenant cannot be created, if the region differs. A prod database refuses new tenants until `physical_region_verified` is set.
- `DEV_AUTH` and `LOCAL_KEYS` are refused when `APP_ENV` is staging or prod.
- Siblings cannot see each other's nodes, users, roles, invitations or CRM/LMS rows. Only tenant admins read the audit log.
- Partner admins add sub-partners beneath themselves (depth cap 5, loops rejected). Linking an existing partner to another location is a tenant-admin action.

## Not built yet (in ticket order)
Google sign-in (1.1), invitation acceptance, CRM/LMS endpoints, Chrome extension (0.5), Gmail sync, email, video, SCORM, French UI strings, KMS key provider. See the architecture doc.

## Ops notes
- `app_auth` needs `BYPASSRLS` (login lookup runs before a tenant exists) but is granted read access to six identity tables only. If your managed Postgres will not create a BYPASSRLS role, tell us: the alternative is a `SECURITY DEFINER` lookup function.
- Create monthly audit partitions with `SELECT create_audit_partition(date)` as the owner.
- Never commit `.env`. Railway: separate projects per region (`crm-ca`, `crm-us`), synthetic data only until migration to Canada.

## Brand
Display name: **PII by Punjab Insurance** (`PRODUCT_DISPLAY_NAME`). Assets in `brand/`: `logo-source.png` (supplied, transparent), `logo.png` (cropped), and square mark icons `icon-16/32/48/128/512.png` for the extension, favicon and Google consent screen (use `icon-128`; Google wants 120x120).
