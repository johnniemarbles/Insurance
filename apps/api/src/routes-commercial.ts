import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  POLICY_STATUSES,
  PREMIUM_FREQUENCIES,
  COMMISSION_TRANSACTION_TYPES,
  validatePremiumCents,
  validateAmountCents,
  validateSha256Hash,
  type PolicyStatus,
  type PremiumFrequency,
  type CommissionTransactionType,
  type ReconciliationStatus,
} from '@pii/domain';
import type { AppDeps } from './app.ts';
import { forbidden, invalid, notFound, conflict } from './errors.ts';

function requireCommercialAccess(roles: string[], isTenantAdmin: boolean) {
  if (isTenantAdmin || roles.some((r) => ['admin', 'compliance', 'manager'].includes(r))) {
    return;
  }
  throw forbidden('Only management or compliance may access commercial operations');
}

function requireImportAccess(roles: string[], isTenantAdmin: boolean) {
  if (isTenantAdmin || roles.some((r) => ['admin', 'compliance'].includes(r))) {
    return;
  }
  throw forbidden('Only company administrators or compliance officers may register commission statements');
}

export function registerCommercialRoutes(app: FastifyInstance, deps: AppDeps) {
  // 1. Create In-Force Policy Record
  app.post('/v1/commercial/policies', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalid('JSON object body required');
    }
    const b = req.body as Record<string, unknown>;

    const carrierId = typeof b.carrierId === 'string' ? b.carrierId.trim() : '';
    const branchNodeId = typeof b.branchNodeId === 'string' ? b.branchNodeId.trim() : '';
    const producerNodeId = typeof b.producerNodeId === 'string' ? b.producerNodeId.trim() : '';
    const policyNumber = typeof b.policyNumber === 'string' ? b.policyNumber.trim() : '';
    const planName = typeof b.planName === 'string' ? b.planName.trim() : '';
    const jurisdiction = typeof b.jurisdiction === 'string' ? b.jurisdiction.trim().toUpperCase() : '';
    const frequency = typeof b.premiumFrequency === 'string' ? b.premiumFrequency.trim().toLowerCase() : '';
    const rawStatus = typeof b.status === 'string' ? b.status.trim().toLowerCase() : 'active';
    const effectiveDate = typeof b.effectiveDate === 'string' ? b.effectiveDate.trim() : '';
    const expiryDate = typeof b.expiryDate === 'string' ? b.expiryDate.trim() : null;

    if (!carrierId || !branchNodeId || !producerNodeId || !policyNumber || !planName || !effectiveDate) {
      throw invalid('carrierId, branchNodeId, producerNodeId, policyNumber, planName, and effectiveDate are required');
    }
    if (!/^[A-Z]{2}(?:-[A-Z0-9]{2,10})?$/.test(jurisdiction)) {
      throw invalid('Invalid jurisdiction code (e.g. QC, ON, CA-QC)');
    }
    if (!PREMIUM_FREQUENCIES.includes(frequency as PremiumFrequency)) {
      throw invalid(`premiumFrequency must be one of: ${PREMIUM_FREQUENCIES.join(', ')}`);
    }
    if (!POLICY_STATUSES.includes(rawStatus as PolicyStatus)) {
      throw invalid(`status must be one of: ${POLICY_STATUSES.join(', ')}`);
    }

    let annualPremiumCents: number;
    let modalPremiumCents: number;
    try {
      annualPremiumCents = validatePremiumCents(b.annualPremiumCents, 'annualPremiumCents');
      modalPremiumCents = validatePremiumCents(b.modalPremiumCents, 'modalPremiumCents');
    } catch (e) {
      throw invalid((e as Error).message);
    }

    const policy = await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      // Validate carrier exists
      const carrierExists = (
        await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [carrierId])
      ).rowCount! > 0;
      if (!carrierExists) throw notFound('Carrier not found in directory');

      // Validate branch node is authorized for user
      if (!ctx.isTenantAdmin && !ctx.nodeIds.includes(branchNodeId)) {
        throw forbidden('Not authorized for branch location');
      }

      // Validate producer node exists and belongs to this branch or tenant
      const producerValid = (
        await tx.query(
          `SELECT 1 FROM org_nodes n
            WHERE n.id = $1 AND n.tenant_id = $2 AND n.type = 'partner'`,
          [producerNodeId, ctx.tenantId]
        )
      ).rowCount! > 0;
      if (!producerValid) throw invalid('Producer node must be an active partner');

      // Duplicate policy check
      const dup = (
        await tx.query(
          `SELECT 1 FROM policy_records 
            WHERE tenant_id = $1 AND carrier_id = $2 AND policy_number = $3`,
          [ctx.tenantId, carrierId, policyNumber]
        )
      ).rowCount! > 0;
      if (dup) throw conflict('A policy with this number already exists for this carrier');

      const row = (
        await tx.query(
          `INSERT INTO policy_records (
             tenant_id, branch_node_id, producer_node_id, carrier_id,
             policy_number, plan_name, jurisdiction, annual_premium_cents,
             modal_premium_cents, premium_frequency, status, effective_date,
             expiry_date, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
           ) RETURNING *`,
          [
            ctx.tenantId,
            branchNodeId,
            producerNodeId,
            carrierId,
            policyNumber,
            planName,
            jurisdiction,
            annualPremiumCents,
            modalPremiumCents,
            frequency,
            rawStatus,
            effectiveDate,
            expiryDate,
            ctx.userId,
          ]
        )
      ).rows[0];

      return row;
    });

    reply.code(201);
    return { policy };
  });

  // 2. List In-Force Policy Records
  app.get('/v1/commercial/policies', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const carrierId = q.carrier_id?.trim();
    const status = q.status?.trim();
    const branchNodeId = q.branch_node_id?.trim();
    const producerNodeId = q.producer_node_id?.trim();

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      let sql = `
        SELECT p.*, n_branch.name AS branch_name, n_prod.name AS producer_name
          FROM policy_records p
          JOIN org_nodes n_branch ON n_branch.id = p.branch_node_id
          JOIN org_nodes n_prod ON n_prod.id = p.producer_node_id
         WHERE p.tenant_id = $1
      `;
      const params: unknown[] = [ctx.tenantId];

      if (carrierId) {
        params.push(carrierId);
        sql += ` AND p.carrier_id = $${params.length}`;
      }
      if (status) {
        params.push(status);
        sql += ` AND p.status = $${params.length}`;
      }
      if (branchNodeId) {
        params.push(branchNodeId);
        sql += ` AND p.branch_node_id = $${params.length}`;
      }
      if (producerNodeId) {
        params.push(producerNodeId);
        sql += ` AND p.producer_node_id = $${params.length}`;
      }

      sql += ` ORDER BY p.created_at DESC LIMIT 100`;

      const rows = (await tx.query(sql, params)).rows;
      return { policies: rows };
    });
  });

  // 3. Get Single Policy Record
  app.get('/v1/commercial/policies/:id', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    const id = (req.params as { id: string }).id;

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const row = (
        await tx.query(
          `SELECT p.*, n_branch.name AS branch_name, n_prod.name AS producer_name
             FROM policy_records p
             JOIN org_nodes n_branch ON n_branch.id = p.branch_node_id
             JOIN org_nodes n_prod ON n_prod.id = p.producer_node_id
            WHERE p.id = $1 AND p.tenant_id = $2`,
          [id, ctx.tenantId]
        )
      ).rows[0];

      if (!row) throw notFound('Policy not found');
      return { policy: row };
    });
  });

  // 4. Idempotent Commission Statement Import & Auto-Reconciliation
  app.post('/v1/commercial/commission-imports', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireImportAccess(roles, Boolean(ctx.isTenantAdmin));

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalid('JSON object body required');
    }
    const b = req.body as Record<string, unknown>;

    const carrierId = typeof b.carrierId === 'string' ? b.carrierId.trim() : '';
    const statementReference = typeof b.statementReference === 'string' ? b.statementReference.trim() : '';
    const statementDate = typeof b.statementDate === 'string' ? b.statementDate.trim() : '';
    const rawLines = Array.isArray(b.lines) ? b.lines : [];

    if (!carrierId || !statementReference || !statementDate) {
      throw invalid('carrierId, statementReference, and statementDate are required');
    }
    if (rawLines.length === 0) {
      throw invalid('At least one statement line item is required');
    }

    let fileHashSha256: string;
    try {
      fileHashSha256 = validateSha256Hash(b.fileHashSha256);
    } catch (e) {
      throw invalid((e as Error).message);
    }

    const validatedLines: {
      policyNumber: string;
      grossAmountCents: number;
      netAmountCents: number;
      transactionType: CommissionTransactionType;
      carrierProducerCode: string | null;
    }[] = [];

    let totalGrossCents = 0;
    let totalNetCents = 0;

    for (const [idx, item] of rawLines.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw invalid(`Line ${idx}: valid line item object required`);
      }
      const policyNumber = typeof item.policyNumber === 'string' ? item.policyNumber.trim() : '';
      const type = typeof item.transactionType === 'string' ? item.transactionType.trim().toLowerCase() : '';
      const code = typeof item.carrierProducerCode === 'string' ? item.carrierProducerCode.trim() : null;

      if (!policyNumber) throw invalid(`Line ${idx}: policyNumber is required`);
      if (!COMMISSION_TRANSACTION_TYPES.includes(type as CommissionTransactionType)) {
        throw invalid(`Line ${idx}: transactionType must be one of: ${COMMISSION_TRANSACTION_TYPES.join(', ')}`);
      }

      let gross: number;
      let net: number;
      try {
        gross = validateAmountCents(item.grossAmountCents, `Line ${idx} grossAmountCents`);
        net = validateAmountCents(item.netAmountCents, `Line ${idx} netAmountCents`);
      } catch (e) {
        throw invalid((e as Error).message);
      }

      totalGrossCents += gross;
      totalNetCents += net;

      validatedLines.push({
        policyNumber,
        grossAmountCents: gross,
        netAmountCents: net,
        transactionType: type as CommissionTransactionType,
        carrierProducerCode: code,
      });
    }

    if (totalGrossCents < 0 || totalNetCents < 0) {
      throw invalid('Total statement gross and net amounts cannot be negative');
    }

    const result = await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      // Validate carrier exists
      const carrierExists = (
        await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [carrierId])
      ).rowCount! > 0;
      if (!carrierExists) throw notFound('Carrier not found in directory');

      // Idempotency check: duplicate SHA-256 for this tenant & carrier is strictly rejected with 409
      const existingImport = (
        await tx.query<{ id: string }>(
          `SELECT id FROM commission_imports 
            WHERE tenant_id = $1 AND carrier_id = $2 AND file_hash_sha256 = $3`,
          [ctx.tenantId, carrierId, fileHashSha256]
        )
      ).rows[0];

      if (existingImport) {
        throw conflict('Statement already imported (SHA-256 duplicate)');
      }

      // Insert commission_imports
      const importRecord = (
        await tx.query<{ id: string }>(
          `INSERT INTO commission_imports (
             tenant_id, carrier_id, statement_reference, statement_date,
             file_hash_sha256, total_gross_cents, total_net_cents,
             line_count, status, imported_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, 'registered', $9
           ) RETURNING id`,
          [
            ctx.tenantId,
            carrierId,
            statementReference,
            statementDate,
            fileHashSha256,
            totalGrossCents,
            totalNetCents,
            validatedLines.length,
            ctx.userId,
          ]
        )
      ).rows[0]!;

      let matchedCount = 0;
      let unmatchedCount = 0;
      let chargebackCount = 0;

      for (const line of validatedLines) {
        // Match against policy_records
        const policy = (
          await tx.query<{ id: string; producer_node_id: string }>(
            `SELECT id, producer_node_id FROM policy_records 
              WHERE tenant_id = $1 AND carrier_id = $2 AND policy_number = $3`,
            [ctx.tenantId, carrierId, line.policyNumber]
          )
        ).rows[0];

        let reconciliationStatus: ReconciliationStatus = 'unmatched';
        let exceptionReason: string | null = null;
        let policyId: string | null = null;
        let producerNodeId: string | null = null;

        if (policy) {
          policyId = policy.id;
          producerNodeId = policy.producer_node_id;
          if (line.transactionType === 'chargeback') {
            reconciliationStatus = 'chargeback_linked';
            chargebackCount++;
          } else {
            reconciliationStatus = 'matched';
            matchedCount++;
          }
        } else {
          reconciliationStatus = 'unmatched';
          exceptionReason = 'Policy not found in inventory';
          unmatchedCount++;
        }

        await tx.query(
          `INSERT INTO commission_line_items (
             tenant_id, import_id, policy_number, policy_id,
             carrier_producer_code, producer_node_id, transaction_type,
             gross_amount_cents, net_amount_cents, reconciliation_status,
             exception_reason
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
           )`,
          [
            ctx.tenantId,
            importRecord.id,
            line.policyNumber,
            policyId,
            line.carrierProducerCode,
            producerNodeId,
            line.transactionType,
            line.grossAmountCents,
            line.netAmountCents,
            reconciliationStatus,
            exceptionReason,
          ]
        );
      }

      // Determine final import status
      const finalStatus = unmatchedCount > 0 ? 'exceptions_flagged' : 'reconciled';
      await tx.query(
        `UPDATE commission_imports SET status = $1, updated_at = now() WHERE id = $2`,
        [finalStatus, importRecord.id]
      );

      return {
        id: importRecord.id,
        statementReference,
        carrierId,
        fileHashSha256,
        status: finalStatus,
        totalGrossCents,
        totalNetCents,
        lineCount: validatedLines.length,
        matchedCount,
        unmatchedCount,
        chargebackCount,
        payoutsDisabled: true,
      };
    });

    reply.code(201);
    return { import: result };
  });

  // 5. List Commission Imports
  app.get('/v1/commercial/commission-imports', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const rows = (
        await tx.query(
          `SELECT i.*, c.name AS carrier_name
             FROM commission_imports i
             JOIN carrier_directory c ON c.id = i.carrier_id
            WHERE i.tenant_id = $1
            ORDER BY i.statement_date DESC, i.imported_at DESC LIMIT 50`,
          [ctx.tenantId]
        )
      ).rows;
      return { imports: rows };
    });
  });

  // 6. Reconciliation Preview with Exception Visibility
  app.get('/v1/commercial/commission-imports/:id/preview', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    const id = (req.params as { id: string }).id;

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const imp = (
        await tx.query(
          `SELECT * FROM commission_imports WHERE id = $1 AND tenant_id = $2`,
          [id, ctx.tenantId]
        )
      ).rows[0];

      if (!imp) throw notFound('Commission import not found');

      const lines = (
        await tx.query(
          `SELECT l.*, p.plan_name, p.status AS policy_status
             FROM commission_line_items l
        LEFT JOIN policy_records p ON p.id = l.policy_id
            WHERE l.import_id = $1 AND l.tenant_id = $2
            ORDER BY l.reconciliation_status ASC, l.policy_number ASC`,
          [id, ctx.tenantId]
        )
      ).rows;

      const matchedCount = lines.filter((l) => l.reconciliation_status === 'matched').length;
      const unmatchedCount = lines.filter((l) => l.reconciliation_status === 'unmatched').length;
      const varianceCount = lines.filter((l) => l.reconciliation_status === 'variance_flagged').length;
      const chargebackCount = lines.filter((l) => l.reconciliation_status === 'chargeback_linked').length;

      return {
        preview: {
          importId: imp.id,
          statementReference: imp.statement_reference,
          carrierId: imp.carrier_id,
          statementDate: imp.statement_date,
          status: imp.status,
          totalGrossCents: imp.total_gross_cents,
          totalNetCents: imp.total_net_cents,
          lineCount: imp.line_count,
          matchedCount,
          unmatchedCount,
          varianceCount,
          chargebackCount,
          payoutsDisabled: true,
          lines,
        },
      };
    });
  });

  // 7. Payout Execution Guard (Fail-Closed)
  app.post('/v1/commercial/commission-imports/:id/payout', async () => {
    throw forbidden('Payouts are disabled until financial reconciliation and insurer approval are certified');
  });
}
