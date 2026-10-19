import { createHmac, randomUUID } from 'node:crypto';
import {
  type CarrierAdapter,
  type ContractPacketInput,
  type AdapterValidationResult,
  getCarrierAdapter,
} from './carrier-adapters.ts';
import {
  type CarrierWebhookEnvelope,
  type CarrierWebhookReceipt,
  verifyCarrierWebhook,
} from './carrier-webhook.ts';
import {
  type CarrierDispatchRequest,
  CarrierConnectionUnavailable,
} from './carrier-connectivity.ts';
import { type DispatchDecision } from './carrier-dispatch-policy.ts';

// ---------------------------------------------------------------------------
// Carrier Sandbox Certification Protocol Runner
// ---------------------------------------------------------------------------

export interface SandboxSimulationOptions {
  mockSecret: string;
  eventType?: 'appointment.confirmed' | 'document.rejected';
  rejectionReason?: string;
  defectCode?: string;
  decisionOverride?: DispatchDecision;
}

export interface SandboxSimulationResult {
  carrierId: string;
  contractId: string;
  packetValidated: boolean;
  validationResult: AdapterValidationResult;
  canonicalPayload: Record<string, any> | null;
  dispatchFailedClosed: boolean;
  failClosedError: string | null;
  simulatedWebhook: {
    envelope: CarrierWebhookEnvelope;
    verifiedReceipt: CarrierWebhookReceipt;
  };
  auditTimestamp: string;
  status: 'passed' | 'failed';
}

/**
 * Standard test fixtures generator for Canadian carrier sandbox certification.
 */
export function buildSandboxContractInput(
  carrierId: string,
  jurisdiction = 'ON',
  overrides: Partial<ContractPacketInput> = {}
): ContractPacketInput {
  const tenantId = overrides.tenantId ?? '11111111-1111-1111-1111-111111111111';
  const contractId = overrides.contractId ?? randomUUID();
  const brokerId = overrides.broker?.id ?? randomUUID();

  return {
    tenantId,
    contractId,
    carrierId,
    jurisdiction,
    broker: {
      id: brokerId,
      firstName: 'Amandeep',
      lastName: 'Kaur',
      email: 'akaur@pilot-brokerage.test',
      phone: '+15145550199',
      npnOrProducerNumber: 'PR-882910',
      languagePreference: jurisdiction === 'QC' ? 'fr-CA' : 'en',
      primaryJurisdiction: jurisdiction,
      ...overrides.broker,
    },
    licence: {
      licenceNumber: `LIC-${jurisdiction}-2026-001`,
      jurisdiction,
      class: 'Life and Accident & Sickness',
      expiresOn: '2028-12-31',
      ...overrides.licence,
    },
    eoInsurance: {
      policyNumber: 'EO-TRISURA-2026',
      insurerName: 'Trisura Guarantee Insurance Company',
      coverageAmount: 2_000_000,
      aggregateAmount: 5_000_000,
      expiresOn: '2027-12-31',
      ...overrides.eoInsurance,
    },
    banking: {
      institutionNumber: '003',
      transitNumber: '10293',
      accountNumber: '9988776655',
      bankName: 'Royal Bank of Canada',
      ...overrides.banking,
    },
    amlCertificate: {
      certificateNumber: 'AML-ADVOCIS-2026',
      providerName: 'Advocis (The Financial Advisors Association of Canada)',
      completedOn: '2026-01-15',
      validUntil: '2027-01-15',
      ...overrides.amlCertificate,
    },
    documents: overrides.documents ?? [
      { type: 'licence', title: `${jurisdiction} Life Licence`, storageRef: 'vault://licence.pdf', sha256: 'a'.repeat(64) },
      { type: 'eo_insurance', title: 'E&O Certificate of Insurance', storageRef: 'vault://eo.pdf', sha256: 'b'.repeat(64) },
      { type: 'banking_void_cheque', title: 'Specimen Cheque RBC', storageRef: 'vault://void_cheque.pdf', sha256: 'c'.repeat(64) },
      { type: 'aml_cert', title: 'Advocis AML Completion Certificate', storageRef: 'vault://aml.pdf', sha256: 'd'.repeat(64) },
      { type: 'carrier_app_schedule', title: 'Completed Carrier Appointment Schedule', storageRef: 'vault://schedule.pdf', sha256: 'e'.repeat(64) },
    ],
    carrierScheduleFormVersion: overrides.carrierScheduleFormVersion ?? '2026.1',
  };
}

