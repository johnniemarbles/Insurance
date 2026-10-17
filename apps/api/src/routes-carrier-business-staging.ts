import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stage business internally; this route never contacts a carrier. */
export function registerCarrierBusinessStagingRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/compliance/carrier-contracts/:id/business-staging', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw invalid('Invalid contract ID');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{ tenant_id: string; node_id: string }>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1', [id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');
      const allowed = (await tx.query<{ ok: boolean }>('SELECT app_is_compliance_at_or_above($1,$2) AS ok', [c.tenant_id,c.node_id])).rows[0]?.ok === true;
      if (!allowed) throw forbidden('Compliance authorization required');
      const submissions = (await tx.query('SELECT id,product_code,external_reference,status,created_by,created_at FROM carrier_business_submissions WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 ORDER BY created_at DESC LIMIT 100', [c.tenant_id,c.node_id,id])).rows;
      return { submissions };
    });
  });
  app.post('/v1/compliance/carrier-contracts/:id/business-staging', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    const input = (req.body ?? {}) as Record<string, unknown>;
    const productCode = typeof input.productCode === 'string' ? input.productCode.trim().toUpperCase() : '';
    const reference = typeof input.externalReference === 'string' ? input.externalReference.trim() : '';
    if (Object.keys(input).some(key => !['productCode','externalReference'].includes(key)))
      throw invalid('Only productCode and externalReference are accepted');
    if (!UUID.test(id) || !/^[A-Z0-9_-]{1,80}$/.test(productCode) || reference.length < 1 || reference.length > 120)
      throw invalid('Valid contract, product and reference required');
    const result = await withRequestTx(deps.appPool, ctx, async tx => {
      const contract = (await tx.query<{ tenant_id: string; node_id: string }>(
        'SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!contract) throw notFound('Carrier contract not found');
      const allowed = (await tx.query<{ ok: boolean }>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok',
        [contract.tenant_id, contract.node_id])).rows[0]?.ok === true;
      if (!allowed) throw forbidden('Compliance authorization required');
      const authorized = (await tx.query<{ ok: boolean }>(
        'SELECT carrier_product_submission_authorized_locked($1,$2) AS ok',
        [id, productCode])).rows[0]?.ok === true;
      if (!authorized) return { staged: false, reason: 'carrier_product_not_authorized' };
      const existing = (await tx.query<{ id: string; product_code: string }>(
        'SELECT id,product_code FROM carrier_business_submissions WHERE tenant_id=$1 AND contract_id=$2 AND external_reference=$3',
        [contract.tenant_id,id,reference])).rows[0];
      if (existing) return { staged: false, reason: 'duplicate_external_reference' };
      const created = (await tx.query<{ id: string }>(
        'INSERT INTO carrier_business_submissions (tenant_id,node_id,contract_id,product_code,external_reference,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [contract.tenant_id, contract.node_id, id, productCode, reference, ctx.userId])).rows[0];
      await audit(tx, ctx, 'compliance.carrier_business_staged', 'carrier_business_submission', created.id, { contractId: id, productCode });
      return { staged: true, id: created.id, status: 'staged' as const };
    });
    reply.code(result.staged ? 201 : 409);
    return result;
  });
}
