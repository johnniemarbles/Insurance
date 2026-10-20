# Families, Gate A (foundation)

Gate A lets partners group separate client records into families. It ships **switched off**. Plan:
"PII Family Accounts Plan" v2 (approved 20 Oct 2026, decisions 1 to 5).

## What it is, and is not

- A **family** groups separate client records for servicing, letters and (later) totals. Every person keeps their own record.
- The **Head** is only the person family letters go to. It is not a decision maker, guardian or attorney and gives no rights over anyone.
- Clients not in a family are shown as a **family of one**. No family is created for anyone until a partner builds one.
- Not in Gate A: policies and deal roles, coverage, consent, legal authority, family mail merge, imports, the Gmail strip, and a left-panel
  item (that needs a new icon inside the extension, so it waits for the next extension version, Gate D). Families are reached from Contacts.

## Switching it on and off

| Action | How | Effect |
| --- | --- | --- |
| Turn on for one country | Railway variable `FAMILIES_ENABLED=1` on `pii-ca` or `pii-us`, then redeploy | Family routes answer; Contacts shows "Group by family" and the client panel |
| Turn off (rollback) | `FAMILIES_ENABLED=0` or remove it, redeploy | Every family route answers 404, no family screen shows; family data stays stored but unused |

The migration (`0145_families.sql`) only adds tables and three optional client fields (date of birth, preferred language,
date of death). It changes no existing row, so it is safe with the switch off and needs no down migration.

## Who sees what

A family is visible on the same terms as its Head's client record. Member and relationship rows show only when every client in
them is visible. Only the owning partner (or a tenant admin) can change a family.

| Viewer | Sees the family | Sees members | Can change it |
| --- | --- | --- | --- |
| The owning partner | Yes | Yes | Yes |
| A manager above that partner | Yes | Yes | No |
| The location the Head's record is marked for | Yes | Members marked for that location | No |
| A sibling partner | No (404, never "belongs to someone else") | No | No |
| Tenant admin | Yes | Yes | Yes |
| Another tenant | No | No | No |

## Rules the database holds (not only the API)

- One active family per person; one active Head per family (unique indexes; two requests at once cannot break them).
- Every member, and both people in a relationship, belong to the same partner (triggers).
- Ended memberships and relationships cannot be rewritten; history is kept. Archiving a family deletes nobody.
- Every change to a family carries its `version`; a stale one gets 409.
- Every change is in the audit log; profile updates log field names only, never the values.

## API

`GET/POST /v1/families`, `GET/PATCH /v1/families/:id`, `POST /v1/families/:id/archive`, `GET/POST /v1/families/:id/members`,
`PATCH /v1/families/:id/members/:membershipId`, `POST /v1/families/:id/members/:membershipId/end`, `POST /v1/families/:id/change-head`,
`POST /v1/families/:id/move-member`, `GET /v1/people/:id/family`, `GET /v1/family-memberships?contactIds=`, `PATCH /v1/people/:id/profile`,
`GET/POST /v1/people/:id/relationships`, `POST /v1/people/:id/relationships/:relationshipId/end`. Code: `apps/api/src/routes-families.ts`.

Change Head swaps roles by default (the old Head takes the new Head's role); the screen asks first, pre-filled with that swap.

## Evidence

- `apps/api/test/families.test.ts`: 19 tests, including the privacy-isolation release test (a sibling partner cannot discover the family
  or its members through search, relationships, direct requests or the group-by lookup), a simultaneous Head change, the database refusing
  a cross-partner member, and switch-off behaviour.
- `tests/isolation/test_isolation.py`: families, members and relationships checked for every role at the database level, plus the
  automatic privacy-wall drift guard.
- `tests/uat/families/run.sh`: real-browser walkthrough (Chromium) in English and fr-CA, and the switched-off check. Screenshots in
  `docs/families/gate-a-screens/`.

| Screen | File |
| --- | --- |
| Contacts, unchanged layout | `1-contacts.png` |
| Group by family, families of one | `2-grouped.png` |
| Client panel with the Family card | `3-client-family-card.png` |
| Family panel | `4-family-panel.png` |
| Make Head asks what the current Head becomes | `5-change-head-confirm.png` |
| Member added from search | `6-member-added.png` |
| A client with no family | `7-family-of-one.png` |
| French | `8-french.png` |
| Switch off: Contacts exactly as before | `9-switched-off.png` |

## Known limits

- The Contacts list shows up to 200 clients, and grouping covers those shown.
- A family follows its Head's location: changing the Head can change which location manager sees it, exactly as for the Head's record.
