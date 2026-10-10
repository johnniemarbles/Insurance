# PRD: Compliance for the US site (draft)

Status: draft for Sanjeev and counsel. Nothing here is legal advice. Items marked **counsel** must be confirmed before they are relied on.
Site: us.punjabinsurance.com, operated by Punjab Insurance Broker Inc. Same code as the Canadian site, own database, own vault.

## 1. What already works on the US server
The compliance engine is shared, so these work today on US data: file-completeness gates and waivers, advice records and the signing tiers (built-in one-time code plus the client signing page, vendor tier recorded by hand or through Adobe Acrobat Sign), consents, ID and screening records, large-cash log, retention report and legal holds, audit package, vendor panel, vault code, alerts, the Compliance activity feed.

## 2. Built in this slice (region-aware)
- **California is the first state (pack `ca_doi`, as of 2026-10-10, source: California Department of Insurance).** Agent and broker licences: 24 hours per two-year term with at least 3 on ethics; limited lines automobile: 20 hours. Certificates kept 5 years. California's term starts the day after each licence last expired, so each person enters their own term start date and the two-year term repeats from it (a new per-licence term in the engine; other states with fixed calendar terms still use the pack dates). **counsel / confirm with the Department:** the 1-hour fraud-awareness requirement some licence types carry, any exemption for new licensees, the separate long-term-care and annuity training, and the 60-day-before-expiry completion rule (shown as guidance, not enforced). Further states: send the list.
- Large-cash log: US currency (USD) is the default; the help text names IRS/FinCEN Form 8300 (due within 15 days) instead of FINTRAC. **counsel:** whether an insurance broker files Form 8300 or relies on the carrier's AML programme for covered products, and how foreign currency is converted.
- Screening: shown as OFAC sanctions and "enhanced due diligence" (PEP) on the US site. **counsel:** whether PEP screening is wanted at all in the US.
- Retention report: money records are labelled BSA / FinCEN. The 5-year default for these records is unchanged. **counsel:** the state retention period for insurance records; the 15-year advice default stays until counsel says otherwise.

## 3. Not built, and why
1. **State licensing and CE rule packs.** California is loaded; every other state still needs its own pack. Each state sets its own hours, ethics minimum, term dates and exemptions. Rule packs must come from the state department of insurance, not from memory. Needed from Sanjeev: the list of states the brokerage is licensed in, and each licensee's resident state and licence classes. Then one pack per state with its source link and an as-of date, as for RIBO and the BC Council.
2. **US vault.** Needs its own S3 bucket (Object Lock, us-east-1 or us-east-2) and its own access key. Use a separate AWS user limited to that bucket. Then set the four vault variables on the US Railway service.
3. **US e-signature wording.** The built-in tier relies on the client typing their name after a one-time code. ESIGN and UETA are the governing laws. **counsel:** the consent-to-electronic-records wording shown before signing and any state-specific disclosure (for example replacement notices, which vary by state).
4. **Privacy wording.** The collection and use consent and the notices are written for Canadian law. US insurance privacy follows the Gramm-Leach-Bliley Act as implemented by each state. **counsel:** a US wording version (`draft-1` stays pending).
5. **Electronic messages.** Canadian CASL wording does not apply. **counsel:** TCPA and CAN-SPAM wording for the electronic communications consent.
6. **US demo company.** The demo data is Canadian (branches, products, Super Visa and similar). A US demo needs its own sample set.
7. **Purge.** As in Canada: reporting only, no deletion, until counsel signs off.

## 4. Decisions needed
- Which states, and which licence classes (life, accident and health, property and casualty).
- Whether the US site needs a French interface (assumed no: English only, with the existing fr-CA labels unused).
- Whether Form 8300 and OFAC handling is the brokerage's duty or the carriers'.
- Which vendor tier the carriers accept (Adobe is the first live vendor on both sites).

## 5. Order of work once the inputs arrive
1. State list, then CE packs (one per state).
2. US vault bucket and variables.
3. Counsel-approved US wording for privacy, consent and e-signature.
4. US demo sample.
