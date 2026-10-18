import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { createHash, randomUUID } from 'node:crypto';
import {
  type CarrierChannel,
  type CarrierConnection,
  type CarrierOperation,
  revalidateOutboxDispatch,
} from '@pii/platform';
import { forbidden, invalid, notFound } from './errors.ts';
import { audit } from './audit.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw invalid('Invalid ID format');
  return v;
};

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const CARRIER_REQUIREMENTS: Record<string, {
  name: string;
  checklist: Array<{ type: string; title: string; required: boolean }>;
}> = {
  'ia-financial-group': {
    name: 'iA Financial Group (Industrial Alliance)',
    checklist: [
      { type: 'licence', title: 'Provincial Life & Health Insurance Licence', required: true },
      { type: 'eo_insurance', title: 'Errors & Omissions (E&O) Certificate ($1M+ coverage)', required: true },
      { type: 'banking_void_cheque', title: 'Void Cheque / Direct Deposit Form', required: true },
      { type: 'aml_cert', title: 'Anti-Money Laundering (AML) Compliance Certificate', required: true },
      { type: 'carrier_app_schedule', title: 'iA Direct Contracting Schedule & Agreement', required: true },
    ],
  },
  'manulife': {
    name: 'Manulife Financial',
    checklist: [
      { type: 'licence', title: 'Provincial Life & Health Insurance Licence', required: true },
      { type: 'eo_insurance', title: 'Errors & Omissions (E&O) Certificate ($1M+ coverage)', required: true },
      { type: 'banking_void_cheque', title: 'Banking Information / Pre-Authorized Deposit Form', required: true },
      { type: 'aml_cert', title: 'Anti-Money Laundering (AML) Certificate', required: true },
      { type: 'carrier_app_schedule', title: 'Manulife Advisor Agreement & Contracting Schedule', required: true },
    ],
  },
  'sun-life': {
    name: 'Sun Life Financial',
    checklist: [
      { type: 'licence', title: 'Provincial Insurance Licence', required: true },
      { type: 'eo_insurance', title: 'Errors & Omissions (E&O) Certificate', required: true },
      { type: 'banking_void_cheque', title: 'Direct Deposit Authorization / Void Cheque', required: true },
      { type: 'aml_cert', title: 'AML / Terrorist Financing Training Certificate', required: true },
      { type: 'carrier_app_schedule', title: 'Sun Life Contracting Schedule & Producer Declaration', required: true },
    ],
  },
  'canada-life': {
    name: 'The Canada Life Assurance Company',
    checklist: [
      { type: 'licence', title: 'Provincial Life & A&S Licence', required: true },
      { type: 'eo_insurance', title: 'Current E&O Certificate of Insurance', required: true },
      { type: 'banking_void_cheque', title: 'Commission Direct Deposit Bank Confirmation', required: true },
      { type: 'aml_cert', title: 'AML Compliance Attestation & Certificate', required: true },
      { type: 'carrier_app_schedule', title: 'Canada Life Contracting & Business Code Schedule', required: true },
    ],
  },
};

function normalizeCarrierId(name: string, carrierId?: string | null): string {
  if (carrierId && CARRIER_REQUIREMENTS[carrierId]) return carrierId;
  const n = (name || '').toLowerCase();
  if (n.includes('industrial') || n.includes('ia')) return 'ia-financial-group';
  if (n.includes('manulife')) return 'manulife';
  if (n.includes('sun life') || n.includes('sun-life')) return 'sun-life';
  if (n.includes('canada life') || n.includes('canada-life')) return 'canada-life';
  return 'ia-financial-group';
}

