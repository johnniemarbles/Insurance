import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Advisory status only; submission APIs must enforce authorization atomically. */
export function registerCarrierPreflightRoutes(app:FastifyInstance,deps:AppDeps):void {
 app.get('/v1/carrier-contracts/:id/products/:productCode/preflight',async req=>{
  const {ctx}=await deps.authenticate(req);
  const {id,productCode:raw}=req.params as {id:string;productCode:string};
  const productCode=raw.toUpperCase();
  if(!UUID.test(id)||!/^[A-Z0-9_-]{1,80}$/.test(productCode)) throw invalid('Invalid carrier or product');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string;state:string;valid:boolean}>(
    `SELECT tenant_id,node_id,state,
      (state='active' AND appointment_effective_on<=CURRENT_DATE AND
       (appointment_expires_on IS NULL OR appointment_expires_on>=CURRENT_DATE)) AS valid
     FROM carrier_contract_cases WHERE id=$1`,[id])).rows[0];
   if(!c) throw notFound('Carrier contract not found');
   const permitted=(await tx.query<{ok:boolean}>(
    'SELECT app_is_compliance_at_or_above($1,$2) OR EXISTS(SELECT 1 FROM user_node_roles WHERE user_id=app_user_id() AND node_id=$2) AS ok',
    [c.tenant_id,c.node_id])).rows[0]?.ok;
   if(!permitted) throw forbidden('Not authorized to inspect this contract');
   const evidence=(await tx.query<{kind:string}>(
    `SELECT DISTINCT kind FROM carrier_authorization_evidence
      WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 AND product_code=$4
      AND revoked_at IS NULL AND effective_on<=CURRENT_DATE AND expires_on>=CURRENT_DATE`,
    [c.tenant_id,c.node_id,id,productCode])).rows;
   const kinds=new Set(evidence.map(x=>x.kind));
   const required=['training','product_scope','jurisdiction_scope','hold_clearance'];
   const missing=required.filter(x=>!kinds.has(x));
   return {contractId:id,productCode,eligibleForFurtherChecks:c.valid===true&&missing.length===0,
     missing,advisoryOnly:true,submissionAuthorized:false};
  });
 });
}
