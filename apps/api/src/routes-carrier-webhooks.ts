import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { invalid, notFound, forbidden, unauthorized } from './errors.ts';
import { audit } from './audit.ts';
import type { AppDeps } from './app.ts';
import {
  getCarrierWebhookSecrets,
  verifyCarrierWebhookSignature,
} from './carrier-webhook-security.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_CARRIERS = ['ia-financial-group', 'manulife', 'sun-life', 'canada-life'];

function systemTenantCtx(tenantId: string): RequestContext {
  return {
    tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    nodeIds: [],
    adminNodeIds: [],
    isTenantAdmin: true,
    canWrite: true,
    canUseCrm: true,
    roles: [],
  };
}

export function registerCarrierWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Use an encapsulated plugin so the custom parser
  // applies only to carrier webhook ingestion.
  app.register(async webhookScope => {
    webhookScope.removeContentTypeParser('application/json');

    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
      (_request, body, done) => {
        done(null, body);
      }
    );

    webhookScope.post('/v1/webhooks/carrier/:carrierId', async (req, reply) => {
      const params = req.params as { carrierId?: string };
      const carrierId = (params.carrierId ?? '').trim().toLowerCase();
      if (!SUPPORTED_CARRIERS.includes(carrierId)) {
        throw notFound(`Unsupported carrier: ${carrierId}`);
      }

      const headers = req.headers as Record<string, string | undefined>;

      // Resolve tenant ID from header
      const rawTenantId = headers['x-tenant-id'];
      if (!rawTenantId || !UUID_RE.test(rawTenantId)) {
        throw invalid('Valid x-tenant-id header required');
      }
      const tenantId = rawTenantId.toLowerCase();

      // Verify tenant exists
      const tenantExists = (
        await deps.authPool.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId])
      ).rowCount! > 0;
      if (!tenantExists) throw notFound('Tenant not found');

      const secrets = getCarrierWebhookSecrets(
        tenantId,
        carrierId
      );

      if (secrets.length === 0) {
        throw forbidden(
          'Carrier webhook signing secret not configured'
        );
      }

      const rawBody = req.body;

      if (!Buffer.isBuffer(rawBody)) {
        throw invalid('Raw webhook body required');
      }

      const eventId = headers['x-carrier-event-id'];
      const timestampText = headers['x-carrier-timestamp'];
      const signature = headers['x-carrier-signature'];

      if (
        typeof eventId !== 'string' ||
        typeof timestampText !== 'string' ||
        typeof signature !== 'string' ||
        !/^\d{13}$/.test(timestampText)
      ) {
        throw unauthorized('Invalid webhook authentication');
      }

      const timestamp = Number(timestampText);

      const valid = verifyCarrierWebhookSignature(
        {
          tenantId,
          carrierId,
          eventId,
          timestamp,
          signature,
          rawBody,
        },
        secrets
      );

      if (!valid) {
        throw unauthorized('Invalid webhook authentication');
      }

      // Parse only after successful signature verification.
      let bodyObj: Record<string, unknown>;

      try {
        const parsed: unknown = JSON.parse(
          rawBody.toString('utf8')
        );

        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          throw new Error('Expected JSON object');
        }

        bodyObj = parsed as Record<string, unknown>;
      } catch {
        throw invalid('Invalid webhook JSON payload');
      }

      const payloadDigest = createHash('sha256')
        .update(rawBody)
        .digest('hex');

      // Record into carrier_webhook_receipts within tenant context
      const out = await withRequestTx(deps.appPool, systemTenantCtx(tenantId), async (tx: Tx) => {
        const inserted = (
          await tx.query<{ id: string; status: string; received_at: string }>(
            `INSERT INTO carrier_webhook_receipts
               (tenant_id, carrier_id, external_event_id, payload, payload_digest, status)
             VALUES ($1, $2, $3, $4, $5, 'quarantined')
             ON CONFLICT (tenant_id, carrier_id, external_event_id) DO NOTHING
             RETURNING id, status, received_at AS "receivedAt"`,
            [tenantId, carrierId, eventId, JSON.stringify(bodyObj), payloadDigest]
          )
        ).rows[0];

        if (!inserted) {
          // Replay detected
          const existing = (
            await tx.query<{ id: string; status: string; received_at: string }>(
              `SELECT id, status, received_at AS "receivedAt"
                 FROM carrier_webhook_receipts
                WHERE tenant_id = $1 AND carrier_id = $2 AND external_event_id = $3`,
              [tenantId, carrierId, eventId]
            )
          ).rows[0];

          return {
            id: existing?.id,
            status: existing?.status ?? 'quarantined',
            duplicate: true,
          };
        }

        return {
          id: inserted.id,
          status: inserted.status,
          duplicate: false,
        };
      });

      if (out.duplicate) {
        return reply.code(200).send({
          ok: true,
          id: out.id,
          status: out.status,
          duplicate: true,
          message: 'Duplicate event already received and quarantined',
        });
      }

      return reply.code(201).send({
        ok: true,
        id: out.id,
        carrierId,
        eventId,
        status: out.status,
        quarantined: true,
        message: 'Event quarantined pending compliance review',
      });
    });
  });

  // 2. Compliance List Quarantined Carrier Receipts
  app.get('/v1/compliance/carrier-webhook-receipts', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    const q = (req.query ?? {}) as { status?: string; carrierId?: string; limit?: string | number };
    const limit = Math.max(1, Math.min(100, Number(q.limit) || 50));
    const statusFilter = typeof q.status === 'string' && ['quarantined', 'reviewed', 'rejected'].includes(q.status)
      ? q.status
      : null;
    const carrierFilter = typeof q.carrierId === 'string' && SUPPORTED_CARRIERS.includes(q.carrierId)
      ? q.carrierId
      : null;

    return withRequestTx(deps.appPool, ctx, async tx => {
      const rows = (
        await tx.query<{
          id: string;
          carrierId: string;
          externalEventId: string;
          status: string;
          payload: unknown;
          payloadDigest: string;
          contractId: string | null;
          notes: string | null;
          reviewedBy: string | null;
          reviewedAt: string | null;
          receivedAt: string;
        }>(
          `SELECT r.id, r.carrier_id AS "carrierId", r.external_event_id AS "externalEventId",
                  r.status, r.payload, r.payload_digest AS "payloadDigest",
                  r.contract_id AS "contractId", r.notes,
                  r.reviewed_by AS "reviewedBy", r.reviewed_at AS "reviewedAt",
                  r.received_at AS "receivedAt"
             FROM carrier_webhook_receipts r
            WHERE r.tenant_id = app_tenant_id()
              AND ($1::text IS NULL OR r.status = $1)
              AND ($2::text IS NULL OR r.carrier_id = $2)
            ORDER BY r.received_at DESC
            LIMIT $3`,
          [statusFilter, carrierFilter, limit]
        )
      ).rows;

      return { receipts: rows };
    });
  });

  // 3. Compliance Review & Quarantine Adjudication
  app.post('/v1/compliance/carrier-webhook-receipts/:id/review', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    const params = req.params as { id: string };
    const id = params.id;
    if (!UUID_RE.test(id)) throw invalid('Valid receipt UUID required');

    const b = (req.body ?? {}) as { decision?: string; notes?: string; contractId?: string };
    const decision = (b.decision ?? '').trim().toLowerCase();
    if (!['reviewed', 'rejected'].includes(decision)) {
      throw invalid('Decision must be either "reviewed" or "rejected"');
    }

    const notes = typeof b.notes === 'string' ? b.notes.trim() : null;
    let contractId: string | null = null;
    if (typeof b.contractId === 'string' && b.contractId.trim()) {
      if (!UUID_RE.test(b.contractId.trim())) throw invalid('Invalid contractId UUID format');
      contractId = b.contractId.trim();
    }

    return withRequestTx(deps.appPool, ctx, async tx => {
      const receipt = (
        await tx.query<{
          id: string;
          carrier_id: string;
          external_event_id: string;
          status: string;
        }>(
          `SELECT id, carrier_id, external_event_id, status
             FROM carrier_webhook_receipts
            WHERE id = $1 AND tenant_id = app_tenant_id()
            FOR UPDATE`,
          [id]
        )
      ).rows[0];

      if (!receipt) throw notFound('Receipt not found');

      if (receipt.status !== 'quarantined') {
        throw forbidden('Receipt has already been adjudicated');
      }
      if (contractId) {
        const contract = (await tx.query<{ carrier_id: string | null }>(
          'SELECT carrier_id FROM carrier_contract_cases WHERE id = $1 AND tenant_id = app_tenant_id()',
          [contractId]
        )).rows[0];
        if (!contract) throw notFound('Associated carrier contract case not found');
        if (!contract.carrier_id || contract.carrier_id !== receipt.carrier_id) {
          throw forbidden('Receipt carrier does not match the contract carrier');
        }
      }

      await tx.query(
        `UPDATE carrier_webhook_receipts
            SET status = $1,
                notes = $2,
                contract_id = coalesce($3, contract_id),
                reviewed_by = $4,
                reviewed_at = now()
          WHERE id = $5`,
        [decision, notes, contractId, ctx.userId, id]
      );

      await audit(tx, ctx, 'carrier.webhook_reviewed', 'carrier_webhook_receipt', id, {
        decision,
        carrierId: receipt.carrier_id,
        externalEventId: receipt.external_event_id,
        notes: notes ?? undefined,
        contractId: contractId ?? undefined,
      });

      return {
        id,
        status: decision,
        reviewedAt: new Date().toISOString(),
      };
    });
  });

  // 4. Compliance Appointment Reconciliation with External Evidence
  app.post('/v1/compliance/carrier-contracts/:id/reconcile-appointment', async req => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer = ctx.isTenantAdmin || ctx.roles.some(r => r.role === 'compliance');
    if (!isOfficer) throw forbidden('Compliance authorization required');

    const params = req.params as { id: string };
    const id = params.id;
    if (!UUID_RE.test(id)) throw invalid('Valid contract UUID required');

    const b = (req.body ?? {}) as {
      appointmentReference?: string;
      verifiedWithCarrierOn?: string;
      notes?: string;
      receiptId?: string;
    };

    const ref = typeof b.appointmentReference === 'string' ? b.appointmentReference.trim() : '';
    const verifiedDate = typeof b.verifiedWithCarrierOn === 'string' ? b.verifiedWithCarrierOn.trim() : '';
    const notes = typeof b.notes === 'string' ? b.notes.trim() : null;
    let receiptId: string | null = null;
    if (typeof b.receiptId === 'string' && b.receiptId.trim()) {
      if (!UUID_RE.test(b.receiptId.trim())) throw invalid('Invalid receiptId UUID format');
      receiptId = b.receiptId.trim();
    }

    if (!ref || ref.length < 3 || ref.length > 120) {
      throw invalid('Valid appointmentReference required (3-120 chars)');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)) {
      throw invalid('verifiedWithCarrierOn must be YYYY-MM-DD');
    }

    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (
        await tx.query<{
          id: string;
          state: string;
          appointment_reference: string | null;
        }>(
          `SELECT id, state, appointment_reference
             FROM carrier_contract_cases
            WHERE id = $1 AND tenant_id = app_tenant_id()
            FOR UPDATE`,
          [id]
        )
      ).rows[0];

      if (!c) throw notFound('Carrier contract not found');

      if (!['approved', 'appointment_verified', 'active'].includes(c.state)) {
        throw invalid(`Contract state ${c.state} is not eligible for appointment reconciliation`);
      }

      if (receiptId) {
        // A receipt is evidence only after independent compliance adjudication.
        // Never promote a quarantined/rejected event to reviewed during reconciliation.
        const receipt = (await tx.query<{
          id: string; carrier_id: string; status: string; contract_id: string | null;
        }>(
          `SELECT id, carrier_id, status, contract_id
             FROM carrier_webhook_receipts
            WHERE id = $1 AND tenant_id = app_tenant_id()
            FOR UPDATE`,
          [receiptId]
        )).rows[0];
        if (!receipt) throw notFound('Carrier webhook receipt not found');
        if (receipt.status !== 'reviewed') throw forbidden('Receipt requires prior compliance review');
        if (receipt.contract_id && receipt.contract_id !== id) {
          throw forbidden('Receipt is already linked to another contract');
        }
        const contractCarrier = (await tx.query<{ carrier_id: string | null }>(
          `SELECT carrier_id FROM carrier_contract_cases
            WHERE id = $1 AND tenant_id = app_tenant_id()`,
          [id]
        )).rows[0]?.carrier_id;
        if (!contractCarrier || contractCarrier !== receipt.carrier_id) {
          throw forbidden('Receipt carrier does not match the contract carrier');
        }
        await tx.query(
          `UPDATE carrier_webhook_receipts SET contract_id = $1
            WHERE id = $2 AND tenant_id = app_tenant_id()
              AND status = 'reviewed' AND (contract_id IS NULL OR contract_id = $1)`,
          [id, receiptId]
        );
      }

      await audit(tx, ctx, 'carrier.appointment_reconciled', 'carrier_contract_case', id, {
        appointmentReference: ref,
        verifiedWithCarrierOn: verifiedDate,
        priorReference: c.appointment_reference,
        receiptId: receiptId ?? undefined,
        notes: notes ?? undefined,
      });

      return {
        id,
        state: c.state,
        appointmentReference: ref,
        reconciled: true,
        reconciledAt: new Date().toISOString(),
      };
    });
  });
}
