# Sun Life Financial Onboarding & Technical Integration Specification

**Carrier Identifier:** `sun-life`  
**Display Name:** Sun Life Financial  
**Jurisdiction:** Canada (`country: 'CA'`, Provinces: `ON`, `QC`, `BC`, `AB`, `MB`, `SK`, `NS`, `NB`, `NL`, `PE`)  
**Operating Connection Mode:** `readiness_verified (manual_portal_only)`  
**Live Connectivity Status:** **NOT CONNECTED** (External insurer dispatch fail-closed: `allowExternalDispatch: false`)  
**Document Version:** 1.0.0 (Phase 5)

---

## 1. Regulatory Context & Operating Architecture

Sun Life Financial is one of Canada's foremost life insurance and wealth management institutions. In strict accordance with PII regulatory truthfulness standards, **internal contract creation, product activation, or document preparation must never be characterized as insurer authorization**.

At present, contracting cases for Sun Life Financial operate via **manual advisor portal workflows (Sun Life Connect)**. Outbound adapter spikes, prerequisite validation, and inbound cryptographic webhook quarantine are fully implemented in software to ensure integration readiness without premature or unauthorized electronic dispatch.

```mermaid
flowchart TD
    subgraph PII ["PII Platform (Broker & Head Office)"]
        D["1. Document Collection & Check\n(Licence, E&O, Void Cheque, AML, Declaration)"] --> S["2. Broker E-Signature\n(Consent recorded)"]
        S --> R["3. HO Review for Approval\n(State: 'submitted')"]
    end

    subgraph ManualPortal ["Advisor Portal Operations (Manual Route)"]
        R --> M1["4. Compliance Officer Downloads Packet"]
        M1 --> M2["5. Officer Submits into Sun Life Connect"]
        M2 --> M3["6. Sun Life Contracting Review"]
    end

    subgraph StatusSync ["Status Reconciliation & Appointment"]
        M3 --> W1["Option A: Inbound Signed Webhook\n(HMAC-SHA256 -> Status: 'quarantined')"]
        M3 --> W2["Option B: Manual Officer Entry\n(Ref >= 8 chars, Finite Expiry Date)"]
        W1 --> ADJ["Compliance Officer Adjudication\n(/v1/compliance/.../review)"]
        ADJ --> RECON["Contract Reconciliation\n(State: 'appointment_verified')"]
        W2 --> RECON
        RECON --> ACT["Active Broker Selling Authority\n(State: 'active')"]
    end
```

---

## 2. Mandatory Contracting Document Checklist

Before a contract case can transition to `documents_prepared`, all five mandatory documents must be uploaded to the vault, hash-verified, and validated against statutory criteria:

| Document Type | Technical Key | Statutory Requirement & Verification Rule | Minimum Threshold |
| :--- | :--- | :--- | :--- |
| **1. Provincial Licence** | `licence` | Life and Accident & Sickness licence issued by provincial regulator (FSRA in Ontario, AMF in Quebec, BCSC/Insurance Council in BC). | Province match, active expiry date > current date. |
| **2. E&O Insurance** | `eo_insurance` | Certificate of Insurance covering errors, omissions, and professional negligence for financial advisors. | **$1,000,000 per claim / $2,000,000 aggregate**, current policy term. |
| **3. Direct Deposit Authorization** | `banking_void_cheque` | Void cheque or official financial institution direct deposit authorization letter. | Canadian transit format: **3-digit institution + 5-digit branch transit + 5-12 digit account**. |
| **4. AML Certificate** | `aml_cert` | Anti-Money Laundering & Terrorist Financing training certificate from an accredited provider (Advocis, IFSE, or corporate academy). | Completed within preceding **12 months**. |
| **5. Sun Life Declaration** | `carrier_app_schedule` | Sun Life Contracting Schedule & Producer Declaration with provincial disclosures. | Form version matched, signed by broker. |

---

## 3. Quebec Dual-Language Compliance (Bill 96 / Law 25)

For brokers contracting in Quebec (`jurisdiction: 'QC'`) or requesting French correspondence:

1. **Language Parity:** All contract schedules, consent forms, and client privacy notices must be rendered and executed in **Canadian French (`fr-CA`)**.
2. **Statutory Notice:** First-login consent must include mandatory Law 25 disclosures regarding personal information governance, the officer responsible for data protection, and the right of access/rectification.
3. **Data Residency Disclosure:** Notice must explicitly state whether data is stored within Canada (`stored: 'CA'`) or involves cross-border transfer.

---

## 4. Inbound Webhook Security & Quarantined Receipt Lifecycle

When Sun Life webhook notifications are received, they are cryptographically authenticated and held in quarantine.

```mermaid
sequenceDiagram
    autonumber
    actor SL as Sun Life Webhook Dispatcher
    participant API as /v1/webhooks/carrier/sun-life
    participant Security as carrier-webhook-security.ts
    participant DB as carrier_webhook_receipts
    actor Officer as Compliance Officer
    participant Adjudicate as /v1/compliance/carrier-webhook-receipts/:id/review
    participant Reconcile as /v1/compliance/carrier-contracts/:id/reconcile-webhook

    SL->>API: POST signed webhook (timestamp, eventId, rawBody)
    API->>Security: verifyCarrierWebhookSignature(rawBody, headers, secrets)
    Note over Security: HMAC-SHA256 over timestamp.eventId.rawBody<br/>Using CARRIER_WEBHOOK_SECRET_${TENANT}_SUN_LIFE_PRIMARY
    Security-->>API: Verified (signature valid, timestamp within +/- 300s)
    API->>DB: INSERT receipt with status = 'quarantined'
    API-->>SL: HTTP 201 Created { status: 'quarantined', id: '...' }
    Note over DB: No broker appointment is modified automatically
    Officer->>Adjudicate: Inspect receipt, external references, and metadata
    Officer->>Adjudicate: POST /review { status: 'reviewed', notes: '...' }
    Adjudicate->>DB: UPDATE receipt SET status = 'reviewed', reviewer_user_id = '...'
    Officer->>Reconcile: POST /reconcile-webhook { receiptId, appointmentReference, ... }
    Reconcile->>DB: UPDATE carrier_contract_cases SET state = 'appointment_verified'
```

