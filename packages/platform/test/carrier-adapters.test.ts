import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCarrierAdapter,
  listSupportedCarrierAdapters,
  IaFinancialGroupAdapter,
  SunLifeFinancialAdapter,
  type ContractPacketInput,
} from '../src/carrier-adapters.ts';
import { CarrierConnectionUnavailable } from '../src/carrier-connectivity.ts';

function createValidPacketInput(carrierId: 'ia-financial-group' | 'sun-life', jurisdiction = 'ON'): ContractPacketInput {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    contractId: '22222222-2222-2222-2222-222222222222',
    carrierId,
    jurisdiction,
    broker: {
      id: '33333333-3333-3333-3333-333333333333',
      firstName: 'Jean-Luc',
      lastName: 'Picard',
      email: 'jpicard@example.ca',
      phone: '+14165551234',
      npnOrProducerNumber: 'PROD-98765',
      languagePreference: jurisdiction === 'QC' ? 'fr-CA' : 'en',
      primaryJurisdiction: jurisdiction,
    },
    licence: {
      licenceNumber: 'LIC-ON-2026-999',
      jurisdiction,
      class: 'Life and Accident & Sickness',
      expiresOn: '2028-12-31',
    },
    eoInsurance: {
      policyNumber: 'EO-998877',
      insurerName: 'Trisura Guarantee Insurance Company',
      coverageAmount: 2_000_000,
      aggregateAmount: 5_000_000,
      expiresOn: '2027-11-30',
    },
    banking: {
      institutionNumber: '003',
      transitNumber: '12345',
      accountNumber: '123456789',
      bankName: 'Royal Bank of Canada',
    },
    amlCertificate: {
      certificateNumber: 'AML-2026-001',
      providerName: 'Advocis / The Financial Advisors Association of Canada',
      completedOn: '2026-01-15',
      validUntil: '2027-01-15',
    },
    documents: [
      { type: 'licence', title: 'Ontario Insurance Licence', storageRef: 'vault://docs/licence.pdf', sha256: 'abcd1234' },
      { type: 'eo_insurance', title: 'Trisura E&O Certificate', storageRef: 'vault://docs/eo.pdf', sha256: 'ef012345' },
      { type: 'banking_void_cheque', title: 'RBC Void Cheque', storageRef: 'vault://docs/void_cheque.pdf', sha256: '6789abcd' },
      { type: 'aml_cert', title: 'Advocis AML Completion', storageRef: 'vault://docs/aml.pdf', sha256: '9876fedc' },
      { type: 'carrier_app_schedule', title: 'Signed Carrier Schedule', storageRef: 'vault://docs/schedule.pdf', sha256: '5555aaaa' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. Adapter Discovery & Registry
// ---------------------------------------------------------------------------

test('carrier adapter registry discovers iA and Sun Life adapters', () => {
  const ia = getCarrierAdapter('ia-financial-group');
  assert.ok(ia instanceof IaFinancialGroupAdapter);
  assert.equal(ia.carrierId, 'ia-financial-group');

  const sunLife = getCarrierAdapter('sun-life');
  assert.ok(sunLife instanceof SunLifeFinancialAdapter);
  assert.equal(sunLife.carrierId, 'sun-life');

  assert.equal(getCarrierAdapter('nonexistent-carrier'), null);

  const all = listSupportedCarrierAdapters();
  assert.equal(all.length, 2);
});

// ---------------------------------------------------------------------------
// 2. iA Financial Group Adapter Verification
// ---------------------------------------------------------------------------

test('iA adapter: validates complete prerequisites and builds canonical payload', () => {
  const adapter = new IaFinancialGroupAdapter();
  const input = createValidPacketInput('ia-financial-group', 'ON');

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);

  const payload = adapter.buildContractPacketPayload(input);
  assert.equal(payload.carrier, 'ia-financial-group');
  assert.equal(payload.channel, 'manual_portal');
  assert.equal(payload.metadata.jurisdiction, 'ON');
  assert.equal(payload.metadata.language, 'en');
  assert.equal(payload.producer.fullName, 'Jean-Luc Picard');
  assert.equal(payload.producer.advisorCode, 'PROD-98765');
  assert.equal(payload.regulatory.licenceNumber, 'LIC-ON-2026-999');
  assert.equal(payload.regulatory.eoPerClaimLimit, 2_000_000);
  assert.equal(payload.remittance.directDepositRouting, '0003-12345');
  assert.equal(payload.remittance.accountNumberMasked, '***6789');
  assert.equal(payload.attachments.length, 5);
});

test('iA adapter: rejects missing mandatory documents', () => {
  const adapter = new IaFinancialGroupAdapter();
  const input = createValidPacketInput('ia-financial-group', 'ON');
  // Remove banking_void_cheque and carrier_app_schedule
  input.documents = input.documents.filter(d => d.type !== 'banking_void_cheque' && d.type !== 'carrier_app_schedule');

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.includes('banking_void_cheque')));
  assert.ok(validation.errors.some(e => e.includes('carrier_app_schedule')));

  assert.throws(() => adapter.buildContractPacketPayload(input), /Missing mandatory iA contracting document/);
});

