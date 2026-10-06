# Public API (read-only)

For Zapier, Google Sheets scripts and reporting tools.

## Keys
- Create under **Integrations > Transfer data > API keys** (administrators and managers only, up to 5 active keys each).
- A key is shown once. Only its hash is stored. Keys expire after 365 days and can be revoked at any time.
- A key acts as the person who made it and sees exactly what that person sees (same row-level rules as the app).
- Keys are accepted only on `/v1/public/*`. They can never write, and open nothing else.
- If the person is disabled, their keys stop working. Creating and revoking keys is written to the audit log.

## Calls
Send `Authorization: Bearer pii_k_...` to `https://ca.punjabinsurance.co` or `https://us.punjabinsurance.co` (use the server that holds your data).

| Call | Returns |
|---|---|
| `GET /v1/public/me` | The key owner's email |
| `GET /v1/public/pipelines` | Pipelines and their stages |
| `GET /v1/public/records?pipelineId=&since=&before=&limit=` | Records, newest first (limit up to 100). `since` (ISO time) returns only newer records, which is what a Zapier "new record" trigger polls |
| `GET /v1/public/records/:id` | One record |
| `GET /v1/public/contacts?q=&limit=&offset=` | Contacts (name, email, phone) |

Limit: 120 requests per minute per key. No email content is ever returned.

## Getting data in, and out the moment it happens
- **In:** each pipeline's capture link (Integrations > Recipes) accepts a JSON post. In Zapier use "Webhooks by Zapier > POST".
- **Out, instantly:** pipeline webhooks (records created, stage changed, weekly digest) post to a Zapier "Catch Hook" address.
