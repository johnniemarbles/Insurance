# US draft wording for counsel

Status: **drafts for counsel to mark up. Not legal advice and not live.** Nothing here is shown to a customer until counsel approves it and a version is added to the app. Square brackets are choices or facts counsel must fill in or confirm. Entity: Punjab Insurance Broker Inc (US site, us.punjabinsurance.com). First state: California.

## A. Signed paperwork vault (write-once copies)

**A1. Internal policy (what the system does)**
- When a client signs a document, or a document is filed to a client record, the system keeps an encrypted copy in a separate storage bucket in [us-east-1 / us-east-2] with Object Lock turned on, so the copy cannot be changed or deleted until its retention date.
- Each copy has a fingerprint (SHA-256) of the original. "Verify copy" re-reads the stored copy and compares it with that fingerprint. Every download and verification is recorded in the audit log.
- Retention period: [__ years from the later of signing or policy end]. Counsel to confirm the period for California insurance records and for any other state added. The CE certificates kept for licensees follow California's 5-year minimum.
- Lock mode: governance for now (an authorised administrator can override); [counsel/Sanjeev: move to compliance mode, which nobody can override, once the retention period is settled].
- Legal holds: a record under hold is not purged even after its retention date.
- Purge: [counsel: whether deletion at end of retention is required, optional or prohibited, and how a consumer deletion request is handled for these records].

**A2. Client-facing sentence (in the privacy notice and on the signing page)**
"We keep a secure, unalterable copy of documents you sign with us for [__] years, as required by [law / our record-keeping obligations]. You can ask us for a copy at any time."

**Questions for counsel**
1. Retention period by record type (advice and needs analysis, signed applications, replacement notices, AML/identity records, complaint files) for California.
2. Whether a write-once copy conflicts with any consumer deletion or correction right that applies to these records, and the exception wording.
3. Whether storing copies in a vendor-operated cloud requires a notice or a contract term with the vendor.

## B. Consent to electronic records and signatures (ESIGN / UETA)

**B1. Disclosure shown before the first signature**
"Before you sign electronically, please read this.
1. You can ask for a paper copy of any document at no charge [or: for a fee of $__]. Contact [email / phone / address].
2. You can withdraw your consent to electronic records at any time by contacting us. If you withdraw, [consequences: for example, we will send paper documents and some steps may take longer].
3. This consent covers [the documents for this transaction / all documents we provide to you in connection with your insurance]. 
4. To read and keep your documents you need a device with an internet connection, a current web browser and software that opens PDF files, and an email address. Tell us if this changes.
5. We will keep a record of how and when you signed, including your email address and the time.
Type your full name and select 'I agree' to confirm that you can read this and agree to sign electronically."

**B2. After signing** "You signed [document name] on [date and time]. A copy has been sent to [email]."

**Questions for counsel**
1. Whether the consumer-consent steps (demonstrating the ability to access electronic records) are needed, and how the one-time-code step satisfies them.
2. California or carrier-specific notices that must be delivered on paper or in a particular form (for example replacement or cancellation notices).
3. Whether a vendor signature (Adobe Acrobat Sign) changes the disclosure.

## C. Privacy notice (insurance and financial privacy)

**C1. Short form for the sign-up and first-login screen**
"[Punjab Insurance Broker Inc] collects personal information that you give us, that we receive from insurers and other service providers, and that we create while serving you, such as your name, contact details, date of birth, policy details and payment details. We use it to quote, place, service and renew your insurance, to meet legal and regulatory duties, and to prevent fraud. We share it with insurers, service providers who work for us, and regulators when the law allows or requires. We do not sell it. [Counsel: opt-out/opt-in choices and whether any sharing triggers a choice.] You can ask to see or correct your information by contacting [privacy contact]. Full notice: [link]."

**C2. Content the full notice should cover** (counsel to select and word)
- Categories collected, sources, purposes, who it is shared with, retention.
- The federal financial-privacy notice (Gramm-Leach-Bliley) and California's insurance-information privacy law, and when each must be given (at start of relationship, annually, on change).
- California consumer-privacy rights, and which data is exempt because of the financial or insurance-law exemptions.
- How a person asks to access, correct or limit use, and how fast we answer.
- Children's data, if any is collected.

**Questions for counsel**
1. Which notices are required for a broker in California and when; whether the existing Canadian notice text can be reused anywhere (assumed no).
2. Whether using Gmail message content in the CRM (linking an email thread to a client record) needs a separate consent in the US. Today the app records a consent when a user links a thread.
3. Whether staff-facing notices differ from client-facing ones.

## D. Texting, calling and email

**D1. Email footer (marketing messages)**
"You are receiving this because you asked about insurance with us or are our client. To stop marketing email, [unsubscribe link]. [Punjab Insurance Broker Inc, physical postal address]."

**D2. Text-message consent line (if texting is used)**
"By giving us your mobile number you agree that [Company] may text you about your quote, policy and account. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help."

**Questions for counsel**
1. Which messages count as marketing and which are service messages for an insurance broker; consent proof required before texting or autodialled calls; do-not-call handling.
2. State rules in California on telemarketing and call recording; whether staff must tell clients a call is recorded.
3. Whether the unsubscribe the app already honours (contact opt-out) is enough, and how quickly requests must be applied.

## E. How these drafts get into the app
Once approved: counsel returns the text, we add it as a new notice version (`draft-1` stays pending for the US until then), and the app shows it at first login and on signing. The retention figure goes into the US retention defaults in one place. Nothing about the live Canadian site changes.
