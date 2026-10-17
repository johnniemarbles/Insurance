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
      if (row.state === 'active' && next === 'expired') throw invalid('Expiry is established by appointment dates; use expiry reconciliation');
      if (next === 'documents_prepared' && (typeof input.templateVersion !== 'string' || !input.templateVersion.trim() || input.templateVersion.trim().length > 120)) throw invalid('Valid agreement template version required');
      if (['broker_signed','appointment_verified','active','approved'].includes(next))
        throw invalid('Signature, appointment verification and activation require integrated evidence workflows');
      if (['declined','withdrawn','suspended','terminated','correction_required'].includes(next) && !reason)
        throw invalid('Reason required');
      await tx.query(`UPDATE carrier_contract_cases SET state=$1,template_version=CASE WHEN $1='documents_prepared' THEN $3 ELSE template_version END,signature_evidence_ref=CASE WHEN $1='documents_prepared' THEN NULL ELSE signature_evidence_ref END,signature_verified_by=CASE WHEN $1='documents_prepared' THEN NULL ELSE signature_verified_by END,signature_verified_at=CASE WHEN $1='documents_prepared' THEN NULL ELSE signature_verified_at END,carrier_approval_ref=CASE WHEN $1='documents_prepared' THEN NULL ELSE carrier_approval_ref END,carrier_approved_by=CASE WHEN $1='documents_prepared' THEN NULL ELSE carrier_approved_by END,carrier_approved_at=CASE WHEN $1='documents_prepared' THEN NULL ELSE carrier_approved_at END,appointment_reference=CASE WHEN $1='documents_prepared' THEN NULL ELSE appointment_reference END,appointment_effective_on=CASE WHEN $1='documents_prepared' THEN NULL ELSE appointment_effective_on END,appointment_expires_on=CASE WHEN $1='documents_prepared' THEN NULL ELSE appointment_expires_on END,verified_by=CASE WHEN $1='documents_prepared' THEN NULL ELSE verified_by END,verified_at=CASE WHEN $1='documents_prepared' THEN NULL ELSE verified_at END,updated_at=now() WHERE id=$2`,[next,id,typeof input.templateVersion === 'string' ? input.templateVersion.trim() : null]);
      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id,contract_id,node_id,from_state,to_state,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [row.tenant_id,id,row.node_id,row.state,next,ctx.userId,reason || null]);
      await audit(tx,ctx,'compliance.carrier_review','carrier_contract_case',id,{from:row.state,to:next});
      return {id,state:next};
    });
  });
  // Compliance may record independently checked insurer evidence. The reviewer's
  // attestation is auditable; no carrier API verification is implied.
  app.post('/v1/compliance/carrier-contracts/:id/verify', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid('Invalid ID');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = b.kind;
    const reference = typeof b.reference === 'string' ? b.reference.trim() : '';
    if (!['signature','carrier_approval','appointment'].includes(String(kind)) || reference.length < 8 || reference.length > 500 || b.confirmedWithSource !== true)
      throw invalid('Evidence reference and independent source confirmation required');
    const effective = typeof b.effectiveOn === 'string' ? b.effectiveOn : '';
    const expiry = typeof b.expiresOn === 'string' ? b.expiresOn : '';
    if (kind === 'appointment' && (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)))
      throw invalid('Valid appointment effective and expiry dates required');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const c = (await tx.query<{tenant_id:string;node_id:string;state:CarrierContractState}>(
        'SELECT tenant_id,node_id,state FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!c) throw notFound('Carrier contract not found');
      const ok = (await tx.query<{ok:boolean}>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
      if (!ok) throw forbidden('Compliance authorization required');
      const next: CarrierContractState = kind === 'signature' ? 'broker_signed' : kind === 'carrier_approval' ? 'approved' : 'appointment_verified';
      if (!canMoveCarrierContract(c.state,next)) throw invalid('Invalid verification transition');
      if (kind === 'signature') {
        const prepared = (await tx.query<{template_version:string|null}>('SELECT template_version FROM carrier_contract_cases WHERE id=$1',[id])).rows[0];
        if (!prepared?.template_version) throw invalid('Agreement template version required before signature verification');
      }
      if (kind === 'signature') await tx.query(
        'UPDATE carrier_contract_cases SET signature_evidence_ref=$1,signature_verified_by=$2,signature_verified_at=now(),state=$3,updated_at=now() WHERE id=$4',
        [reference,ctx.userId,next,id]);
      else if (kind === 'carrier_approval') await tx.query(
        'UPDATE carrier_contract_cases SET carrier_approval_ref=$1,carrier_approved_by=$2,carrier_approved_at=now(),state=$3,updated_at=now() WHERE id=$4',
        [reference,ctx.userId,next,id]);
      else {
        const valid = (await tx.query<{ok:boolean}>(
          'SELECT $1::date <= CURRENT_DATE AND $2::date >= CURRENT_DATE AND $2::date >= $1::date AS ok',
          [effective,expiry])).rows[0]?.ok;
        if (!valid) throw invalid('Appointment is not currently effective');
        await tx.query(
          'UPDATE carrier_contract_cases SET appointment_reference=$1,appointment_effective_on=$2,appointment_expires_on=$3,verified_by=$4,verified_at=now(),state=$5,updated_at=now() WHERE id=$6',
          [reference,effective,expiry,ctx.userId,next,id]);
      }
      await tx.query(
        'INSERT INTO carrier_contract_events (tenant_id,contract_id,node_id,from_state,to_state,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.tenant_id,id,c.node_id,c.state,next,ctx.userId,'Independent source confirmed: '+reference]);
      await audit(tx,ctx,'compliance.carrier_evidence_verified','carrier_contract_case',id,{kind,reference,from:c.state,to:next});
      return {id,state:next,authorizationGranted:false};
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
      // A reference is only a review note; independent source verification remains mandatory.
      await audit(tx,ctx,'compliance.carrier_evidence_reference','carrier_contract_case',id,{kind,reference:ref});
      return { id, recorded: true, state: c.state, authorizationGranted: false };
    });
  });

}