test('iA adapter: validates minimum E&O limit and transit routing format', () => {
  const adapter = new IaFinancialGroupAdapter();
  const input = createValidPacketInput('ia-financial-group', 'ON');
  input.eoInsurance.coverageAmount = 500_000; // Under $1M minimum
  input.banking.transitNumber = '123'; // Invalid 3-digit transit instead of 5

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.includes('$1,000,000 E&O coverage')));
  assert.ok(validation.errors.some(e => e.includes('5 digits')));
});

test('iA adapter: enforces Quebec French language warning under Bill 96 / Law 25', () => {
  const adapter = new IaFinancialGroupAdapter();
  const input = createValidPacketInput('ia-financial-group', 'QC');
  input.licence.jurisdiction = 'QC';
  input.broker.languagePreference = 'en'; // English in Quebec triggers warning

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, true); // Still valid but with warning
  assert.ok(validation.warnings.some(w => w.includes('Bill 96 / Law 25')));

  // Payload for QC still defaults to fr-CA for carrier compliance
  const payload = adapter.buildContractPacketPayload(input);
  assert.equal(payload.metadata.language, 'fr-CA');
});

test('iA adapter: dispatch fails closed under all circumstances', async () => {
  const adapter = new IaFinancialGroupAdapter();
  const req = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    carrierId: 'ia-financial-group',
    contractId: '22222222-2222-2222-2222-222222222222',
    operation: 'contract_packet' as const,
    jurisdiction: 'ON',
    idempotencyKey: 'idem-1',
    evidenceReference: 'ev-1',
  };

  // When allowExternalDispatch is false, assertExternalCarrierDispatch throws CarrierConnectionUnavailable
  await assert.rejects(
    async () => {
      await adapter.dispatch(req, {
        environment: 'staging',
        allowExternalDispatch: false,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: false,
        productionApproved: false,
        changeTicket: null,
      });
    },
    (err: any) => err instanceof CarrierConnectionUnavailable && err.message.includes('External carrier dispatch is disabled')
  );

  // Even if dispatch flags were hypothetically bypassed, adapter fails closed with manual portal notice
  await assert.rejects(
    async () => {
      await adapter.dispatch(req, {
        environment: 'staging',
        allowExternalDispatch: true,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: true,
        productionApproved: false,
        changeTicket: 'CHG-1234',
      });
    },
    (err: any) => err instanceof CarrierConnectionUnavailable && err.message.includes('manual portal operations only')
  );
});

// ---------------------------------------------------------------------------
// 3. Sun Life Financial Adapter Verification
// ---------------------------------------------------------------------------

test('Sun Life adapter: validates complete prerequisites and builds canonical payload', () => {
  const adapter = new SunLifeFinancialAdapter();
  const input = createValidPacketInput('sun-life', 'ON');

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);

  const payload = adapter.buildContractPacketPayload(input);
  assert.equal(payload.carrier, 'sun-life');
  assert.equal(payload.channel, 'manual_portal');
  assert.equal(payload.tracking.province, 'ON');
  assert.equal(payload.tracking.market, 'CA');
  assert.equal(payload.advisor.legalName, 'Jean-Luc Picard');
  assert.equal(payload.advisor.producerId, 'PROD-98765');
  assert.equal(payload.credentials.provincialLicence.number, 'LIC-ON-2026-999');
  assert.equal(payload.credentials.errorsAndOmissions.limitPerClaim, 2_000_000);
  assert.equal(payload.eftAuthorization.institution, '003');
  assert.equal(payload.eftAuthorization.transit, '12345');
  assert.equal(payload.eftAuthorization.accountLastFour, '6789');
  assert.equal(payload.supportingDocumentation.length, 5);
});

test('Sun Life adapter: rejects missing AML certificate', () => {
  const adapter = new SunLifeFinancialAdapter();
  const input = createValidPacketInput('sun-life', 'ON');
  input.documents = input.documents.filter(d => d.type !== 'aml_cert');

  const validation = adapter.validateContractPrerequisites(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(e => e.includes('aml_cert')));
});

test('Sun Life adapter: dispatch fails closed', async () => {
  const adapter = new SunLifeFinancialAdapter();
  const req = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    carrierId: 'sun-life',
    contractId: '22222222-2222-2222-2222-222222222222',
    operation: 'contract_packet' as const,
    jurisdiction: 'ON',
    idempotencyKey: 'idem-sl-1',
    evidenceReference: 'ev-sl-1',
  };

  await assert.rejects(
    async () => {
      await adapter.dispatch(req, {
        environment: 'staging',
        allowExternalDispatch: false,
        carrierAuthorized: true,
        destinationVerified: true,
        sandboxApproved: false,
        productionApproved: false,
        changeTicket: null,
      });
    },
    (err: any) => err instanceof CarrierConnectionUnavailable && err.message.includes('External carrier dispatch is disabled')
  );
});
