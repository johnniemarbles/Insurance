import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { carrierAuthorizationBlocks, type CarrierContractState } from '@pii/domain';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only, fail-closed carrier eligibility assessment. Not a grant to sell.
 * Training, product scope and holds must be verified against their authoritative
 * systems before activation can be enabled. Never accept client-supplied flags.
 */
export function registerCarrierEligibilityRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/compliance/carrier-contracts/:id/eligibility', async req => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw invalid('Invalid carrier contract ID');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const row = (await tx.query<{
        tenant_id: string; node_id: string; state: CarrierContractState;
        broker_cleared: boolean; agency_signed: boolean; licence_valid: boolean;
        eo_valid: boolean; appointment_effective: boolean; appointment_not_expired: boolean;
      }>(`SELECT cc.tenant_id, cc.node_id, cc.state,
           (oc.stage = 'active' AND oc.standing = 'good_standing') AS broker_cleared,
           EXISTS (SELECT 1 FROM onboarding_agreements a
                     WHERE a.case_id = cc.onboarding_case_id AND a.tenant_id = cc.tenant_id AND a.officer_signed_at IS NOT NULL) AS agency_signed,
           EXISTS (SELECT 1 FROM compliance_items i
                     WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'licence'
                       AND i.expires_on IS NOT NULL AND i.expires_on >= CURRENT_DATE
                       AND i.jurisdiction IS NOT NULL AND upper(i.jurisdiction) = upper(cc.jurisdiction)) AS licence_valid,
           EXISTS (SELECT 1 FROM compliance_items i
                     WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'eo'
                       AND i.expires_on IS NOT NULL AND i.expires_on >= CURRENT_DATE) AS eo_valid,
           (cc.appointment_effective_on IS NOT NULL AND cc.appointment_effective_on <= CURRENT_DATE) AS appointment_effective,
           (cc.appointment_expires_on IS NULL OR cc.appointment_expires_on >= CURRENT_DATE) AS appointment_not_expired
         FROM carrier_contract_cases cc JOIN onboarding_cases oc ON oc.id = cc.onboarding_case_id AND oc.tenant_id = cc.tenant_id AND oc.node_id = cc.node_id
         WHERE cc.id = $1`, [id])).rows[0];
      if (!row) throw notFound('Carrier contract not found');
      const permitted = (await tx.query<{ ok: boolean }>(
        'SELECT app_is_compliance_at_or_above($1,$2) AS ok', [row.tenant_id,row.node_id])).rows[0]?.ok;
      if (!permitted) throw forbidden('Compliance authorization required');
      const blocks = carrierAuthorizationBlocks({
        brokerCleared: row.broker_cleared === true,
        agencyAgreementCountersigned: row.agency_signed === true,
        licenceValid: row.licence_valid === true,
        eoValid: row.eo_valid === true,
        trainingCurrent: false,
        jurisdictionAllowed: false,
        productAllowed: false,
        carrierState: row.state,
        appointmentEffective: row.appointment_effective === true,
        appointmentNotExpired: row.appointment_not_expired === true,
        complianceHold: true,
      });
      return { id, authorized: false, blocks, requires: ['verified_training','jurisdiction_product_scope','compliance_hold_source'], advisoryOnly: true };
    });
  });
}
