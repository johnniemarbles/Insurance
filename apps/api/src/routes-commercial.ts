import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  POLICY_STATUSES,
  PREMIUM_FREQUENCIES,
  COMMISSION_TRANSACTION_TYPES,
  validatePremiumCents,
  validateAmountCents,
  validateSha256Hash,
  calculateDeterministicSplit,
  parseCommissionCsv,
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

async function executeCommissionImportRegistration(
  tx: Tx,
  ctx: { tenantId: string; userId?: string | null },
  carrierId: string,
  statementReference: string,
  statementDate: string,
  fileHashSha256: string,
  validatedLines: Array<{
    policyNumber: string;
    grossAmountCents: number;
    netAmountCents: number;
    transactionType: CommissionTransactionType;
    carrierProducerCode?: string | null;
  }>
) {
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

  let totalGrossCents = 0;
  let totalNetCents = 0;
  for (const line of validatedLines) {
    totalGrossCents += line.grossAmountCents;
    totalNetCents += line.netAmountCents;
  }

  if (totalGrossCents < 0 || totalNetCents < 0) {
    throw invalid('Total statement gross and net amounts cannot be negative');
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
        ctx.userId ?? null,
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
        line.carrierProducerCode ?? null,
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
      return await executeCommissionImportRegistration(
        tx,
        ctx,
        carrierId,
        statementReference,
        statementDate,
        fileHashSha256,
        validatedLines
      );
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
          `SELECT i.*, c.display_name AS carrier_name
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

  // 7. Create or Version Commission Agreement
  app.post('/v1/commercial/agreements', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireImportAccess(roles, Boolean(ctx.isTenantAdmin));

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalid('JSON object body required');
    }
    const b = req.body as Record<string, unknown>;

    const producerNodeId = typeof b.producerNodeId === 'string' ? b.producerNodeId.trim() : '';
    const carrierId = typeof b.carrierId === 'string' ? b.carrierId.trim() : '';
    const version = typeof b.version === 'string' ? b.version.trim() : 'v1';
    const brokerSplitBps = Number(b.brokerSplitBps);
    const branchOverrideBps = Number(b.branchOverrideBps);
    const mgaSpreadBps = Number(b.mgaSpreadBps);
    if (b.holdbackBps === undefined || b.holdbackBps === null) {
      throw invalid('holdbackBps is required and must be explicitly specified (use 0 for no holdback)');
    }
    const holdbackBps = Number(b.holdbackBps);
    const effectiveFrom = typeof b.effectiveFrom === 'string' ? b.effectiveFrom.trim() : '';
    const effectiveTo = typeof b.effectiveTo === 'string' ? b.effectiveTo.trim() : null;

    if (!producerNodeId || !carrierId || !effectiveFrom) {
      throw invalid('producerNodeId, carrierId, and effectiveFrom are required');
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw invalid('effectiveTo cannot be earlier than effectiveFrom');
    }
    if (
      !Number.isInteger(brokerSplitBps) || brokerSplitBps < 0 ||
      !Number.isInteger(branchOverrideBps) || branchOverrideBps < 0 ||
      !Number.isInteger(mgaSpreadBps) || mgaSpreadBps < 0
    ) {
      throw invalid('brokerSplitBps, branchOverrideBps, and mgaSpreadBps must be non-negative integers');
    }
    if (brokerSplitBps + branchOverrideBps + mgaSpreadBps !== 10000) {
      throw invalid(`Split basis points must equal exactly 10,000 (100.00%), received: ${brokerSplitBps + branchOverrideBps + mgaSpreadBps}`);
    }
    if (!Number.isInteger(holdbackBps) || holdbackBps < 0 || holdbackBps > brokerSplitBps) {
      throw invalid('holdbackBps must be an integer between 0 and brokerSplitBps (cannot exceed broker share)');
    }

    const agreement = await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const carrierExists = (
        await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [carrierId])
      ).rowCount! > 0;
      if (!carrierExists) throw notFound('Carrier not found in directory');

      const producerExists = (
        await tx.query(
          `SELECT 1 FROM org_nodes WHERE id = $1 AND tenant_id = $2 AND type = 'partner'`,
          [producerNodeId, ctx.tenantId]
        )
      ).rowCount! > 0;
      if (!producerExists) throw invalid('Producer must be an active partner node');

      // Enforce non-overlapping active agreement validity
      const overlapping = (
        await tx.query<{ id: string; version: string; effective_from: string; effective_to: string | null }>(
          `SELECT id, version, effective_from::text, effective_to::text
             FROM commission_agreements
            WHERE tenant_id = $1
              AND producer_node_id = $2
              AND carrier_id = $3
              AND status = 'active'
              AND version <> $4
              AND daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') &&
                  daterange($5::date, coalesce($6::date, 'infinity'::date), '[]')`,
          [ctx.tenantId, producerNodeId, carrierId, version, effectiveFrom, effectiveTo]
        )
      ).rows[0];

      if (overlapping) {
        throw conflict(
          `Active agreement version '${overlapping.version}' (${overlapping.effective_from} to ${overlapping.effective_to ?? 'infinity'}) overlaps with requested validity period`
        );
      }

      const row = (
        await tx.query(
          `INSERT INTO commission_agreements (
             tenant_id, producer_node_id, carrier_id, version,
             broker_split_bps, branch_override_bps, mga_spread_bps,
             holdback_bps, effective_from, effective_to, status,
             approved_by, approved_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, now()
           )
           ON CONFLICT (tenant_id, producer_node_id, carrier_id, version) DO UPDATE SET
             broker_split_bps = EXCLUDED.broker_split_bps,
             branch_override_bps = EXCLUDED.branch_override_bps,
             mga_spread_bps = EXCLUDED.mga_spread_bps,
             holdback_bps = EXCLUDED.holdback_bps,
             effective_from = EXCLUDED.effective_from,
             effective_to = EXCLUDED.effective_to,
             status = 'active',
             approved_by = EXCLUDED.approved_by,
             approved_at = now(),
             updated_at = now()
           RETURNING *`,
          [
            ctx.tenantId,
            producerNodeId,
            carrierId,
            version,
            brokerSplitBps,
            branchOverrideBps,
            mgaSpreadBps,
            holdbackBps,
            effectiveFrom,
            effectiveTo,
            ctx.userId,
          ]
        )
      ).rows[0];

      return row;
    });

    reply.code(201);
    return { agreement };
  });

  // 8. List Commission Agreements
  app.get('/v1/commercial/agreements', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const producerNodeId = q.producer_node_id?.trim();
    const carrierId = q.carrier_id?.trim();

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      let sql = `SELECT a.*, n.name AS producer_name FROM commission_agreements a JOIN org_nodes n ON n.id = a.producer_node_id WHERE a.tenant_id = $1`;
      const params: unknown[] = [ctx.tenantId];

      if (producerNodeId) {
        params.push(producerNodeId);
        sql += ` AND a.producer_node_id = $${params.length}`;
      }
      if (carrierId) {
        params.push(carrierId);
        sql += ` AND a.carrier_id = $${params.length}`;
      }

      sql += ` ORDER BY a.created_at DESC`;
      const rows = (await tx.query(sql, params)).rows;
      return { agreements: rows };
    });
  });

  // 9. Safe CSV Statement Preview (No commit)
  app.post('/v1/commercial/commission-imports/csv-preview', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireImportAccess(roles, Boolean(ctx.isTenantAdmin));

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalid('JSON object body required');
    }
    const b = req.body as Record<string, unknown>;
    const carrierId = typeof b.carrierId === 'string' ? b.carrierId.trim() : '';
    const csvContent = typeof b.csvContent === 'string' ? b.csvContent : '';

    if (!carrierId || !csvContent) {
      throw invalid('carrierId and csvContent are required');
    }

    let parsedRows;
    try {
      parsedRows = parseCommissionCsv(csvContent, carrierId);
    } catch (e) {
      throw invalid((e as Error).message);
    }

    const fileHashSha256 = createHash('sha256').update(csvContent.trim()).digest('hex');

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const isDuplicate = (
        await tx.query(
          `SELECT 1 FROM commission_imports WHERE tenant_id = $1 AND carrier_id = $2 AND file_hash_sha256 = $3`,
          [ctx.tenantId, carrierId, fileHashSha256]
        )
      ).rowCount! > 0;

      let totalGrossCents = 0;
      let totalNetCents = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let chargebackCount = 0;

      const lines = [];

      for (const row of parsedRows) {
        totalGrossCents += row.grossAmountCents;
        totalNetCents += row.netAmountCents;

        const policy = (
          await tx.query<{ id: string; producer_node_id: string; plan_name: string }>(
            `SELECT id, producer_node_id, plan_name FROM policy_records
              WHERE tenant_id = $1 AND carrier_id = $2 AND policy_number = $3`,
            [ctx.tenantId, carrierId, row.policyNumber]
          )
        ).rows[0];

        let status: ReconciliationStatus = 'unmatched';
        let exceptionReason: string | null = null;

        if (policy) {
          if (row.transactionType === 'chargeback') {
            status = 'chargeback_linked';
            chargebackCount++;
          } else {
            status = 'matched';
            matchedCount++;
          }
        } else {
          status = 'unmatched';
          exceptionReason = 'Policy not found in inventory';
          unmatchedCount++;
        }

        lines.push({
          policyNumber: row.policyNumber,
          planName: policy?.plan_name ?? null,
          grossAmountCents: row.grossAmountCents,
          netAmountCents: row.netAmountCents,
          transactionType: row.transactionType,
          reconciliationStatus: status,
          exceptionReason,
        });
      }

      return {
        preview: {
          fileHashSha256,
          isDuplicate,
          totalGrossCents,
          totalNetCents,
          lineCount: parsedRows.length,
          matchedCount,
          unmatchedCount,
          chargebackCount,
          lines,
        },
      };
    });
  });

  // 10. Direct CSV Ingestion & Idempotent Statement Import
  app.post('/v1/commercial/commission-imports/csv', async (req, reply) => {
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
    const csvContent = typeof b.csvContent === 'string' ? b.csvContent : '';

    if (!carrierId || !statementReference || !statementDate || !csvContent) {
      throw invalid('carrierId, statementReference, statementDate, and csvContent are required');
    }

    let parsedRows;
    try {
      parsedRows = parseCommissionCsv(csvContent, carrierId);
    } catch (e) {
      throw invalid((e as Error).message);
    }

    const fileHashSha256 = createHash('sha256').update(csvContent.trim()).digest('hex');

    const result = await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      return await executeCommissionImportRegistration(
        tx,
        ctx,
        carrierId,
        statementReference,
        statementDate,
        fileHashSha256,
        parsedRows
      );
    });

    reply.code(201);
    return { import: result };
  });

  // 11. Approve Reconciliation & Compute Deterministic Splits
  app.post('/v1/commercial/commission-imports/:id/approve', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireImportAccess(roles, Boolean(ctx.isTenantAdmin));

    const id = (req.params as { id: string }).id;

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const imp = (
        await tx.query<{
          id: string;
          carrier_id: string;
          status: string;
          statement_reference: string;
          statement_date: string;
          total_gross_cents: number;
          total_net_cents: number;
          line_count: number;
        }>(
          `SELECT id, carrier_id, status, statement_reference, statement_date::text AS statement_date,
                  total_gross_cents, total_net_cents, line_count
             FROM commission_imports WHERE id = $1 AND tenant_id = $2`,
          [id, ctx.tenantId]
        )
      ).rows[0];

      if (!imp) throw notFound('Commission import not found');
      if (imp.status === 'approved' || imp.status === 'posted') {
        throw conflict(`Statement is already ${imp.status} and cannot be modified`);
      }

      // Guard: Statement cannot be approved if any unmatched exception lines remain
      const unmatchedCount = (
        await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM commission_line_items
            WHERE import_id = $1 AND tenant_id = $2 AND reconciliation_status = 'unmatched'`,
          [id, ctx.tenantId]
        )
      ).rows[0]?.n ?? 0;

      if (unmatchedCount > 0) {
        throw conflict(`Cannot approve statement with ${unmatchedCount} unresolved exception line(s)`);
      }

      // Load matched and chargeback line items
      const lines = (
        await tx.query<{
          id: string;
          policy_number: string;
          producer_node_id: string | null;
          gross_amount_cents: number;
          reconciliation_status: string;
        }>(
          `SELECT id, policy_number, producer_node_id, gross_amount_cents, reconciliation_status
             FROM commission_line_items
            WHERE import_id = $1 AND tenant_id = $2
              AND reconciliation_status IN ('matched', 'chargeback_linked')`,
          [id, ctx.tenantId]
        )
      ).rows;

      let splitCount = 0;
      let totBrokerNet = 0;
      let totBranchOverride = 0;
      let totMgaSpread = 0;
      let totHoldback = 0;
      const appliedAgreements = new Map<string, {
        id: string;
        version: string;
        brokerSplitBps: number;
        branchOverrideBps: number;
        mgaSpreadBps: number;
        holdbackBps: number;
      }>();
      const computedSplits: Array<Record<string, unknown>> = [];

      for (const line of lines) {
        if (!line.producer_node_id) continue;

        // Fetch active agreement valid on the statement date
        const agreement = (
          await tx.query<{
            id: string;
            version: string;
            broker_split_bps: number;
            branch_override_bps: number;
            mga_spread_bps: number;
            holdback_bps: number;
          }>(
            `SELECT id, version, broker_split_bps, branch_override_bps, mga_spread_bps, holdback_bps
               FROM commission_agreements
              WHERE tenant_id = $1 AND producer_node_id = $2 AND carrier_id = $3 AND status = 'active'
                AND effective_from <= $4::date
                AND (effective_to IS NULL OR effective_to >= $4::date)
              ORDER BY effective_from DESC LIMIT 1`,
            [ctx.tenantId, line.producer_node_id, imp.carrier_id, imp.statement_date]
          )
        ).rows[0];

        const activeBps = agreement
          ? {
              brokerSplitBps: agreement.broker_split_bps,
              branchOverrideBps: agreement.branch_override_bps,
              mgaSpreadBps: agreement.mga_spread_bps,
              holdbackBps: agreement.holdback_bps,
            }
          : {
              brokerSplitBps: 7000,
              branchOverrideBps: 1500,
              mgaSpreadBps: 1500,
              holdbackBps: 0, // No arbitrary holdback if no agreement
            };

        if (agreement) {
          appliedAgreements.set(agreement.id, {
            id: agreement.id,
            version: agreement.version,
            brokerSplitBps: agreement.broker_split_bps,
            branchOverrideBps: agreement.branch_override_bps,
            mgaSpreadBps: agreement.mga_spread_bps,
            holdbackBps: agreement.holdback_bps,
          });
        }

        const splits = calculateDeterministicSplit(line.gross_amount_cents, activeBps);
        const splitStatus = line.gross_amount_cents < 0 ? 'clawback' : 'approved';

        totBrokerNet += splits.brokerNetCents;
        totBranchOverride += splits.branchOverrideCents;
        totMgaSpread += splits.mgaSpreadCents;
        totHoldback += splits.holdbackCents;

        computedSplits.push({
          lineItemId: line.id,
          policyNumber: line.policy_number,
          grossAmountCents: line.gross_amount_cents,
          brokerNetCents: splits.brokerNetCents,
          branchOverrideCents: splits.branchOverrideCents,
          mgaSpreadCents: splits.mgaSpreadCents,
          holdbackCents: splits.holdbackCents,
          status: splitStatus,
        });

        await tx.query(
          `INSERT INTO commission_splits (
             tenant_id, import_id, line_item_id, agreement_id,
             producer_node_id, gross_amount_cents, broker_net_cents,
             branch_override_cents, mga_spread_cents, holdback_cents,
             status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
           )
           ON CONFLICT (tenant_id, import_id, line_item_id) DO UPDATE SET
             agreement_id = EXCLUDED.agreement_id,
             gross_amount_cents = EXCLUDED.gross_amount_cents,
             broker_net_cents = EXCLUDED.broker_net_cents,
             branch_override_cents = EXCLUDED.branch_override_cents,
             mga_spread_cents = EXCLUDED.mga_spread_cents,
             holdback_cents = EXCLUDED.holdback_cents,
             status = EXCLUDED.status`,
          [
            ctx.tenantId,
            id,
            line.id,
            agreement?.id ?? null,
            line.producer_node_id,
            line.gross_amount_cents,
            splits.brokerNetCents,
            splits.branchOverrideCents,
            splits.mgaSpreadCents,
            splits.holdbackCents,
            splitStatus,
          ]
        );
        splitCount++;
      }

      const firstAgreement = appliedAgreements.values().next().value;
      const approvalSnapshot = {
        statementId: id,
        carrierId: imp.carrier_id,
        statementReference: imp.statement_reference,
        statementDate: imp.statement_date,
        agreementVersion: firstAgreement?.version ?? null,
        approvedAt: new Date().toISOString(),
        approvedBy: ctx.userId,
        totalGrossCents: imp.total_gross_cents,
        totalNetCents: imp.total_net_cents,
        lineCount: lines.length,
        splitCount,
        totals: {
          brokerNetCents: totBrokerNet,
          branchOverrideCents: totBranchOverride,
          mgaSpreadCents: totMgaSpread,
          holdbackCents: totHoldback,
        },
        appliedAgreements: Array.from(appliedAgreements.values()),
        splits: computedSplits,
      };

      await tx.query(
        `UPDATE commission_imports
            SET status = 'approved',
                approval_snapshot = $2,
                approved_by = $3,
                approved_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [id, JSON.stringify(approvalSnapshot), ctx.userId]
      );

      return {
        approved: true,
        importId: id,
        statementReference: imp.statement_reference,
        status: 'approved',
        splitCount,
        approvalSnapshot,
      };
    });
  });

  // 12. List Calculated Splits for Statement
  app.get('/v1/commercial/commission-imports/:id/splits', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireCommercialAccess(roles, Boolean(ctx.isTenantAdmin));

    const id = (req.params as { id: string }).id;

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const splits = (
        await tx.query(
          `SELECT s.*, n.name AS producer_name, l.policy_number, l.transaction_type
             FROM commission_splits s
             JOIN org_nodes n ON n.id = s.producer_node_id
             JOIN commission_line_items l ON l.id = s.line_item_id
            WHERE s.import_id = $1 AND s.tenant_id = $2
            ORDER BY s.created_at ASC`,
          [id, ctx.tenantId]
        )
      ).rows;

      return { splits };
    });
  });

  // 13. Reconcile Exception Line
  app.post('/v1/commercial/commission-imports/:id/reconcile-line', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = ctx.roles.map((r) => r.role);
    requireImportAccess(roles, Boolean(ctx.isTenantAdmin));

    const id = (req.params as { id: string }).id;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalid('JSON object body required');
    }
    const b = req.body as Record<string, unknown>;
    const lineItemId = typeof b.lineItemId === 'string' ? b.lineItemId.trim() : '';
    const policyNumber = typeof b.policyNumber === 'string' ? b.policyNumber.trim() : '';

    if (!lineItemId || !policyNumber) {
      throw invalid('lineItemId and policyNumber are required');
    }

    return await withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const imp = (
        await tx.query<{ carrier_id: string }>(
          `SELECT carrier_id FROM commission_imports WHERE id = $1 AND tenant_id = $2`,
          [id, ctx.tenantId]
        )
      ).rows[0];
      if (!imp) throw notFound('Commission import not found');

      const policy = (
        await tx.query<{ id: string; producer_node_id: string }>(
          `SELECT id, producer_node_id FROM policy_records
            WHERE tenant_id = $1 AND carrier_id = $2 AND policy_number = $3`,
          [ctx.tenantId, imp.carrier_id, policyNumber]
        )
      ).rows[0];
      if (!policy) throw notFound('Target policy not found in inventory');

      await tx.query(
        `UPDATE commission_line_items
            SET policy_id = $3,
                producer_node_id = $4,
                reconciliation_status = 'matched',
                exception_reason = NULL
          WHERE id = $1 AND import_id = $2 AND tenant_id = $5`,
        [lineItemId, id, policy.id, policy.producer_node_id, ctx.tenantId]
      );

      // Check remaining unmatched
      const remainingUnmatched = (
        await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM commission_line_items
            WHERE import_id = $1 AND tenant_id = $2 AND reconciliation_status = 'unmatched'`,
          [id, ctx.tenantId]
        )
      ).rows[0]?.n ?? 0;

      if (remainingUnmatched === 0) {
        await tx.query(
          `UPDATE commission_imports SET status = 'reconciled', updated_at = now() WHERE id = $1`,
          [id]
        );
      }

      return {
        resolved: true,
        lineItemId,
        remainingUnmatched,
        importStatus: remainingUnmatched === 0 ? 'reconciled' : 'exceptions_flagged',
      };
    });
  });

  // 14. Payout Execution Guard (Fail-Closed)
  app.post('/v1/commercial/commission-imports/:id/payout', async () => {
    throw forbidden('Payouts are disabled until financial reconciliation and insurer approval are certified');
  });
}

