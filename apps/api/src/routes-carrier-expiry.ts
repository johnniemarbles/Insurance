import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden } from './errors.ts';
import type { AppDeps } from './app.ts';

/** Reconcile expired appointments under a Compliance officer's tenant/region scope.
 * This is not an activation path; it only revokes an outdated contract state.
 */
export function registerCarrierExpiryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/compliance/carrier-contracts/reconcile-expiry', async req => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async tx => {
      const authorized = (await tx.query<{ok:boolean}>(
        'SELECT app_is_tenant_admin() OR app_is_compliance_role() AS ok')).rows[0]?.ok === true;
      if (!authorized) throw forbidden('Compliance authorization required');
      const rows = (await tx.query<{id:string;tenant_id:string;node_id:string;state:string}>(
        `SELECT id,tenant_id,node_id,state FROM carrier_contract_cases
         WHERE state IN ('active','appointment_verified')
           AND appointment_expires_on < CURRENT_DATE
           AND app_is_compliance_at_or_above(tenant_id,node_id)
         ORDER BY id FOR UPDATE LIMIT 200`)).rows;
      for (const row of rows) {
        await tx.query("UPDATE carrier_contract_cases SET state='expired',updated_at=now() WHERE id=$1",[row.id]);
        await tx.query(
          'INSERT INTO carrier_contract_events (tenant_id,contract_id,node_id,from_state,to_state,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [row.tenant_id,row.id,row.node_id,row.state,'expired',ctx.userId,'Appointment expiry reconciled']);
        await audit(tx,ctx,'compliance.carrier_expired','carrier_contract_case',row.id,{from:row.state,to:'expired'});
      }
      return {expired:rows.length,hasMore:rows.length===200};
    });
  });
}
