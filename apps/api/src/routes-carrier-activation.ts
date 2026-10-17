import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { carrierAuthorizationBlocks, type CarrierContractState } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Case={tenant_id:string;node_id:string;state:CarrierContractState;broker_cleared:boolean;agency_signed:boolean;licence_valid:boolean;eo_valid:boolean;appointment_effective:boolean;appointment_not_expired:boolean};
const gateQuery=`SELECT cc.tenant_id,cc.node_id,cc.state,
 (oc.stage='active' AND oc.standing='good_standing') AS broker_cleared,
 EXISTS(SELECT 1 FROM onboarding_agreements a WHERE a.case_id=cc.onboarding_case_id AND a.tenant_id=cc.tenant_id AND a.officer_signed_at IS NOT NULL) AS agency_signed,
 EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id=cc.node_id AND i.tenant_id=cc.tenant_id AND i.kind='licence' AND i.expires_on>=CURRENT_DATE AND upper(i.jurisdiction)=upper(cc.jurisdiction)) AS licence_valid,
 EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id=cc.node_id AND i.tenant_id=cc.tenant_id AND i.kind='eo' AND i.expires_on>=CURRENT_DATE) AS eo_valid,
 (cc.appointment_effective_on<=CURRENT_DATE) AS appointment_effective,
 (cc.appointment_expires_on IS NULL OR cc.appointment_expires_on>=CURRENT_DATE) AS appointment_not_expired
 FROM carrier_contract_cases cc JOIN onboarding_cases oc ON oc.id=cc.onboarding_case_id AND oc.tenant_id=cc.tenant_id AND oc.node_id=cc.node_id WHERE cc.id=$1 FOR UPDATE OF cc`;
/** Product-specific clearance is checked under the contract row lock. The evidence
 * ledger is a Compliance attestation, not proof of a carrier API integration. */
export function registerCarrierActivationRoutes(app:FastifyInstance,deps:AppDeps):void {
 app.post('/v1/compliance/carrier-contracts/:id/activate',async req=>{
  const {ctx}=await deps.authenticate(req);
  const id=(req.params as {id:string}).id;
  const b=(req.body??{}) as Record<string,unknown>;
  const productCode=typeof b.productCode==='string'?b.productCode.trim().toUpperCase():'';
  if(!UUID.test(id)||!/^[A-Z0-9_-]{1,80}$/.test(productCode)) throw invalid('Valid contract and product code required');
  return withRequestTx(deps.appPool,ctx,async tx=>{
   const c=(await tx.query<Case>(gateQuery,[id])).rows[0];
   if(!c) throw notFound('Carrier contract not found');
   const permitted=(await tx.query<{ok:boolean}>('SELECT app_is_compliance_at_or_above($1,$2) AS ok',[c.tenant_id,c.node_id])).rows[0]?.ok;
   if(!permitted) throw forbidden('Compliance authorization required');
   const evidence=(await tx.query<{kind:string}>(
    `SELECT DISTINCT kind FROM carrier_authorization_evidence
      WHERE tenant_id=$1 AND node_id=$2 AND contract_id=$3 AND product_code=$4
        AND revoked_at IS NULL AND effective_on<=CURRENT_DATE AND expires_on>=CURRENT_DATE`,
    [c.tenant_id,c.node_id,id,productCode])).rows;
   const kinds=new Set(evidence.map(e=>e.kind));
   const blocks=carrierAuthorizationBlocks({
    brokerCleared:c.broker_cleared===true,agencyAgreementCountersigned:c.agency_signed===true,
    licenceValid:c.licence_valid===true,eoValid:c.eo_valid===true,
    trainingCurrent:kinds.has('training'),jurisdictionAllowed:kinds.has('jurisdiction_scope'),
    productAllowed:kinds.has('product_scope'),carrierState:c.state==='appointment_verified'?'active':c.state,
    appointmentEffective:c.appointment_effective===true,appointmentNotExpired:c.appointment_not_expired===true,
    complianceHold:!kinds.has('hold_clearance')
   });
   if(!['appointment_verified','active'].includes(c.state)||blocks.length) return {activated:false,blocks:['appointment_verified','active'].includes(c.state)?blocks:['invalid_carrier_state',...blocks],productCode};
   const already=(await tx.query<{id:string}>("SELECT id FROM carrier_product_activations WHERE contract_id=$1 AND product_code=$2 FOR UPDATE",[id,productCode])).rows[0];
   if(already) return {activated:false,blocks:['product_activation_exists'],productCode};
   await tx.query('INSERT INTO carrier_product_activations(tenant_id,contract_id,node_id,product_code,activated_by) VALUES($1,$2,$3,$4,$5)',[c.tenant_id,id,c.node_id,productCode,ctx.userId]);
   if(c.state==='appointment_verified') await tx.query("UPDATE carrier_contract_cases SET state='active',updated_at=now() WHERE id=$1",[id]);
   if(c.state==='appointment_verified') await tx.query('INSERT INTO carrier_contract_events(tenant_id,contract_id,node_id,from_state,to_state,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [c.tenant_id,id,c.node_id,c.state,'active',ctx.userId,'Product clearance checked: '+productCode]);
   await audit(tx,ctx,'compliance.carrier_activated','carrier_contract_case',id,{productCode});
   return {activated:true,state:'active',productCode};
  });
 });
}
