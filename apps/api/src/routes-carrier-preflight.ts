import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { carrierAuthorizationBlocks, type CarrierContractState } from '@pii/domain';
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
   const c=(await tx.query<{tenant_id:string;node_id:string;state:CarrierContractState;valid:boolean;broker_cleared:boolean;agency_signed:boolean;licence_valid:boolean;eo_valid:boolean;appointment_effective:boolean;appointment_not_expired:boolean}>(
     `SELECT cc.tenant_id,cc.node_id,cc.state,
      (cc.state='active' AND cc.appointment_effective_on<=CURRENT_DATE AND
       (cc.appointment_expires_on IS NOT NULL AND cc.appointment_expires_on>=CURRENT_DATE)) AS valid,
      (oc.stage='active' AND oc.standing='good_standing') AS broker_cleared,
      EXISTS(SELECT 1 FROM onboarding_agreements a WHERE a.tenant_id=cc.tenant_id AND a.case_id=oc.id AND a.officer_signed_at IS NOT NULL) AS agency_signed,
      EXISTS(SELECT 1 FROM compliance_items i WHERE i.tenant_id=cc.tenant_id AND i.node_id=cc.node_id AND i.kind='licence' AND i.expires_on>=CURRENT_DATE AND upper(i.jurisdiction)=upper(cc.jurisdiction)) AS licence_valid,
      EXISTS(SELECT 1 FROM compliance_items i WHERE i.tenant_id=cc.tenant_id AND i.node_id=cc.node_id AND i.kind='eo' AND i.expires_on>=CURRENT_DATE) AS eo_valid,
      (cc.appointment_effective_on<=CURRENT_DATE) AS appointment_effective,
      (cc.appointment_expires_on IS NOT NULL AND cc.appointment_expires_on>=CURRENT_DATE) AS appointment_not_expired
     FROM carrier_contract_cases cc JOIN onboarding_cases oc ON oc.id=cc.onboarding_case_id AND oc.tenant_id=cc.tenant_id AND oc.node_id=cc.node_id WHERE cc.id=$1`,[id])).rows[0];
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
   const grant=(await tx.query<{ok:boolean}>("SELECT EXISTS(SELECT 1 FROM carrier_product_activations WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 AND product_code=$4 AND revoked_at IS NULL) AS ok",[c.tenant_id,c.node_id,id,productCode])).rows[0]?.ok===true;
   if(!grant) missing.push('product_not_activated');
   const blocks=carrierAuthorizationBlocks({
    brokerCleared:c.broker_cleared===true,agencyAgreementCountersigned:c.agency_signed===true,
    licenceValid:c.licence_valid===true,eoValid:c.eo_valid===true,
    trainingCurrent:kinds.has('training'),jurisdictionAllowed:kinds.has('jurisdiction_scope'),
    productAllowed:kinds.has('product_scope'),carrierState:c.state,
    appointmentEffective:c.appointment_effective===true,appointmentNotExpired:c.appointment_not_expired===true,
    complianceHold:!kinds.has('hold_clearance')
   });
   if(!grant) blocks.push('product_not_activated');
   return {contractId:id,productCode,eligibleForFurtherChecks:blocks.length===0,
     missing,blocks,appointmentValid:c.valid===true,advisoryOnly:true,submissionAuthorized:false};
  });
 });
}
