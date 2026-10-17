import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds=['training','product_scope','jurisdiction_scope','hold_clearance'];
export function registerCarrierAuthorizationEvidenceRoutes(app:FastifyInstance,deps:AppDeps):void {
  app.get('/v1/compliance/carrier-contracts/:id/authorization-evidence',async req=>{
    const {ctx}=await deps.authenticate(req);
    const id=(req.params as {id:string}).id;
    if(!UUID.test(id)) throw invalid('Invalid contract ID');
    return withRequestTx(deps.appPool,ctx,async tx=>{
      const c=(await tx.query<{tenant_id:string;node_id:string}>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1',[id])).rows[0];
      if(!c) throw notFound('Contract not found');
      const allowed=(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
      if(!allowed) throw forbidden('Compliance authorization required');
      const rows=(await tx.query(
        'SELECT id,kind,product_code AS "productCode",evidence_ref AS "evidenceRef",verified_at AS "verifiedAt",effective_on AS "effectiveOn",expires_on AS "expiresOn",revoked_at AS "revokedAt",revocation_reason AS "revocationReason" FROM carrier_authorization_evidence WHERE contract_id=$1 AND tenant_id=$2 AND node_id=$3 ORDER BY verified_at DESC LIMIT 200',
        [id,c.tenant_id,c.node_id])).rows;
      return {evidence:rows};
    });
  });
  app.post('/v1/compliance/carrier-contracts/:id/authorization-evidence',async req=>{
    const {ctx}=await deps.authenticate(req);
    const id=(req.params as {id:string}).id;
    if(!UUID.test(id)) throw invalid('Invalid contract ID');
    const b=(req.body??{}) as Record<string,unknown>;
    const kind=String(b.kind??'');
    const productCode=typeof b.productCode==='string'?b.productCode.trim().toUpperCase():'';
    const evidenceRef=typeof b.evidenceRef==='string'?b.evidenceRef.trim():'';
    const effectiveOn=typeof b.effectiveOn==='string'?b.effectiveOn:'';
    const expiresOn=typeof b.expiresOn==='string'?b.expiresOn:'';
    if(!kinds.includes(kind)||!productCode||productCode.length>80||evidenceRef.length<8||evidenceRef.length>500||
       !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)||!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)||b.confirmedWithSource!==true)
      throw invalid('Verified evidence, product and validity dates required');
    return withRequestTx(deps.appPool,ctx,async tx=>{
      const c=(await tx.query<{tenant_id:string;node_id:string}>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!c) throw notFound('Contract not found');
      const allowed=(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
      if(!allowed) throw forbidden('Compliance authorization required');
      const valid=(await tx.query<{ok:boolean}>('SELECT $1::date<=CURRENT_DATE AND $2::date>=CURRENT_DATE AND $2::date >= $1::date AS ok',[effectiveOn,expiresOn])).rows[0]?.ok;
      if(!valid) throw invalid('Evidence is not currently valid');
      const row=(await tx.query<{id:string}>(
        'INSERT INTO carrier_authorization_evidence(tenant_id,contract_id,node_id,kind,product_code,evidence_ref,verified_by,effective_on,expires_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [c.tenant_id,id,c.node_id,kind,productCode,evidenceRef,ctx.userId,effectiveOn,expiresOn])).rows[0]!;
      await audit(tx,ctx,'compliance.carrier_authorization_evidence_verified','carrier_contract_case',id,{kind,productCode,evidenceId:row.id});
      return {id:row.id,authorizationGranted:false};
    });
  });
  app.post('/v1/compliance/carrier-authorization-evidence/:id/revoke',async req=>{
    const {ctx}=await deps.authenticate(req);
    const id=(req.params as {id:string}).id;
    const b=(req.body??{}) as Record<string,unknown>;
    const reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!UUID.test(id)||reason.length<8||reason.length>500) throw invalid('Valid evidence ID and revocation reason required');
    return withRequestTx(deps.appPool,ctx,async tx=>{
      const e=(await tx.query<{tenant_id:string;node_id:string;contract_id:string;revoked_at:string|null}>(
        'SELECT tenant_id,node_id,contract_id,revoked_at FROM carrier_authorization_evidence WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!e) throw notFound('Evidence not found');
      const allowed=(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[e.tenant_id,e.node_id])).rows[0]?.ok;
      if(!allowed) throw forbidden('Compliance authorization required');
      if(e.revoked_at) throw invalid('Evidence already revoked');
      await tx.query('UPDATE carrier_authorization_evidence SET revoked_at=now(),revoked_by=$2,revocation_reason=$3 WHERE id=$1',[id,ctx.userId,reason]);
      await audit(tx,ctx,'compliance.carrier_authorization_evidence_revoked','carrier_contract_case',e.contract_id,{evidenceId:id,reason});
      return {id,revoked:true};
    });
  });
}
