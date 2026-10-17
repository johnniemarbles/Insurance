import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { canMoveCarrierContract, type CarrierContractState } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

export function registerCarrierReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/compliance/carrier-contracts/:id/review', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid('Invalid ID');
    const input = (req.body ?? {}) as Record<string, unknown>;
    const next = String(input.state ?? '') as CarrierContractState;
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    return withRequestTx(deps.appPool, ctx, async tx => {
      const row = (await tx.query<{ tenant_id: string; node_id: string; state: CarrierContractState }>(
        'SELECT tenant_id,node_id,state FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row) throw notFound('Carrier contract not found');
      const allowed = (await tx.query<{ ok: boolean }>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[row.tenant_id,row.node_id])).rows[0]?.ok;
      if (!allowed) throw forbidden('Compliance authorization required');
      if (!canMoveCarrierContract(row.state,next)) throw invalid('Invalid transition');
      if (['broker_signed','appointment_verified','active','approved'].includes(next))
        throw invalid('Signature, appointment verification and activation require integrated evidence workflows');
      if (['declined','withdrawn','suspended','terminated','correction_required'].includes(next) && !reason)
        throw invalid('Reason required');
      await tx.query('UPDATE carrier_contract_cases SET state=$1,updated_at=now() WHERE id=$2',[next,id]);
      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id,contract_id,node_id,from_state,to_state,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [row.tenant_id,id,row.node_id,row.state,next,ctx.userId,reason || null]);
      await audit(tx,ctx,'compliance.carrier_review','carrier_contract_case',id,{from:row.state,to:next});
      return {id,state:next};
    });
  });
  app.post('/v1/compliance/carrier-contracts/:id/evidence', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid('Invalid ID');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind;
    const ref = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!['signature','carrier_approval','appointment'].includes(String(kind)) || ref.length < 8 || ref.length > 500)
      throw invalid('Valid evidence kind and reference are required');
    // Evidence reference is an internal review record, not self-attested signing or insurer verification.
    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{ tenant_id: string; node_id: string; state: CarrierContractState }>(
        'SELECT tenant_id,node_id,state FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');
      const ok = (await tx.query<{ ok: boolean }>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
      if (!ok) throw forbidden('Compliance authorization required');
      if (kind === 'signature' && c.state !== 'documents_prepared') throw invalid('Contract is not ready for signing review');
      if (kind === 'carrier_approval' && c.state !== 'carrier_review') throw invalid('Carrier review is not in progress');
      if (kind === 'appointment' && c.state !== 'approved') throw invalid('Carrier approval required before appointment');
      // Store references for independent verification; no state or authorization change occurs here.
      await audit(tx,ctx,'compliance.carrier_evidence_reference','carrier_contract_case',id,{kind,reference:ref});
      return { id, recorded: true, state: c.state, authorizationGranted: false };
    });
  });

}