/**
 * Executes an end-to-end sandbox certification protocol run for a given carrier adapter.
 * Verifies contract prerequisites, canonical packet synthesis, fail-closed outbox dispatch protection,
 * and authenticated webhook ingestion.
 */
export async function executeCarrierSandboxProtocol(
  carrierId: string,
  input: ContractPacketInput,
  options: SandboxSimulationOptions
): Promise<SandboxSimulationResult> {
  const adapter = getCarrierAdapter(carrierId);
  if (!adapter) {
    throw new Error(`Carrier adapter not found for ${carrierId}`);
  }

  // 1. Validate contract prerequisites
  const validationResult = adapter.validateContractPrerequisites(input);

  // 2. Build canonical contract packet
  let canonicalPayload: Record<string, unknown> | null = null;
  if (validationResult.valid) {
    canonicalPayload = adapter.buildContractPacketPayload(input) as Record<string, unknown>;
  }

  // 3. Verify fail-closed dispatch policy lock
  const defaultFailClosedDecision: DispatchDecision = options.decisionOverride ?? {
    environment: 'test',
    allowExternalDispatch: false, // Locked fail-closed
    carrierAuthorized: true,
    destinationVerified: true,
    sandboxApproved: true,
    productionApproved: false,
    changeTicket: 'CHG-SANDBOX-TEST',
  };

  let dispatchFailedClosed = false;
  let failClosedError: string | null = null;

  try {
    const dispatchReq: CarrierDispatchRequest = {
      tenantId: input.tenantId,
      carrierId,
      contractId: input.contractId,
      operation: 'contract_packet',
      jurisdiction: input.jurisdiction,
      idempotencyKey: `idemp-sandbox-${Date.now()}`,
      evidenceReference: `sha256:${'f'.repeat(64)}`,
    };
    await adapter.dispatch(dispatchReq, defaultFailClosedDecision);
  } catch (err) {
    if (err instanceof CarrierConnectionUnavailable) {
      dispatchFailedClosed = true;
      failClosedError = err.message;
    } else {
      failClosedError = (err as Error).message;
    }
  }

  // 4. Simulate carrier response webhook
  const eventType = options.eventType ?? 'appointment.confirmed';
  const eventId = `sbx-evt-${randomUUID()}`;
  const timestamp = Date.now();

  const webhookBodyObj = {
    tenantId: input.tenantId,
    eventId,
    timestamp,
    carrierId,
    contractId: input.contractId,
    eventType,
    ...(eventType === 'appointment.confirmed'
      ? {
          appointmentReference: `APPT-${carrierId.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
          effectiveDate: new Date().toISOString().slice(0, 10),
          expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        }
      : {
          defectCode: options.defectCode ?? 'DEF_DOCUMENT_UNCLEAR',
          reason: options.rejectionReason ?? 'Uploaded void cheque is illegible',
        }),
  };

  const bodyStr = JSON.stringify(webhookBodyObj);
  const canonical = `${timestamp}.${eventId}.${bodyStr}`;
  const signature = createHmac('sha256', options.mockSecret).update(canonical).digest('hex');

  const envelope: CarrierWebhookEnvelope = {
    carrierId,
    eventId,
    timestamp,
    body: bodyStr,
    signature,
  };

  const verifiedReceipt = verifyCarrierWebhook(envelope, options.mockSecret, timestamp);

  const status: 'passed' | 'failed' =
    validationResult.valid && dispatchFailedClosed && verifiedReceipt.eventId === eventId
      ? 'passed'
      : 'failed';

  return {
    carrierId,
    contractId: input.contractId,
    packetValidated: validationResult.valid,
    validationResult,
    canonicalPayload,
    dispatchFailedClosed,
    failClosedError,
    simulatedWebhook: {
      envelope,
      verifiedReceipt,
    },
    auditTimestamp: new Date().toISOString(),
    status,
  };
}
