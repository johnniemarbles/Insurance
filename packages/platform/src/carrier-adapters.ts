import {
  type CarrierOperation,
  type CarrierDispatchRequest,
  type CarrierDispatchReceipt,
  CarrierConnectionUnavailable,
} from './carrier-connectivity.ts';
import { assertExternalCarrierDispatch, type DispatchDecision } from './carrier-dispatch-policy.ts';

// ---------------------------------------------------------------------------
// 1. Core Carrier Adapter Types & Interfaces
// ---------------------------------------------------------------------------

export interface CarrierDocumentItem {
  type: string;
  title: string;
  storageRef: string;
  sha256?: string;
  verifiedAt?: string;
  expiresOn?: string;
}

export interface CarrierBankingDetails {
  institutionNumber: string; // 3 digits
  transitNumber: string;     // 5 digits
  accountNumber: string;     // 7-12 digits
  bankName?: string;
}

export interface CarrierEoInsurance {
  policyNumber: string;
  insurerName: string;
  coverageAmount: number;
  aggregateAmount: number;
  expiresOn: string;
}

export interface CarrierLicenceInfo {
  licenceNumber: string;
  jurisdiction: string;
  class: string;
  expiresOn: string;
}

export interface CarrierAmlCertificate {
  certificateNumber?: string;
  providerName: string;
  completedOn: string;
  validUntil: string;
}

export interface BrokerCarrierProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  npnOrProducerNumber?: string;
  languagePreference?: 'en' | 'fr' | 'fr-CA';
  primaryJurisdiction: string;
}

export interface ContractPacketInput {
  tenantId: string;
  contractId: string;
  carrierId: string;
  jurisdiction: string;
  broker: BrokerCarrierProfile;
  licence: CarrierLicenceInfo;
  eoInsurance: CarrierEoInsurance;
  banking: CarrierBankingDetails;
  amlCertificate: CarrierAmlCertificate;
  documents: CarrierDocumentItem[];
  carrierScheduleFormVersion?: string;
}

export interface AdapterValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CarrierAdapter<TPayload = Record<string, unknown>> {
  readonly carrierId: string;
  readonly carrierDisplayName: string;
  readonly supportedOperations: readonly CarrierOperation[];
  readonly supportedJurisdictions: readonly string[];
  readonly requiredDocumentTypes: readonly string[];

  validateContractPrerequisites(input: ContractPacketInput): AdapterValidationResult;
  buildContractPacketPayload(input: ContractPacketInput): TPayload;
  dispatch(request: CarrierDispatchRequest, decision: DispatchDecision): Promise<CarrierDispatchReceipt>;
}

// ---------------------------------------------------------------------------
// 2. iA Financial Group (Industrial Alliance) Adapter Spike
// ---------------------------------------------------------------------------

export interface IaContractPacketPayload {
  carrier: 'ia-financial-group';
  channel: 'manual_portal' | 'api';
  packetVersion: string;
  metadata: {
    tenantId: string;
    contractId: string;
    submittedAt: string;
    jurisdiction: string;
    language: 'en' | 'fr-CA';
  };
  producer: {
    externalId: string;
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    advisorCode: string | null;
  };
  regulatory: {
    licenceNumber: string;
    licenceProvince: string;
    licenceClass: string;
    licenceExpiry: string;
    eoInsurer: string;
    eoPolicyNumber: string;
    eoPerClaimLimit: number;
    eoAggregateLimit: number;
    eoExpiry: string;
    amlProvider: string;
    amlCompletedDate: string;
    amlValidUntil: string;
  };
  remittance: {
    directDepositRouting: string; // "0XXX-YYYYY"
    accountNumberMasked: string;
    bankName: string | null;
  };
  attachments: Array<{
    documentType: string;
    fileName: string;
    sha256Checksum: string | null;
    vaultReference: string;
  }>;
}

export class IaFinancialGroupAdapter implements CarrierAdapter<IaContractPacketPayload> {
  readonly carrierId = 'ia-financial-group';
  readonly carrierDisplayName = 'iA Financial Group (Industrial Alliance)';
  readonly supportedOperations = ['contract_packet', 'business_submission', 'appointment_status'] as const;
  readonly supportedJurisdictions = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'] as const;
  readonly requiredDocumentTypes = [
    'licence',
    'eo_insurance',
    'banking_void_cheque',
    'aml_cert',
    'carrier_app_schedule',
  ] as const;

