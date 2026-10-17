import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw invalid('Invalid case ID');
  return v;
};
export function registerCarrierContractRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/compliance/carrier-contracts', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async tx => {
      const rows = (await tx.query(
        `SELECT cc.id, cc.onboarding_case_id AS "onboardingCaseId", cc.node_id AS "nodeId",
                cc.carrier_name AS "carrierName", cc.jurisdiction, cc.state,
                CASE WHEN cc.state IN ('active','appointment_verified')
                           AND cc.appointment_expires_on < CURRENT_DATE THEN 'expired'
                     ELSE cc.state END AS "effectiveState",
                cc.template_version AS "templateVersion",
                cc.appointment_effective_on AS "appointmentEffectiveOn", cc.appointment_expires_on AS "appointmentExpiresOn",
                CASE WHEN cc.state = 'active' AND cc.appointment_effective_on <= CURRENT_DATE AND
                    (cc.appointment_expires_on IS NULL OR cc.appointment_expires_on >= CURRENT_DATE)
                    THEN true ELSE false END AS "appointmentCurrentlyValid",
                cc.created_at AS "createdAt", cc.updated_at AS "updatedAt"
           FROM carrier_contract_cases cc
          WHERE app_is_compliance_at_or_above(cc.tenant_id, cc.node_id)
          ORDER BY cc.updated_at DESC LIMIT 200`)).rows;
      return { contracts: rows };
    });
  });
  app.get('/v1/onboarding/cases/:id/carrier-contracts', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{ node_id: string }>('SELECT node_id FROM onboarding_cases WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Onboarding case not found');
      const permitted = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_compliance_at_or_above(app_tenant_id(), $1) OR EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id()) AS ok`, [c.node_id])).rows[0]?.ok;
      if (!permitted) throw forbidden('Cannot access this onboarding case');
      const rows = (await tx.query(
        `SELECT id, carrier_name AS "carrierName", jurisdiction, state, template_version AS "templateVersion",
                appointment_effective_on AS "appointmentEffectiveOn", appointment_expires_on AS "appointmentExpiresOn",
                CASE WHEN state IN ('active','appointment_verified')
                           AND appointment_expires_on < CURRENT_DATE THEN 'expired'
                     ELSE state END AS "effectiveState",
                created_at AS "createdAt" FROM carrier_contract_cases
           WHERE onboarding_case_id = $1 ORDER BY created_at`, [id])).rows;
      return { contracts: rows };
    });
  });
  app.post('/v1/onboarding/cases/:id/carrier-contracts', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const id = uuid((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const carrierName = typeof body.carrierName === 'string' ? body.carrierName.trim() : '';
    const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.trim().toUpperCase() : '';
    if (!carrierName || carrierName.length > 120 || !/^[A-Z]{2}(?:-[A-Z0-9]{2,10})?$/.test(jurisdiction))
      throw invalid('Carrier and jurisdiction are required');
    const result = await withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{ tenant_id: string; node_id: string }>(
        'SELECT tenant_id, node_id FROM onboarding_cases WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Onboarding case not found');
      const permitted = (await tx.query<{ ok: boolean }>(
        `SELECT app_is_compliance_at_or_above($1,$2) OR EXISTS
           (SELECT 1 FROM user_node_roles WHERE node_id = $2 AND user_id = app_user_id()) AS ok`,
        [c.tenant_id, c.node_id])).rows[0]?.ok;
      if (!permitted) throw forbidden('Only the broker or Compliance may request carrier contracting');
      const created = (await tx.query<{ id: string }>(
        `INSERT INTO carrier_contract_cases
           (tenant_id,onboarding_case_id,node_id,carrier_name,jurisdiction,created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (onboarding_case_id,carrier_name,jurisdiction) DO NOTHING RETURNING id`,
        [c.tenant_id,id,c.node_id,carrierName,jurisdiction,ctx.userId])).rows[0];
      if (!created) throw invalid('Carrier already selected for this jurisdiction');
      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id,contract_id,node_id,to_state,actor_id) VALUES ($1,$2,$3,$4,$5)',
        [c.tenant_id,created.id,c.node_id,'requested',ctx.userId]);
      await audit(tx,ctx,'onboarding.carrier_requested','carrier_contract_case',created.id,{carrierName,jurisdiction});
      return { id: created.id, state: 'requested' as const };
    });
    reply.code(201);
    return result;
  });
}
