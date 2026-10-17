import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Restricted, tenant-scoped audit timeline. Brokers cannot read reviewer reasons. */
export function registerCarrierHistoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/compliance/carrier-contracts/:id/history', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as {id:string}).id;
    if (!UUID.test(id)) throw invalid('Invalid carrier contract ID');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{tenant_id:string;node_id:string}>(
        'SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1',[id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');
      const allowed = (await tx.query<{ok:boolean}>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok === true;
      if (!allowed) throw forbidden('Compliance authorization required');
      const events = (await tx.query(
        `SELECT id,from_state AS "fromState",to_state AS "toState",
                actor_id AS "actorId",reason,recorded_at AS "recordedAt"
           FROM carrier_contract_events
          WHERE contract_id=$1 AND tenant_id=$2 AND node_id=$3
          ORDER BY recorded_at DESC,id DESC LIMIT 200`,[id,c.tenant_id,c.node_id])).rows;
      return {id,events,limit:200};
    });
  });
}