  validateContractPrerequisites(input: ContractPacketInput): AdapterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (input.carrierId !== this.carrierId) {
      errors.push(`Adapter carrier mismatch: expected ${this.carrierId}, got ${input.carrierId}`);
    }

    const jur = input.jurisdiction.toUpperCase();
    if (!this.supportedJurisdictions.includes(jur as any)) {
      errors.push(`Jurisdiction ${jur} is not supported by iA Financial Group adapter`);
    }

    // Check mandatory documents
    const presentTypes = new Set(input.documents.map((d) => d.type));
    for (const reqType of this.requiredDocumentTypes) {
      if (!presentTypes.has(reqType)) {
        errors.push(`Missing mandatory iA contracting document: ${reqType}`);
      }
    }

    // E&O Insurance verification (minimum $1,000,000)
    if (!input.eoInsurance.coverageAmount || input.eoInsurance.coverageAmount < 1_000_000) {
      errors.push('iA Financial Group requires minimum $1,000,000 E&O coverage per occurrence');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.eoInsurance.expiresOn && input.eoInsurance.expiresOn <= today) {
      errors.push(`E&O policy expired on ${input.eoInsurance.expiresOn}`);
    }

    // Licence verification
    if (input.licence.jurisdiction.toUpperCase() !== jur) {
      errors.push(`Licence jurisdiction (${input.licence.jurisdiction}) does not match contracting jurisdiction (${jur})`);
    }
    if (input.licence.expiresOn && input.licence.expiresOn <= today) {
      errors.push(`Provincial licence expired on ${input.licence.expiresOn}`);
    }

    // Banking details
    if (!/^\d{3}$/.test(input.banking.institutionNumber)) {
      errors.push('Canadian financial institution number must be exactly 3 digits');
    }
    if (!/^\d{5}$/.test(input.banking.transitNumber)) {
      errors.push('Canadian branch transit number must be exactly 5 digits');
    }
    if (!input.banking.accountNumber || input.banking.accountNumber.length < 5) {
      errors.push('Invalid Canadian bank account number');
    }

