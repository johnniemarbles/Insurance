import { CarrierConnectionUnavailable } from './carrier-connectivity.ts';
export interface DispatchDecision {
  environment: 'dev' | 'test' | 'staging' | 'prod';
  allowExternalDispatch: boolean;
  carrierAuthorized: boolean;
  destinationVerified: boolean;
  sandboxApproved: boolean;
  productionApproved: boolean;
  changeTicket: string | null;
}
export function assertExternalCarrierDispatch(decision: DispatchDecision): void {
  if (!decision.allowExternalDispatch) throw new CarrierConnectionUnavailable('External carrier dispatch is disabled');
  if (!decision.carrierAuthorized || !decision.destinationVerified)
    throw new CarrierConnectionUnavailable('Carrier authorization or destination verification missing');
  if (!decision.changeTicket?.trim()) throw new CarrierConnectionUnavailable('Approved change ticket required');
  if (decision.environment === 'prod') {
    if (!decision.productionApproved) throw new CarrierConnectionUnavailable('Production carrier approval required');
  } else if (!decision.sandboxApproved) {
    throw new CarrierConnectionUnavailable('Approved sandbox required outside production');
  }
}
