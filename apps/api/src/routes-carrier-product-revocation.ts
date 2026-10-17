import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function registerCarrierProductRevocationRoutes(app:FastifyInstance,deps:AppDeps):void {
 app.get('/v1/compliance/carrier-contracts/:id/products',async req=>{
  const {ctx}=await deps.authenticate(req);
  const id=(req.params as {id:string}).id;
  if(!UUID.test(id)) throw invalid('Invalid contract ID');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string}>(
    'SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1',[id])).rows[0];
   if(!c) throw notFound('Contract not found');
   const allowed=(await tx.query<{ok:boolean}>(
    'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok===true;
   if(!allowed) throw forbidden('Compliance authorization required');
   const grants=(await tx.query(
    'SELECT id,product_code AS "productCode",activated_at AS "activatedAt",revoked_at AS "revokedAt",reason FROM carrier_product_activations WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 ORDER BY activated_at DESC LIMIT 200',
    [c.tenant_id,c.node_id,id])).rows;
   return {grants};
  });
 });
 app.post('/v1/compliance/carrier-contracts/:id/products/:productCode/revoke',async req=>{
  const {ctx}=await deps.authenticate(req);
  const {id,productCode:raw}=req.params as {id:string;productCode:string};
  const productCode=raw.toUpperCase();
  if (!req.body || typeof req.body!=='object' || Array.isArray(req.body)) throw invalid('JSON object body required');
  const b=req.body as Record<string,unknown>;
  if (Object.keys(b).some(k=>k!=='reason')) throw invalid('Only reason is accepted');
  const reason=typeof b.reason==='string'?b.reason.trim():'';
  if(!UUID.test(id)||!/^[A-Z0-9_-]{1,80}$/.test(productCode)||reason.length<8||reason.length>500||/[\u0000-\u001f\u007f]/.test(reason))
   throw invalid('Contract, product and reason required');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string}>(
    'SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!c) throw notFound('Contract not found');
   const allowed=(await tx.query<{ok:boolean}>(
    'SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
   if(!allowed) throw forbidden('Compliance authorization required');
   const updated=(await tx.query<{id:string}>(
    'UPDATE carrier_product_activations SET revoked_at=now(),revoked_by=$3,reason=$4 WHERE contract_id=$1 AND product_code=$2 AND revoked_at IS NULL RETURNING id',
    [id,productCode,ctx.userId,reason])).rows[0];
   if(!updated) throw notFound('Active product grant not found');
   await audit(tx,ctx,'compliance.carrier_product_revoked','carrier_contract_case',id,{productCode,reason});
   return {contractId:id,productCode,revoked:true};
  });
 });
}
