# Industrial Alliance direct contracting — configurable recipient

Punjab Insurance Agency contracts directly with iA Financial Group. No MGA intermediary is assumed. The carrier's actual acceptance of direct contracting is still to be confirmed.

## Recipient settings
Maintain tenant-scoped, carrier-specific settings with:
- primaryTo: editable email address (required for email mode)
- cc: optional array of email addresses
- replyTo: agency-owned mailbox
- subjectTemplate and bodyTemplate: editable, versioned
- mode: manual | semi_automated | authorized_api
- recipientVerifiedAt, recipientVerifiedBy, recipientVerificationEvidence
- sendingEnabled: false by default

Agency administrators with the correct tenant permission may edit these values. Save a new version on every change, including editor and timestamp. Changing a recipient invalidates its verified state and suspends automated sending until reverified. Do not permit untrusted inbound email to update recipient configuration.

## Submission
A draft may be prepared and signed without a verified address. Before transmitting a package, require compliance approval, required signatures, valid supporting documents, explicit sharing consent, a verified recipient and a final package hash. Capture a snapshot of To/CC/Reply-To, template version, package hash, approval and message ID on the case. Subsequent configuration changes must not rewrite past submissions. Send idempotently; handle delivery ambiguity without blind retries.

## UI
Settings > Carriers > Industrial Alliance > Direct contracting:
- Mode selection
- To / CC / Reply-To fields
- Editable subject and message
- Save configuration
- Verify recipient (requires supporting evidence)
- Sending status and last change
Show clear warnings for unverified recipients. Never imply a saved address is an official iA address.

## Test cases
1. Tenant admin edits To/CC/Reply-To; settings are isolated per tenant.
2. Unauthorized users cannot edit carrier recipients.
3. Invalid email addresses rejected.
4. Recipient edit invalidates verification and disables sending.
5. Existing submitted cases retain prior recipient snapshot.
6. Unsigned or unapproved packages cannot send.
7. Unverified recipient cannot send.
8. Duplicate submit does not send twice.
9. No MGA record required in direct contracting mode.
10. Carrier appointment cannot be marked verified from email delivery alone.