export function registerCarrierWorkflowRoutes(app: FastifyInstance, deps: AppDeps): void {
  // 1. Unified Carrier Dashboard Aggregation
  app.get('/v1/compliance/carrier-dashboard', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    return withRequestTx(deps.appPool, ctx, async tx => {
      // 1. Directory and Settings
      const directoryRows = (await tx.query<{
        id: string;
        displayName: string;
        country: string;
        connectionMode: string;
        connectionVerified: boolean;
        configuredMode: string | null;
        recipientTo: string | null;
        recipientCc: string[] | null;
        sendingEnabled: boolean | null;
        recipientVerifiedAt: string | null;
      }>(
        `SELECT cd.id, cd.display_name AS "displayName", cd.country,
                cd.connection_mode AS "connectionMode", cd.connection_verified AS "connectionVerified",
                css.mode AS "configuredMode", css.recipient_to AS "recipientTo",
                css.recipient_cc AS "recipientCc", css.sending_enabled AS "sendingEnabled",
                css.recipient_verified_at AS "recipientVerifiedAt"
           FROM carrier_directory cd
      LEFT JOIN carrier_submission_settings css ON css.tenant_id = app_tenant_id() AND css.carrier_id = cd.id
          ORDER BY cd.display_name`
      )).rows;

      // 2. All active cases
      const cases = (await tx.query<{
        id: string;
        onboardingCaseId: string;
        nodeId: string;
        carrierName: string;
        carrierId: string | null;
        jurisdiction: string;
        state: string;
        templateVersion: string | null;
        signatureEvidenceRef: string | null;
        carrierApprovalRef: string | null;
        appointmentReference: string | null;
        appointmentEffectiveOn: string | null;
        appointmentExpiresOn: string | null;
        createdAt: string;
        updatedAt: string;
      }>(
        `SELECT cc.id, cc.onboarding_case_id AS "onboardingCaseId", cc.node_id AS "nodeId",
                cc.carrier_name AS "carrierName", cc.carrier_id AS "carrierId",
                cc.jurisdiction, cc.state, cc.template_version AS "templateVersion",
                cc.signature_evidence_ref AS "signatureEvidenceRef",
                cc.carrier_approval_ref AS "carrierApprovalRef",
                cc.appointment_reference AS "appointmentReference",
                cc.appointment_effective_on AS "appointmentEffectiveOn",
                cc.appointment_expires_on AS "appointmentExpiresOn",
                cc.created_at AS "createdAt", cc.updated_at AS "updatedAt"
           FROM carrier_contract_cases cc
          WHERE app_is_compliance_at_or_above(cc.tenant_id, cc.node_id)
          ORDER BY cc.updated_at DESC LIMIT 300`
      )).rows;

      // 3. Submissions
      const submissions = (await tx.query<{
        id: string;
        contractId: string;
        carrierId: string;
        carrierName: string;
        submissionMode: string;
        recipientTo: string | null;
        subject: string;
        packageHash: string;
        status: string;
        responseReference: string | null;
        submittedAt: string;
        submittedByName: string | null;
      }>(
        `SELECT cs.id, cs.contract_id AS "contractId", cs.carrier_id AS "carrierId",
                cd.display_name AS "carrierName", cs.submission_mode AS "submissionMode",
                cs.recipient_to AS "recipientTo", cs.subject, cs.package_hash AS "packageHash",
                cs.status, cs.response_reference AS "responseReference",
                cs.submitted_at AS "submittedAt", u.display_name AS "submittedByName"
           FROM carrier_contract_submissions cs
           JOIN carrier_directory cd ON cd.id = cs.carrier_id
      LEFT JOIN app_users u ON u.id = cs.submitted_by
          WHERE cs.tenant_id = app_tenant_id()
          ORDER BY cs.submitted_at DESC LIMIT 50`
      )).rows;

      // 4. Action required items: missing documents, expiring licences/appointments, pending signatures
      const actionRequired: Array<{
        contractId: string;
        carrierName: string;
        jurisdiction: string;
        type: 'missing_documents' | 'pending_signature' | 'compliance_review' | 'expiring_appointment' | 'correction_required';
        message: string;
      }> = [];

      for (const c of cases) {
        if (c.state === 'requested') {
          actionRequired.push({
            contractId: c.id,
            carrierName: c.carrierName,
            jurisdiction: c.jurisdiction,
            type: 'missing_documents',
            message: 'Application checklist documents need preparation before broker signature.',
          });
        } else if (c.state === 'documents_prepared') {
          actionRequired.push({
            contractId: c.id,
            carrierName: c.carrierName,
            jurisdiction: c.jurisdiction,
            type: 'pending_signature',
            message: 'Broker e-signature pending on prepared application package.',
          });
        } else if (c.state === 'broker_signed') {
          actionRequired.push({
            contractId: c.id,
            carrierName: c.carrierName,
            jurisdiction: c.jurisdiction,
            type: 'compliance_review',
            message: 'Signed package ready for compliance verification and submission.',
          });
        } else if (c.state === 'correction_required') {
          actionRequired.push({
            contractId: c.id,
            carrierName: c.carrierName,
            jurisdiction: c.jurisdiction,
            type: 'correction_required',
            message: 'Carrier requested additional information or revisions.',
          });
        } else if (c.state === 'active' && c.appointmentExpiresOn) {
          const exp = new Date(c.appointmentExpiresOn + 'T00:00:00Z').getTime();
          const now = Date.now();
          const daysLeft = Math.ceil((exp - now) / 86400000);
          if (daysLeft <= 60) {
            actionRequired.push({
              contractId: c.id,
              carrierName: c.carrierName,
              jurisdiction: c.jurisdiction,
              type: 'expiring_appointment',
              message: `Carrier appointment expires in ${daysLeft} days (${c.appointmentExpiresOn}).`,
            });
          }
        }
      }

      // 5. Recent Audit Events
      const auditEvents = (await tx.query<{
        id: string;
        contractId: string;
        carrierName: string;
        fromState: string | null;
        toState: string;
        actorName: string | null;
        reason: string | null;
        recordedAt: string;
      }>(
        `SELECT ce.id, ce.contract_id AS "contractId", cc.carrier_name AS "carrierName",
                ce.from_state AS "fromState", ce.to_state AS "toState",
                u.display_name AS "actorName", ce.reason, ce.recorded_at AS "recordedAt"
           FROM carrier_contract_events ce
           JOIN carrier_contract_cases cc ON cc.id = ce.contract_id
      LEFT JOIN app_users u ON u.id = ce.actor_id
          WHERE ce.tenant_id = app_tenant_id()
          ORDER BY ce.recorded_at DESC LIMIT 40`
      )).rows;

      // Summary counts
      const summary = {
        total: cases.length,
        draft: cases.filter(c => c.state === 'requested').length,
        pendingSignature: cases.filter(c => c.state === 'documents_prepared').length,
        complianceReview: cases.filter(c => c.state === 'broker_signed').length,
        submitted: cases.filter(c => ['submitted', 'carrier_review'].includes(c.state)).length,
        approved: cases.filter(c => c.state === 'approved').length,
        activeAppointments: cases.filter(c => ['active', 'appointment_verified'].includes(c.state)).length,
        attentionRequired: actionRequired.length,
      };

      return {
        directory: directoryRows,
        summary,
        cases,
        actionRequired,
        submissions,
        auditEvents,
      };
    });
  });

  // 2. Document Checklist and Attachments for a Case
  app.get('/v1/compliance/carrier-contracts/:id/documents', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        id: string;
        carrier_name: string;
        carrier_id: string | null;
        jurisdiction: string;
        state: string;
        node_id: string;
      }>('SELECT id, carrier_name, carrier_id, jurisdiction, state, node_id FROM carrier_contract_cases WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      const permitted = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_compliance_at_or_above(app_tenant_id(), $1) OR EXISTS
           (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok`,
        [c.node_id]
      )).rows[0]?.ok;
      if (!permitted) throw forbidden('Access denied');

      const carrierKey = normalizeCarrierId(c.carrier_name, c.carrier_id);
      const reqs = CARRIER_REQUIREMENTS[carrierKey] ?? CARRIER_REQUIREMENTS['ia-financial-group']!;

      const docs = (await tx.query<{
        id: string;
        documentType: string;
        title: string;
        fileName: string;
        contentHash: string;
        fileSizeBytes: number;
        mimeType: string;
        status: string;
        notes: string | null;
        uploadedByName: string | null;
        createdAt: string;
      }>(
        `SELECT d.id, d.document_type AS "documentType", d.title, d.file_name AS "fileName",
                d.content_hash AS "contentHash", d.file_size_bytes AS "fileSizeBytes",
                d.mime_type AS "mimeType", d.status, d.notes,
                u.display_name AS "uploadedByName", d.created_at AS "createdAt"
           FROM carrier_contract_documents d
      LEFT JOIN app_users u ON u.id = d.uploaded_by
          WHERE d.contract_id = $1 AND d.tenant_id = app_tenant_id()
          ORDER BY d.created_at DESC`,
        [id]
      )).rows;

      // Compute checklist completion
      const checklist = (reqs?.checklist ?? []).map(item => {
        const matching = docs.filter(d => d.documentType === item.type && d.status !== 'rejected');
        return {
          type: item.type,
          title: item.title,
          required: item.required,
          satisfied: matching.length > 0,
          documentCount: matching.length,
        };
      });

      const allRequiredMet = checklist.filter(c => c.required).every(c => c.satisfied);

      return {
        carrierId: carrierKey,
        carrierName: reqs?.name ?? 'Carrier',
        documents: docs,
        checklist,
        allRequiredMet,
      };
    });
  });

  // 3. Attach a Supporting Document / Checklist Item
  app.post('/v1/compliance/carrier-contracts/:id/documents', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw invalid('JSON object body required');

    const b = req.body as Record<string, unknown>;
    const docType = typeof b.documentType === 'string' ? b.documentType.trim() : '';
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    const fileName = typeof b.fileName === 'string' ? b.fileName.trim() : '';
    const contentHash = typeof b.contentHash === 'string' ? b.contentHash.trim() : '';
    const fileSizeBytes = typeof b.fileSizeBytes === 'number' ? Math.floor(b.fileSizeBytes) : 0;
    const mimeType = typeof b.mimeType === 'string' ? b.mimeType.trim() : 'application/pdf';
    const notes = typeof b.notes === 'string' ? b.notes.trim() : null;

    const VALID_TYPES = ['licence', 'eo_insurance', 'banking_void_cheque', 'aml_cert', 'carrier_app_schedule', 'signed_agreement', 'other'];
    if (!VALID_TYPES.includes(docType)) throw invalid('Invalid document type');
    if (!title || title.length > 200) throw invalid('Document title required (max 200 chars)');
    if (!fileName || fileName.length > 255) throw invalid('File name required (max 255 chars)');
    if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw invalid('Valid 64-char SHA-256 content hash required');
    if (fileSizeBytes <= 0 || fileSizeBytes > 26214400) throw invalid('File size must be between 1 byte and 25 MB');

    const created = await withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        state: string;
      }>('SELECT tenant_id, node_id, state FROM carrier_contract_cases WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      const permitted = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_compliance_at_or_above($1, $2) OR EXISTS
           (SELECT 1 FROM user_node_roles WHERE node_id = $2 AND user_id = app_user_id()) AS ok`,
        [c.tenant_id, c.node_id]
      )).rows[0]?.ok;
      if (!permitted) throw forbidden('Access denied');

      const row = (await tx.query<{ id: string; createdAt: string }>(
        `INSERT INTO carrier_contract_documents
           (tenant_id, contract_id, document_type, title, file_name, content_hash, file_size_bytes, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at AS "createdAt"`,
        [c.tenant_id, id, docType, title, fileName, contentHash.toLowerCase(), fileSizeBytes, mimeType, notes, ctx.userId]
      )).rows[0];
      if (!row) throw invalid('Failed to attach document');

      await audit(tx, ctx, 'carrier.document_attached', 'carrier_contract_case', id, {
        documentId: row.id,
        documentType: docType,
        fileName,
        contentHash: contentHash.toLowerCase(),
      });

      return row;
    });

    reply.code(201);
    return { ok: true, id: created!.id };
  });

  // 4. Prepare E-Signature Packet
  app.post('/v1/compliance/carrier-contracts/:id/prepare-packet', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    const b = (req.body ?? {}) as Record<string, unknown>;
    const templateVersion = typeof b.templateVersion === 'string' && b.templateVersion.trim()
      ? b.templateVersion.trim()
      : 'v2026.1';

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        state: string;
      }>('SELECT tenant_id, node_id, state FROM carrier_contract_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      if (!['requested', 'correction_required', 'documents_prepared'].includes(c.state)) {
        throw invalid(`Cannot prepare documents from state: ${c.state}`);
      }

      await tx.query(
        `UPDATE carrier_contract_cases
            SET state = 'documents_prepared', template_version = $1, updated_at = now()
          WHERE id = $2`,
        [templateVersion, id]
      );

      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id, contract_id, node_id, from_state, to_state, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id, id, c.node_id, c.state, 'documents_prepared', ctx.userId, `Packet prepared with template ${templateVersion}`]
      );

      await audit(tx, ctx, 'carrier.packet_prepared', 'carrier_contract_case', id, { templateVersion });
      return { id, state: 'documents_prepared' };
    });
  });

  // 5. Broker E-Signature
  app.post('/v1/compliance/carrier-contracts/:id/sign-packet', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, unknown>;

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        state: string;
        template_version: string | null;
      }>('SELECT tenant_id, node_id, state, template_version FROM carrier_contract_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      const permitted = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_compliance_at_or_above(app_tenant_id(), $1) OR EXISTS
           (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok`,
        [c.node_id]
      )).rows[0]?.ok;
      if (!permitted) throw forbidden('Access denied: caller is not authorized to sign for this partner node');

      if (b.consentRecorded !== true) {
        throw invalid('Broker consent must be explicitly confirmed before recording e-signature');
      }

      if (c.state !== 'documents_prepared') {
        throw invalid(`Contract must be in documents_prepared state to sign (current: ${c.state})`);
      }
      if (!c.template_version) throw invalid('Template version required before signing');

      // Check documents attached
      const docCount = (await tx.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM carrier_contract_documents
          WHERE contract_id = $1 AND tenant_id = app_tenant_id() AND status <> 'rejected'`,
        [id]
      )).rows[0]?.count;

      if (!docCount || parseInt(docCount, 10) === 0) {
        throw invalid('At least one supporting application document must be attached before signing');
      }

      const userRow = (await tx.query<{ email: string; displayName: string | null }>(
        `SELECT email, display_name AS "displayName" FROM app_users WHERE id = $1 AND tenant_id = app_tenant_id()`,
        [ctx.userId]
      )).rows[0];
      const signerName = typeof b.signerName === 'string' && b.signerName.trim()
        ? b.signerName.trim()
        : (userRow?.displayName ?? 'Authorized Signer');
      const signerEmail = userRow?.email ?? '';
      const signerIdentity = signerEmail ? `${signerName} <${signerEmail}>` : signerName;

      const signatureHash = typeof b.signatureHash === 'string' && /^[a-f0-9]{64}$/i.test(b.signatureHash.trim())
        ? b.signatureHash.trim().toLowerCase()
        : createHash('sha256').update(`${id}:${c.tenant_id}:${c.node_id}:${ctx.userId}:${signerEmail}:${c.template_version}:${Date.now()}`).digest('hex');

      await tx.query(
        `UPDATE carrier_contract_cases
            SET state = 'broker_signed',
                signature_evidence_ref = $1,
                signature_verified_by = $2,
                signature_verified_at = now(),
                updated_at = now()
          WHERE id = $3`,
        [signatureHash, ctx.userId, id]
      );

      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id, contract_id, node_id, from_state, to_state, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id, id, c.node_id, c.state, 'broker_signed', ctx.userId, `Broker e-signed package by ${signerIdentity}: ${signatureHash.slice(0, 16)}...`]
      );

      await audit(tx, ctx, 'carrier.broker_signed', 'carrier_contract_case', id, { signatureHash, signerIdentity });
      return { id, state: 'broker_signed', signatureHash, signerIdentity };
    });
  });

  // 6. Controlled Submission (Manual Export or Email Dispatch)
  app.post('/v1/compliance/carrier-contracts/:id/submit-package', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required to submit to carrier');

    const b = (req.body ?? {}) as Record<string, unknown>;
    const requestedMode = typeof b.mode === 'string' && ['manual', 'email'].includes(b.mode) ? b.mode : null;
    const notes = typeof b.notes === 'string' ? b.notes.trim() : '';

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        carrier_name: string;
        carrier_id: string | null;
        jurisdiction: string;
        state: string;
        signature_evidence_ref: string | null;
      }>('SELECT tenant_id, node_id, carrier_name, carrier_id, jurisdiction, state, signature_evidence_ref FROM carrier_contract_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      if (!['broker_signed', 'submitted', 'carrier_review'].includes(c.state)) {
        throw invalid(`Contract must be signed by broker before submission (current state: ${c.state})`);
      }

      const carrierKey = normalizeCarrierId(c.carrier_name, c.carrier_id);

      // Verify tenant carrier settings
      const settings = (await tx.query<{
        mode: 'manual' | 'semi_automated';
        recipient_to: string | null;
        recipient_cc: string[];
        subject_template: string;
        body_template: string;
        sending_enabled: boolean;
        recipient_verified_at: string | null;
      }>(
        'SELECT mode, recipient_to, recipient_cc, subject_template, body_template, sending_enabled, recipient_verified_at FROM carrier_submission_settings WHERE tenant_id = app_tenant_id() AND carrier_id = $1',
        [carrierKey]
      )).rows[0] ?? {
        mode: 'manual',
        recipient_to: null,
        recipient_cc: [],
        subject_template: 'Carrier contracting application — {{caseReference}}',
        body_template: 'Please review the attached contracting application.',
        sending_enabled: false,
        recipient_verified_at: null,
      };

      const mode = requestedMode ?? (settings.mode === 'semi_automated' ? 'email' : 'manual');

      if (mode === 'email') {
        if (!settings.sending_enabled || !settings.recipient_verified_at) {
          throw invalid('Email submission is disabled until the carrier recipient address has been verified by compliance. You can submit via manual export mode.');
        }
        if (!settings.recipient_to) {
          throw invalid('Primary carrier recipient address (To) is not configured in settings.');
        }
      }

      // Collect documents for bundle hash
      const docs = (await tx.query<{ id: string; content_hash: string }>(
        `SELECT id, content_hash FROM carrier_contract_documents
          WHERE contract_id = $1 AND tenant_id = app_tenant_id() AND status <> 'rejected'`,
        [id]
      )).rows;

      const docHashes = docs.map(d => d.content_hash).sort().join(':');
      const packageHash = createHash('sha256')
        .update(`${id}:${carrierKey}:${c.jurisdiction}:${docHashes}:${c.signature_evidence_ref ?? ''}`)
        .digest('hex');

      const idempotencyKey = `sub_${id}_${Date.now()}`;
      const subject = settings.subject_template.replace('{{caseReference}}', id.slice(0, 8));
      const bodyPreview = mode === 'email' ? settings.body_template : 'Manual export package prepared for carrier portal upload.';

      const submission = (await tx.query<{ id: string; submittedAt: string }>(
        `INSERT INTO carrier_contract_submissions
           (tenant_id, contract_id, carrier_id, submission_mode, recipient_to, recipient_cc, subject, body_preview, package_hash, document_ids, status, idempotency_key, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted', $11, $12)
         RETURNING id, submitted_at AS "submittedAt"`,
        [
          c.tenant_id,
          id,
          carrierKey,
          mode,
          mode === 'email' ? settings.recipient_to : null,
          mode === 'email' ? settings.recipient_cc : [],
          subject,
          bodyPreview,
          packageHash,
          docs.map(d => d.id),
          idempotencyKey,
          ctx.userId,
        ]
      )).rows[0];
      if (!submission) throw invalid('Failed to record submission');

      // Update case state
      await tx.query(
        `UPDATE carrier_contract_cases
            SET state = 'submitted', updated_at = now()
          WHERE id = $1`,
        [id]
      );

      // Record outbox dispatch queue record within the same transaction
      const outboxStatus = mode === 'manual' ? 'dispatched' : 'queued';
      const outboxReceipt = mode === 'manual' ? { manualExport: true, exportedAt: new Date().toISOString() } : null;
      await tx.query(
        `INSERT INTO carrier_dispatch_outbox
           (tenant_id, contract_id, carrier_id, operation, jurisdiction, idempotency_key, evidence_reference, payload, status, receipt, dispatched_at)
         VALUES ($1, $2, $3, 'contract_packet', $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          c.tenant_id,
          id,
          carrierKey,
          c.jurisdiction,
          idempotencyKey,
          `sha256:${packageHash}`,
          JSON.stringify({ mode, subject, documentCount: docs.length, packageHash }),
          outboxStatus,
          outboxReceipt ? JSON.stringify(outboxReceipt) : null,
          mode === 'manual' ? new Date().toISOString() : null,
        ]
      );

      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id, contract_id, node_id, from_state, to_state, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id, id, c.node_id, c.state, 'submitted', ctx.userId, `Submitted via ${mode} (${mode === 'email' ? settings.recipient_to : 'portal upload'})`]
      );

      await audit(tx, ctx, mode === 'email' ? 'carrier.package_submitted_email' : 'carrier.package_submitted_manual', 'carrier_contract_case', id, {
        submissionId: submission.id,
        mode,
        recipientTo: mode === 'email' ? settings.recipient_to : null,
        packageHash,
        notes: notes || undefined,
      });

      return {
        id,
        submissionId: submission.id,
        mode,
        status: 'submitted',
        packageHash,
        recipientTo: mode === 'email' ? settings.recipient_to : null,
        submittedAt: submission.submittedAt,
      };
    });
  });

  // 7. Record Carrier Response
  app.post('/v1/compliance/carrier-contracts/:id/record-response', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required to record carrier responses');

    const b = req.body as Record<string, unknown>;
    const responseStatus = typeof b.responseStatus === 'string' ? b.responseStatus.trim() : '';
    const reference = typeof b.reference === 'string' ? b.reference.trim() : null;
    const notes = typeof b.notes === 'string' ? b.notes.trim() : null;

    const VALID_RESPONSES = ['acknowledged', 'additional_info_requested', 'carrier_approved', 'declined'];
    if (!VALID_RESPONSES.includes(responseStatus)) {
      throw invalid('Invalid responseStatus: must be acknowledged, additional_info_requested, carrier_approved, or declined');
    }

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        state: string;
      }>('SELECT tenant_id, node_id, state FROM carrier_contract_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      let nextState = c.state;
      if (responseStatus === 'acknowledged') nextState = 'carrier_review';
      else if (responseStatus === 'additional_info_requested') nextState = 'correction_required';
      else if (responseStatus === 'carrier_approved') nextState = 'approved';
      else if (responseStatus === 'declined') nextState = 'declined';

      // Update latest submission if exists
      await tx.query(
        `UPDATE carrier_contract_submissions
            SET status = $1, response_reference = $2, response_notes = $3, responded_at = now(), updated_at = now()
          WHERE id = (
            SELECT id FROM carrier_contract_submissions
             WHERE contract_id = $4 AND tenant_id = app_tenant_id()
             ORDER BY submitted_at DESC LIMIT 1
          )`,
        [responseStatus, reference, notes, id]
      );

      // Update case
      if (responseStatus === 'carrier_approved') {
        await tx.query(
          `UPDATE carrier_contract_cases
              SET state = $1, carrier_approval_ref = $2, carrier_approved_by = $3, carrier_approved_at = now(), updated_at = now()
            WHERE id = $4`,
          [nextState, reference || 'CARRIER_DIRECT_APPROVAL', ctx.userId, id]
        );
      } else {
        await tx.query(
          `UPDATE carrier_contract_cases
              SET state = $1, updated_at = now()
            WHERE id = $2`,
          [nextState, id]
        );
      }

      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id, contract_id, node_id, from_state, to_state, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id, id, c.node_id, c.state, nextState, ctx.userId, `Carrier response recorded: ${responseStatus} (Ref: ${reference ?? 'none'})`]
      );

      await audit(tx, ctx, 'carrier.response_recorded', 'carrier_contract_case', id, {
        responseStatus,
        reference,
        fromState: c.state,
        toState: nextState,
      });

      return { id, state: nextState, responseStatus };
    });
  });

  // 8. Authoritative Carrier Appointment Verification
  app.post('/v1/compliance/carrier-contracts/:id/verify-appointment', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required to verify appointments');

    const b = req.body as Record<string, unknown>;
    const ref = typeof b.appointmentReference === 'string' ? b.appointmentReference.trim() : '';
    const effectiveOn = typeof b.effectiveOn === 'string' ? b.effectiveOn.trim() : '';
    const expiresOn = typeof b.expiresOn === 'string' ? b.expiresOn.trim() : '';
    const activateNow = b.activateNow === true;

    if (!ref || ref.length < 3 || ref.length > 120) throw invalid('Authoritative appointment reference required');
    if (!validDate(effectiveOn) || !validDate(expiresOn)) throw invalid('Valid effective and expiry dates required (YYYY-MM-DD)');
    if (effectiveOn > expiresOn) throw invalid('Expiry date cannot precede effective date');

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{
        tenant_id: string;
        node_id: string;
        state: string;
      }>('SELECT tenant_id, node_id, state FROM carrier_contract_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');

      if (!['approved', 'appointment_verified'].includes(c.state)) {
        throw invalid(`Contract must be approved by carrier before appointment verification (current state: ${c.state})`);
      }

      let nextState = 'appointment_verified';
      let activated = false;
      const blocks: string[] = [];

      if (activateNow) {
        // Enforce transactional live eligibility gates before setting state to active
        const gate = (await tx.query<{
          broker_cleared: boolean;
          agency_signed: boolean;
          licence_valid: boolean;
          eo_valid: boolean;
          active_hold: boolean;
        }>(
          `SELECT
             (oc.stage = 'active' AND oc.standing = 'good_standing') AS broker_cleared,
             EXISTS(SELECT 1 FROM onboarding_agreements a WHERE a.case_id = cc.onboarding_case_id AND a.tenant_id = cc.tenant_id AND a.officer_signed_at IS NOT NULL) AS agency_signed,
             EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'licence' AND i.expires_on >= CURRENT_DATE AND upper(i.jurisdiction) = upper(cc.jurisdiction)) AS licence_valid,
             EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'eo' AND i.expires_on >= CURRENT_DATE) AS eo_valid,
             EXISTS(SELECT 1 FROM carrier_compliance_holds h WHERE h.tenant_id = cc.tenant_id AND h.node_id = cc.node_id AND h.contract_id = cc.id AND h.released_at IS NULL) AS active_hold
           FROM carrier_contract_cases cc
           JOIN onboarding_cases oc ON oc.id = cc.onboarding_case_id AND oc.tenant_id = cc.tenant_id AND oc.node_id = cc.node_id
          WHERE cc.id = $1`,
          [id]
        )).rows[0];

        const today = new Date().toISOString().slice(0, 10);
        const effective = effectiveOn <= today;
        const notExpired = expiresOn >= today;

        if (!gate?.broker_cleared) blocks.push('broker_not_cleared');
        if (!gate?.agency_signed) blocks.push('agency_agreement_not_countersigned');
        if (!gate?.licence_valid) blocks.push('licence_invalid');
        if (!gate?.eo_valid) blocks.push('eo_invalid');
        if (!effective) blocks.push('appointment_not_effective');
        if (!notExpired) blocks.push('appointment_expired');
        if (gate?.active_hold) blocks.push('compliance_hold');

        if (blocks.length === 0) {
          nextState = 'active';
          activated = true;
        }
      }

      await tx.query(
        `UPDATE carrier_contract_cases
            SET state = $1,
                appointment_reference = $2,
                appointment_effective_on = $3,
                appointment_expires_on = $4,
                verified_by = $5,
                verified_at = now(),
                updated_at = now()
          WHERE id = $6`,
        [nextState, ref, effectiveOn, expiresOn, ctx.userId, id]
      );

      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id, contract_id, node_id, from_state, to_state, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id, id, c.node_id, c.state, nextState, ctx.userId, `Appointment verified: ${ref} (${effectiveOn} to ${expiresOn})`]
      );

      await audit(tx, ctx, 'carrier.appointment_verified', 'carrier_contract_case', id, {
        appointmentReference: ref,
        effectiveOn,
        expiresOn,
        state: nextState,
        activated,
        blocks: blocks.length ? blocks : undefined,
      });

      return {
        id,
        state: nextState,
        appointmentReference: ref,
        effectiveOn,
        expiresOn,
        activated,
        blocks: blocks.length ? blocks : undefined,
      };
    });
  });

  // 9. Carrier Dispatch Outbox Management
  app.get('/v1/compliance/carrier-outbox', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    return withRequestTx(deps.appPool, ctx, async tx => {
      const items = (await tx.query<{
        id: string;
        contractId: string;
        carrierId: string;
        operation: string;
        jurisdiction: string;
        idempotencyKey: string;
        evidenceReference: string;
        status: string;
        retryCount: number;
        maxRetries: number;
        lastError: string | null;
        receipt: unknown;
        dispatchedAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>(
        `SELECT id, contract_id AS "contractId", carrier_id AS "carrierId",
                operation, jurisdiction, idempotency_key AS "idempotencyKey",
                evidence_reference AS "evidenceReference", status,
                retry_count AS "retryCount", max_retries AS "maxRetries",
                last_error AS "lastError", receipt, dispatched_at AS "dispatchedAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM carrier_dispatch_outbox
          WHERE tenant_id = app_tenant_id()
          ORDER BY created_at DESC LIMIT 100`
      )).rows;
      return { outbox: items };
    });
  });

  // 10. Outbox Retry with Transactional Revalidation
  app.post('/v1/compliance/carrier-outbox/:id/retry', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');
    const id = uuid((req.params as { id: string }).id);

    return withRequestTx(deps.appPool, ctx, async tx => {
      const row = (await tx.query<{
        id: string;
        contract_id: string;
        carrier_id: string;
        operation: CarrierOperation;
        jurisdiction: string;
        idempotency_key: string;
        evidence_reference: string;
        status: string;
        retry_count: number;
        max_retries: number;
      }>(
        `SELECT id, contract_id, carrier_id, operation, jurisdiction,
                idempotency_key, evidence_reference, status, retry_count, max_retries
           FROM carrier_dispatch_outbox
          WHERE id = $1 AND tenant_id = app_tenant_id()
          FOR UPDATE`,
        [id]
      )).rows[0];

      if (!row) throw notFound('Outbox entry not found');

      // Check contract state and live compliance context
      const c = (await tx.query<{
        state: string;
        holding_clearance: boolean;
        licence_valid: boolean;
        eo_valid: boolean;
      }>(
        `SELECT cc.state,
                NOT EXISTS(SELECT 1 FROM carrier_compliance_holds h WHERE h.contract_id = cc.id AND h.tenant_id = cc.tenant_id AND h.released_at IS NULL) AS holding_clearance,
                EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'licence' AND i.expires_on >= CURRENT_DATE AND upper(i.jurisdiction) = upper(cc.jurisdiction)) AS licence_valid,
                EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'eo' AND i.expires_on >= CURRENT_DATE) AS eo_valid
           FROM carrier_contract_cases cc
          WHERE cc.id = $1 AND cc.tenant_id = app_tenant_id()`,
        [row.contract_id]
      )).rows[0];

      if (!c) throw notFound('Associated carrier contract not found');

      // Query carrier connection settings
      const settings = (await tx.query<{
        mode: string;
        sending_enabled: boolean;
        recipient_verified_at: string | null;
      }>(
        `SELECT mode, sending_enabled, recipient_verified_at
           FROM carrier_submission_settings
          WHERE tenant_id = app_tenant_id() AND carrier_id = $1`,
        [row.carrier_id]
      )).rows[0];

      const connection: CarrierConnection = {
        tenantId: ctx.tenantId,
        carrierId: row.carrier_id,
        channel: (settings?.mode === 'semi_automated' ? 'secure_email' : 'none') as CarrierChannel,
        enabled: Boolean(settings?.sending_enabled),
        verified: Boolean(settings?.recipient_verified_at),
        approvedOperations: [row.operation],
        approvedJurisdictions: [row.jurisdiction],
        destinationVerifiedAt: settings?.recipient_verified_at ?? null,
      };

      try {
        revalidateOutboxDispatch(
          {
            tenantId: ctx.tenantId,
            carrierId: row.carrier_id,
            contractId: row.contract_id,
            operation: row.operation,
            jurisdiction: row.jurisdiction,
            idempotencyKey: row.idempotency_key,
            evidenceReference: row.evidence_reference,
          },
          {
            contractState: c.state,
            holdingClearance: c.holding_clearance,
            licenceValid: c.licence_valid,
            eoValid: c.eo_valid,
            connection,
          }
        );

        // In the absence of live insurer technical endpoint, fails closed safely.
        await tx.query(
          `UPDATE carrier_dispatch_outbox
              SET status = 'failed',
                  retry_count = retry_count + 1,
                  last_error = 'No approved insurer transport channel active; dispatch blocked fail-closed',
                  updated_at = now()
            WHERE id = $1`,
          [id]
        );
        return {
          id,
          dispatched: false,
          status: 'failed',
          reason: 'No approved insurer transport channel active; dispatch blocked fail-closed',
        };
      } catch (err: any) {
        const nextRetry = row.retry_count + 1;
        const newStatus = nextRetry >= row.max_retries ? 'dead_letter' : 'failed';
        await tx.query(
          `UPDATE carrier_dispatch_outbox
              SET status = $1,
                  retry_count = $2,
                  last_error = $3,
                  updated_at = now()
            WHERE id = $4`,
          [newStatus, nextRetry, err.message, id]
        );
        return {
          id,
          dispatched: false,
          status: newStatus,
          reason: err.message,
        };
      }
    });
  });
}
