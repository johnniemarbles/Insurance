/** Carrier contracting is distinct from broker clearance and permission to sell.
 * Never infer an appointment from a signature or a submitted packet.
 */
export type CarrierContractState =
  | 'requested' | 'documents_prepared' | 'broker_signed' | 'submitted'
  | 'carrier_review' | 'correction_required' | 'approved'
  | 'appointment_verified' | 'active' | 'declined'
  | 'withdrawn' | 'suspended' | 'expired' | 'terminated';

const transitions: Record<CarrierContractState, readonly CarrierContractState[]> = {
  requested: ['documents_prepared', 'withdrawn'],
  documents_prepared: ['broker_signed', 'withdrawn'],
  broker_signed: ['submitted', 'correction_required', 'withdrawn'],
  submitted: ['carrier_review', 'correction_required', 'declined', 'withdrawn'],
  carrier_review: ['approved', 'correction_required', 'declined', 'withdrawn'],
  correction_required: ['documents_prepared', 'withdrawn'],
  approved: ['appointment_verified', 'declined', 'withdrawn'],
  appointment_verified: ['active', 'suspended', 'expired', 'terminated'],
  active: ['suspended', 'expired', 'terminated'],
  suspended: ['active', 'terminated', 'expired'],
  expired: ['appointment_verified', 'terminated'],
  declined: [],
  withdrawn: [],
  terminated: [],
};
export function canMoveCarrierContract(from: CarrierContractState, to: CarrierContractState): boolean {
  return transitions[from].includes(to);
}
export interface CarrierAuthorization {
  brokerCleared: boolean;
  agencyAgreementCountersigned: boolean;
  licenceValid: boolean;
  eoValid: boolean;
  trainingCurrent: boolean;
  jurisdictionAllowed: boolean;
  productAllowed: boolean;
  carrierState: CarrierContractState;
  appointmentEffective: boolean;
  appointmentNotExpired: boolean;
  complianceHold: boolean;
}
export function carrierAuthorizationBlocks(x: CarrierAuthorization): string[] {
  const blocks: string[] = [];
  if (!x.brokerCleared) blocks.push('broker_not_cleared');
  if (!x.agencyAgreementCountersigned) blocks.push('agency_agreement_not_countersigned');
  if (!x.licenceValid) blocks.push('licence_invalid');
  if (!x.eoValid) blocks.push('eo_invalid');
  if (!x.trainingCurrent) blocks.push('training_incomplete');
  if (!x.jurisdictionAllowed) blocks.push('jurisdiction_not_allowed');
  if (!x.productAllowed) blocks.push('product_not_allowed');
  if (x.carrierState !== 'active') blocks.push('carrier_not_active');
  if (!x.appointmentEffective) blocks.push('appointment_not_effective');
  if (!x.appointmentNotExpired) blocks.push('appointment_expired');
  if (x.complianceHold) blocks.push('compliance_hold');
  return blocks;
}
export function maySubmitCarrierBusiness(x: CarrierAuthorization): boolean {
  return carrierAuthorizationBlocks(x).length === 0;
}
