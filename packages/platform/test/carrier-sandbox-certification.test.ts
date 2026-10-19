import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCarrierSandboxProtocol,
  buildSandboxContractInput,
} from '../src/carrier-sandbox.ts';

const MOCK_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('Gate 3 Sandbox: iA Financial Group protocol execution (ON jurisdiction, appointment confirmed)', async () => {
  const input = buildSandboxContractInput('ia-financial-group', 'ON');
  const result = await executeCarrierSandboxProtocol('ia-financial-group', input, {
    mockSecret: MOCK_SECRET,
    eventType: 'appointment.confirmed',
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.packetValidated, true);
  assert.equal(result.validationResult.valid, true);
  assert.equal(result.validationResult.errors.length, 0);

  // Verify canonical payload
  assert.ok(result.canonicalPayload);
  assert.equal(result.canonicalPayload.carrier, 'ia-financial-group');
  assert.equal(result.canonicalPayload.metadata.jurisdiction, 'ON');
  assert.equal(result.canonicalPayload.regulatory.eoPerClaimLimit, 2_000_000);

  // Verify dispatch failed closed
  assert.equal(result.dispatchFailedClosed, true);
  assert.match(result.failClosedError ?? '', /External carrier dispatch is disabled/);

  // Verify simulated webhook verification
  assert.equal(result.simulatedWebhook.verifiedReceipt.carrierId, 'ia-financial-group');
  const payload = result.simulatedWebhook.verifiedReceipt.payload as any;
  assert.equal(payload.eventType, 'appointment.confirmed');
  assert.ok(payload.appointmentReference.startsWith('APPT-IA-FINANCIAL-GROUP-'));
});

test('Gate 3 Sandbox: Sun Life Financial protocol execution (QC jurisdiction, Law 25 French language compliance)', async () => {
  const input = buildSandboxContractInput('sun-life', 'QC', {
    broker: {
      id: 'broker-qc-1',
      firstName: 'François',
      lastName: 'Tremblay',
      email: 'ftremblay@pilot.qc.ca',
      primaryJurisdiction: 'QC',
      languagePreference: 'fr-CA',
    },
  });

  const result = await executeCarrierSandboxProtocol('sun-life', input, {
    mockSecret: MOCK_SECRET,
    eventType: 'appointment.confirmed',
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.packetValidated, true);
  assert.equal(result.validationResult.valid, true);

  // Law 25 language compliance in Quebec: no warnings expected when language is French
  assert.equal(result.validationResult.warnings.length, 0);

  // Verify canonical Sun Life structure
  assert.ok(result.canonicalPayload);
  assert.equal(result.canonicalPayload.carrier, 'sun-life');
  assert.equal(result.canonicalPayload.tracking.province, 'QC');
  assert.equal(result.canonicalPayload.advisor.correspondenceLanguage, 'fr');

  // Verify fail-closed
  assert.equal(result.dispatchFailedClosed, true);
  assert.match(result.failClosedError ?? '', /External carrier dispatch is disabled/);
});

test('Gate 3 Sandbox: document defect rejection simulation', async () => {
  const input = buildSandboxContractInput('ia-financial-group', 'ON');
  const result = await executeCarrierSandboxProtocol('ia-financial-group', input, {
    mockSecret: MOCK_SECRET,
    eventType: 'document.rejected',
    defectCode: 'DEF_EXPIRED_EO',
    rejectionReason: 'Errors & Omissions certificate has expired',
  });

  assert.equal(result.status, 'passed');
  const payload = result.simulatedWebhook.verifiedReceipt.payload as any;
  assert.equal(payload.eventType, 'document.rejected');
  assert.equal(payload.defectCode, 'DEF_EXPIRED_EO');
  assert.equal(payload.reason, 'Errors & Omissions certificate has expired');
});

test('Gate 3 Sandbox: prerequisite validation failure halts canonical payload synthesis', async () => {
  // Input missing mandatory licence document and sub-threshold E&O ($500k instead of $1M)
  const invalidInput = buildSandboxContractInput('ia-financial-group', 'ON', {
    eoInsurance: {
      policyNumber: 'EO-LOW',
      insurerName: 'Low Coverage Insurer',
      coverageAmount: 500_000, // Below minimum $1M
      aggregateAmount: 1_000_000,
      expiresOn: '2027-12-31',
    },
    documents: [
      { type: 'eo_insurance', title: 'Low E&O', storageRef: 'vault://eo.pdf' },
      // licence document intentionally missing
    ],
  });

  const result = await executeCarrierSandboxProtocol('ia-financial-group', invalidInput, {
    mockSecret: MOCK_SECRET,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.packetValidated, false);
  assert.equal(result.canonicalPayload, null);
  assert.ok(result.validationResult.errors.some((e) => e.includes('minimum $1,000,000 E&O coverage')));
  assert.ok(result.validationResult.errors.some((e) => e.includes('Missing mandatory iA contracting document: licence')));
});
