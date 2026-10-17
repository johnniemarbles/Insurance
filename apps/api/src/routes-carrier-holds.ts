import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function registerCarrierHoldRoutes(app:FastifyInstance,deps:AppDeps):void {
 app.get('/v1/compliance/carrier-contracts/:id/holds',async req=>{
  const {ctx}=await deps.authenticate(req);
  const id=(req.params as {id:string}).id;
  if(!UUID.test(id))throw invalid('Invalid contract ID');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string}>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1',[id])).rows[0];
   if(!c)throw notFound('Carrier contract not found');
   if(!(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok)throw forbidden('Compliance authorization required');
   const holds=(await tx.query('SELECT id,reason,created_at,released_at,release_reason FROM carrier_compliance_holds WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 ORDER BY created_at DESC',[c.tenant_id,c.node_id,id])).rows;
   return {holds};
  });
 });
 app.post('/v1/compliance/carrier-contracts/:id/holds',async req=>{
  const {ctx}=await deps.authenticate(req);
  const id=(req.params as {id:string}).id;
  const reason=typeof (req.body as {reason?:unknown}|null)?.reason==='string'?(req.body as {reason:string}).reason.trim():'';
  if(!UUID.test(id)||reason.length<8||reason.length>500)throw invalid('Contract and hold reason required');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string}>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!c)throw notFound('Carrier contract not found');
   if(!(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok)throw forbidden('Compliance authorization required');
   const hold=(await tx.query<{id:string}>('INSERT INTO carrier_compliance_holds(tenant_id,contract_id,node_id,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[c.tenant_id,id,c.node_id,reason,ctx.userId])).rows[0];
   await audit(tx,ctx,'compliance.carrier_hold_created','carrier_contract_case',id,{holdId:hold.id});
   return {id:hold.id,created:true};
  });
 });
 app.post('/v1/compliance/carrier-contracts/:id/holds/:holdId/release',async req=>{
  const {ctx}=await deps.authenticate(req);
  const {id,holdId}=req.params as {id:string;holdId:string};
  const body=(req.body??{}) as Record<string,unknown>;
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!UUID.test(id)||!UUID.test(holdId)||reason.length<8||reason.length>500)throw invalid('Valid hold ID and release reason required');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<{tenant_id:string;node_id:string}>('SELECT tenant_id,node_id FROM carrier_contract_cases WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!c)throw notFound('Carrier contract not found');
   const permission=(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
   if(!permission)throw forbidden('Compliance authorization required');
   const released=(await tx.query<{id:string}>('UPDATE carrier_compliance_holds SET released_at=now(),released_by=$5,release_reason=$6 WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 AND id=$4 AND released_at IS NULL RETURNING id',[c.tenant_id,c.node_id,id,holdId,ctx.userId,reason])).rows[0];
   if(!released)throw notFound('Open carrier hold not found');
   await audit(tx,ctx,'compliance.carrier_hold_released','carrier_contract_case',id,{holdId,reason});
   return {released:true,holdId};
  });
 });
}