### 4.1 Secret Naming & Dual-Secret Rotation

PII strictly rejects global or unsuffixed secrets. Every secret must be tenant-scoped:
- **Primary:** `CARRIER_WEBHOOK_SECRET_${TENANT_ID}_SUN_LIFE_PRIMARY`
- **Secondary:** `CARRIER_WEBHOOK_SECRET_${TENANT_ID}_SUN_LIFE_SECONDARY`

To rotate keys without service interruption:
1. Generate new 32-byte secret (64 hex characters).
2. Provision as `_SECONDARY` in Railway environment.
3. Update Sun Life webhook signing key in carrier portal.
4. Verify incoming receipts succeed using `_SECONDARY`.
5. Promote `_SECONDARY` to `_PRIMARY` and delete previous key.

---

## 5. Canonical Outbound Adapter Spike (`SunLifeFinancialAdapter`)

PII includes a typed outbound adapter spike in `@pii/platform` (`SunLifeFinancialAdapter`):

```typescript
import {
  getCarrierAdapter,
  SunLifeFinancialAdapter,
  type ContractPacketInput,
} from '@pii/platform';

const adapter = getCarrierAdapter('sun-life') as SunLifeFinancialAdapter;

// 1. Validate all mandatory documents and limits
const validation = adapter.validateContractPrerequisites(packetInput);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// 2. Build canonical carrier payload
const payload = adapter.buildContractPacketPayload(packetInput);

// 3. Dispatch is strictly fail-closed until Gate 1-5 approvals
// adapter.dispatch(...) -> Throws CarrierConnectionUnavailable
```

### 5.1 Canonical Payload Schema (`SunLifeContractPacketPayload`)

```json
{
  "carrier": "sun-life",
  "channel": "manual_portal",
  "version": "SL-2026",
  "tracking": {
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "contractId": "22222222-2222-2222-2222-222222222222",
    "timestamp": "2026-10-19T07:00:00.000Z",
    "market": "CA",
    "province": "ON"
  },
  "advisor": {
    "id": "33333333-3333-3333-3333-333333333333",
    "legalName": "Broker Legal Name",
    "contactEmail": "broker@punjabinsurance.ca",
    "contactPhone": "+14165551234",
    "producerId": "SL-98765",
    "correspondenceLanguage": "en"
  },
  "credentials": {
    "provincialLicence": {
      "number": "LIC-ON-2026-999",
      "province": "ON",
      "classOfInsurance": "Life and Accident & Sickness",
      "expirationDate": "2028-12-31"
    },
    "errorsAndOmissions": {
      "certificateNumber": "EO-998877",
      "provider": "Trisura Guarantee Insurance Company",
      "limitPerClaim": 2000000,
      "limitAggregate": 5000000,
      "expirationDate": "2027-11-30"
    },
    "antiMoneyLaundering": {
      "trainingVendor": "Advocis",
      "completionDate": "2026-01-15",
      "expirationDate": "2027-01-15"
    }
  },
  "eftAuthorization": {
    "institution": "003",
    "transit": "12345",
    "accountLastFour": "6789"
  },
  "supportingDocumentation": [
    { "category": "licence", "label": "Ontario Licence", "fileChecksum": "...", "archiveUri": "vault://..." },
    { "category": "eo_insurance", "label": "E&O Certificate", "fileChecksum": "...", "archiveUri": "vault://..." },
    { "category": "banking_void_cheque", "label": "Direct Deposit Form", "fileChecksum": "...", "archiveUri": "vault://..." },
    { "category": "aml_cert", "label": "AML Completion", "fileChecksum": "...", "archiveUri": "vault://..." },
    { "category": "carrier_app_schedule", "label": "Sun Life Declaration", "fileChecksum": "...", "archiveUri": "vault://..." }
  ]
}
```

---

## 6. Release Gates Required for Live Electronic Dispatch

Before `allowExternalDispatch` can be toggled to `true` for Sun Life Financial, all five release gates must be formally satisfied:

1. **Gate 1: Bilateral Contractual Authorization** — Countersigned API partner agreement, Data Protection Agreement (DPA), and infosec sign-off with Sun Life Financial.
2. **Gate 2: Technical Sandbox Certification** — Successful execution of mock submissions, failure retries, and duplicate receipt rejections in Sun Life's certified partner test environment.
3. **Gate 3: KMS Dual-Secret Provisioning** — Tenant-scoped primary and secondary webhook secrets generated with 256 bits of entropy and deployed to Railway.
4. **Gate 4: Outbox Worker Safety Certification** — Verified transactional row leasing (`FOR UPDATE SKIP LOCKED`), exponential backoff, and dead-letter routing.
5. **Gate 5: Scoped Production Feature Activation** — Controlled feature flag activation specifically for the authorized tenant and carrier ID (`ALLOW_EXTERNAL_CARRIER_DISPATCH_SUN_LIFE=true`).
