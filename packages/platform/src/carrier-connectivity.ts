/**
 * Carrier transport is NOT a carrier authorization or a licence to transact.
 * This module deliberately fails closed until a carrier-approved adapter exists.
 */
export type CarrierChannel = 'none' | 'manual_portal' | 'secure_email' | 'api' | 'sftp';
export type CarrierOperation = 'contract_packet' | 'business_submission' | 'appointment_status';
export interface CarrierConnection {
  carrierId: string;
  tenantId: string;
  channel: CarrierChannel;
  enabled: boolean;
  verified: boolean;
  approvedOperations: CarrierOperation[];
  approvedJurisdictions: string[];
  destinationVerifiedAt: string | null;
}
export interface CarrierDispatchRequest {
  tenantId: string;
  carrierId: string;
  contractId: string;
  operation: CarrierOperation;
  jurisdiction: string;
  idempotencyKey: string;
  evidenceReference: string;
}
export interface CarrierDispatchReceipt {
  externalReference: string;
  acknowledgedAt: string;
  channel: Exclude<CarrierChannel, 'none' | 'manual_portal'>;
}
export class CarrierConnectionUnavailable extends Error {
  readonly code = 'CARRIER_CONNECTION_UNAVAILABLE';
  constructor(reason: string) { super(reason); this.name = 'CarrierConnectionUnavailable'; }
}
export function assertCarrierConnection(
  connection: CarrierConnection | null,
  request: CarrierDispatchRequest,
): asserts connection is CarrierConnection {
  if (!connection) throw new CarrierConnectionUnavailable('No carrier connection configured');
  if (connection.tenantId !== request.tenantId || connection.carrierId !== request.carrierId)
    throw new CarrierConnectionUnavailable('Carrier connection scope mismatch');
  if (!connection.enabled || !connection.verified || !connection.destinationVerifiedAt)
    throw new CarrierConnectionUnavailable('Carrier connection is not approved and verified');
  if (!connection.approvedOperations.includes(request.operation))
    throw new CarrierConnectionUnavailable('Operation is not approved for this carrier');
  if (!connection.approvedJurisdictions.includes(request.jurisdiction))
    throw new CarrierConnectionUnavailable('Jurisdiction is not approved for this carrier');
  if (!request.idempotencyKey.trim() || !request.evidenceReference.trim())
    throw new CarrierConnectionUnavailable('Dispatch requires idempotency and evidence');
  if (connection.channel === 'none' || connection.channel === 'manual_portal')
    throw new CarrierConnectionUnavailable('Manual portal workflow is not automatic dispatch');
}
export interface CarrierTransport {
  readonly channel: Exclude<CarrierChannel, 'none' | 'manual_portal'>;
  dispatch(request: CarrierDispatchRequest): Promise<CarrierDispatchReceipt>;
}
/** No fallback transport, no simulated acknowledgments. */
export class CarrierTransportRegistry {
  private readonly transports = new Map<string, CarrierTransport>();
  register(carrierId: string, transport: CarrierTransport): void {
    if (!carrierId.trim()) throw new Error('carrierId required');
    this.transports.set(carrierId, transport);
  }
  async dispatch(connection: CarrierConnection | null, request: CarrierDispatchRequest): Promise<CarrierDispatchReceipt> {
    assertCarrierConnection(connection, request);
    const transport = this.transports.get(request.carrierId);
    if (!transport || transport.channel !== connection.channel)
      throw new CarrierConnectionUnavailable('No approved matching carrier transport installed');
    return transport.dispatch(request);
  }
}

export type OutboxStatus = 'queued' | 'processing' | 'dispatched' | 'failed' | 'dead_letter';

export interface OutboxRecord {
  id: string;
  tenantId: string;
  contractId: string;
  carrierId: string;
  operation: CarrierOperation;
  jurisdiction: string;
  idempotencyKey: string;
  evidenceReference: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  receipt: CarrierDispatchReceipt | null;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RevalidationContext {
  contractState: string;
  holdingClearance: boolean;
  licenceValid: boolean;
  eoValid: boolean;
  connection: CarrierConnection | null;
}

/**
 * Revalidate contract state, compliance holds, licensing, E&O, and connection
 * before any outbound carrier dispatch is attempted.
 */
export function revalidateOutboxDispatch(
  record: Pick<OutboxRecord, 'tenantId' | 'contractId' | 'carrierId' | 'operation' | 'jurisdiction' | 'idempotencyKey' | 'evidenceReference'>,
  context: RevalidationContext,
): void {
  if (record.operation === 'contract_packet') {
    if (!['broker_signed', 'submitted'].includes(context.contractState)) {
      throw new CarrierConnectionUnavailable(`Contract must be signed or submitted (current: ${context.contractState})`);
    }
  } else if (record.operation === 'business_submission') {
    if (context.contractState !== 'active') {
      throw new CarrierConnectionUnavailable(`Contract must be active for business submission (current: ${context.contractState})`);
    }
  }
  if (!context.holdingClearance) {
    throw new CarrierConnectionUnavailable('Active compliance hold prevents carrier dispatch');
  }
  if (!context.licenceValid) {
    throw new CarrierConnectionUnavailable('Valid licence required for carrier dispatch in this jurisdiction');
  }
  if (!context.eoValid) {
    throw new CarrierConnectionUnavailable('Current E&O coverage required for carrier dispatch');
  }
  assertCarrierConnection(context.connection, {
    tenantId: record.tenantId,
    carrierId: record.carrierId,
    contractId: record.contractId,
    operation: record.operation,
    jurisdiction: record.jurisdiction,
    idempotencyKey: record.idempotencyKey,
    evidenceReference: record.evidenceReference,
  });
}