    // Quebec Bill 96 / Law 25 language check
    if (jur === 'QC') {
      const lang = input.broker.languagePreference;
      if (lang !== 'fr' && lang !== 'fr-CA') {
        warnings.push('Quebec contracting requires French language documentation under Bill 96 / Law 25');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  buildContractPacketPayload(input: ContractPacketInput): IaContractPacketPayload {
    const validation = this.validateContractPrerequisites(input);
    if (!validation.valid) {
      throw new Error(`Cannot build iA contracting packet due to validation errors: ${validation.errors.join('; ')}`);
    }

    const jur = input.jurisdiction.toUpperCase();
    const isQc = jur === 'QC';
    const language = (isQc || input.broker.languagePreference?.startsWith('fr')) ? 'fr-CA' : 'en';

    const accountMasked =
      input.banking.accountNumber.length > 4
        ? '***' + input.banking.accountNumber.slice(-4)
        : '***';

    return {
      carrier: 'ia-financial-group',
      channel: 'manual_portal',
      packetVersion: input.carrierScheduleFormVersion ?? '2026.1',
      metadata: {
        tenantId: input.tenantId,
        contractId: input.contractId,
        submittedAt: new Date().toISOString(),
        jurisdiction: jur,
        language,
      },
      producer: {
        externalId: input.broker.id,
        fullName: `${input.broker.firstName} ${input.broker.lastName}`,
        firstName: input.broker.firstName,
        lastName: input.broker.lastName,
        email: input.broker.email,
        phone: input.broker.phone ?? null,
        advisorCode: input.broker.npnOrProducerNumber ?? null,
      },
      regulatory: {
        licenceNumber: input.licence.licenceNumber,
        licenceProvince: input.licence.jurisdiction.toUpperCase(),
        licenceClass: input.licence.class,
        licenceExpiry: input.licence.expiresOn,
        eoInsurer: input.eoInsurance.insurerName,
        eoPolicyNumber: input.eoInsurance.policyNumber,
        eoPerClaimLimit: input.eoInsurance.coverageAmount,
        eoAggregateLimit: input.eoInsurance.aggregateAmount,
        eoExpiry: input.eoInsurance.expiresOn,
        amlProvider: input.amlCertificate.providerName,
        amlCompletedDate: input.amlCertificate.completedOn,
        amlValidUntil: input.amlCertificate.validUntil,
      },
      remittance: {
        directDepositRouting: `0${input.banking.institutionNumber}-${input.banking.transitNumber}`,
        accountNumberMasked: accountMasked,
        bankName: input.banking.bankName ?? null,
      },
      attachments: input.documents.map((doc) => ({
        documentType: doc.type,
        fileName: doc.title,
        sha256Checksum: doc.sha256 ?? null,
        vaultReference: doc.storageRef,
      })),
    };
  }

  async dispatch(request: CarrierDispatchRequest, decision: DispatchDecision): Promise<CarrierDispatchReceipt> {
    // Fail closed: enforce external dispatch decision policy
    assertExternalCarrierDispatch(decision);
    throw new CarrierConnectionUnavailable(
      'Live external dispatch to iA Financial Group is not connected (manual portal operations only)'
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Sun Life Financial Adapter Spike
// ---------------------------------------------------------------------------

export interface SunLifeContractPacketPayload {
  carrier: 'sun-life';
  channel: 'manual_portal' | 'api';
  version: string;
  tracking: {
    tenantId: string;
    contractId: string;
    timestamp: string;
    market: 'CA';
    province: string;
  };
  advisor: {
    id: string;
    legalName: string;
    contactEmail: string;
    contactPhone: string | null;
    producerId: string | null;
    correspondenceLanguage: 'en' | 'fr';
  };
  credentials: {
    provincialLicence: {
      number: string;
      province: string;
      classOfInsurance: string;
      expirationDate: string;
    };
    errorsAndOmissions: {
      certificateNumber: string;
      provider: string;
      limitPerClaim: number;
      limitAggregate: number;
      expirationDate: string;
    };
    antiMoneyLaundering: {
      trainingVendor: string;
      completionDate: string;
      expirationDate: string;
    };
  };
  eftAuthorization: {
    institution: string;
    transit: string;
    accountLastFour: string;
  };
  supportingDocumentation: Array<{
    category: string;
    label: string;
    fileChecksum: string | null;
    archiveUri: string;
  }>;
}

export class SunLifeFinancialAdapter implements CarrierAdapter<SunLifeContractPacketPayload> {
  readonly carrierId = 'sun-life';
  readonly carrierDisplayName = 'Sun Life Financial';
  readonly supportedOperations = ['contract_packet', 'business_submission', 'appointment_status'] as const;
  readonly supportedJurisdictions = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'] as const;
  readonly requiredDocumentTypes = [
    'licence',
    'eo_insurance',
    'banking_void_cheque',
    'aml_cert',
    'carrier_app_schedule',
  ] as const;

  validateContractPrerequisites(input: ContractPacketInput): AdapterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (input.carrierId !== this.carrierId) {
      errors.push(`Adapter carrier mismatch: expected ${this.carrierId}, got ${input.carrierId}`);
    }

    const jur = input.jurisdiction.toUpperCase();
    if (!this.supportedJurisdictions.includes(jur as any)) {
      errors.push(`Jurisdiction ${jur} is not supported by Sun Life Financial adapter`);
    }

    // Check mandatory documents
    const presentTypes = new Set(input.documents.map((d) => d.type));
    for (const reqType of this.requiredDocumentTypes) {
      if (!presentTypes.has(reqType)) {
        errors.push(`Missing mandatory Sun Life contracting document: ${reqType}`);
      }
    }

    // E&O Insurance verification
    if (!input.eoInsurance.coverageAmount || input.eoInsurance.coverageAmount < 1_000_000) {
      errors.push('Sun Life Financial requires minimum $1,000,000 E&O coverage per occurrence');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.eoInsurance.expiresOn && input.eoInsurance.expiresOn <= today) {
      errors.push(`E&O policy expired on ${input.eoInsurance.expiresOn}`);
    }

    // Licence verification
    if (input.licence.jurisdiction.toUpperCase() !== jur) {
      errors.push(`Licence jurisdiction (${input.licence.jurisdiction}) does not match contracting jurisdiction (${jur})`);
    }
    if (input.licence.expiresOn && input.licence.expiresOn <= today) {
      errors.push(`Provincial licence expired on ${input.licence.expiresOn}`);
    }

    // Banking details
    if (!/^\d{3}$/.test(input.banking.institutionNumber)) {
      errors.push('Canadian institution number must be 3 digits');
    }
    if (!/^\d{5}$/.test(input.banking.transitNumber)) {
      errors.push('Canadian branch transit number must be 5 digits');
    }
    if (!input.banking.accountNumber || input.banking.accountNumber.length < 5) {
      errors.push('Invalid account number');
    }

    // Quebec Bill 96 / Law 25 language check
    if (jur === 'QC') {
      const lang = input.broker.languagePreference;
      if (lang !== 'fr' && lang !== 'fr-CA') {
        warnings.push('Quebec contracting requires French language documentation under Bill 96 / Law 25');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  buildContractPacketPayload(input: ContractPacketInput): SunLifeContractPacketPayload {
    const validation = this.validateContractPrerequisites(input);
    if (!validation.valid) {
      throw new Error(`Cannot build Sun Life contracting packet due to validation errors: ${validation.errors.join('; ')}`);
    }

    const jur = input.jurisdiction.toUpperCase();
    const isQc = jur === 'QC';
    const language = (isQc || input.broker.languagePreference?.startsWith('fr')) ? 'fr' : 'en';

    const accountLastFour =
      input.banking.accountNumber.length >= 4
        ? input.banking.accountNumber.slice(-4)
        : input.banking.accountNumber;

    return {
      carrier: 'sun-life',
      channel: 'manual_portal',
      version: input.carrierScheduleFormVersion ?? 'SL-2026',
      tracking: {
        tenantId: input.tenantId,
        contractId: input.contractId,
        timestamp: new Date().toISOString(),
        market: 'CA',
        province: jur,
      },
      advisor: {
        id: input.broker.id,
        legalName: `${input.broker.firstName} ${input.broker.lastName}`,
        contactEmail: input.broker.email,
        contactPhone: input.broker.phone ?? null,
        producerId: input.broker.npnOrProducerNumber ?? null,
        correspondenceLanguage: language,
      },
      credentials: {
        provincialLicence: {
          number: input.licence.licenceNumber,
          province: input.licence.jurisdiction.toUpperCase(),
          classOfInsurance: input.licence.class,
          expirationDate: input.licence.expiresOn,
        },
        errorsAndOmissions: {
          certificateNumber: input.eoInsurance.policyNumber,
          provider: input.eoInsurance.insurerName,
          limitPerClaim: input.eoInsurance.coverageAmount,
          limitAggregate: input.eoInsurance.aggregateAmount,
          expirationDate: input.eoInsurance.expiresOn,
        },
        antiMoneyLaundering: {
          trainingVendor: input.amlCertificate.providerName,
          completionDate: input.amlCertificate.completedOn,
          expirationDate: input.amlCertificate.validUntil,
        },
      },
      eftAuthorization: {
        institution: input.banking.institutionNumber,
        transit: input.banking.transitNumber,
        accountLastFour,
      },
      supportingDocumentation: input.documents.map((doc) => ({
        category: doc.type,
        label: doc.title,
        fileChecksum: doc.sha256 ?? null,
        archiveUri: doc.storageRef,
      })),
    };
  }

  async dispatch(request: CarrierDispatchRequest, decision: DispatchDecision): Promise<CarrierDispatchReceipt> {
    // Fail closed: enforce external dispatch decision policy
    assertExternalCarrierDispatch(decision);
    throw new CarrierConnectionUnavailable(
      'Live external dispatch to Sun Life Financial is not connected (manual portal operations only)'
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Carrier Adapter Registry
// ---------------------------------------------------------------------------

const ADAPTERS = new Map<string, CarrierAdapter<any>>([
  ['ia-financial-group', new IaFinancialGroupAdapter()],
  ['sun-life', new SunLifeFinancialAdapter()],
]);

export function getCarrierAdapter(carrierId: string): CarrierAdapter<any> | null {
  return ADAPTERS.get(carrierId) ?? null;
}

export function listSupportedCarrierAdapters(): readonly CarrierAdapter<any>[] {
  return Array.from(ADAPTERS.values());
}
