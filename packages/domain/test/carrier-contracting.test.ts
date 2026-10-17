import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { canMoveCarrierContract, carrierAuthorizationBlocks, maySubmitCarrierBusiness, type CarrierAuthorization } from '../src/carrier-contracting.ts';

const valid: CarrierAuthorization = {
  brokerCleared: true, agencyAgreementCountersigned: true, licenceValid: true,
  eoValid: true, trainingCurrent: true, jurisdictionAllowed: true,
  productAllowed: true, carrierState: 'active', appointmentEffective: true,
  appointmentNotExpired: true, complianceHold: false,
};
test('carrier signatures and approvals never equal permission to sell', () => {
  for (const state of ['broker_signed', 'submitted', 'approved', 'appointment_verified'] as const) {
    assert.equal(maySubmitCarrierBusiness({ ...valid, carrierState: state }), false);
  }
});
test('every authorization requirement independently blocks submission', () => {
  assert.equal(maySubmitCarrierBusiness(valid), true);
  for (const key of Object.keys(valid) as (keyof CarrierAuthorization)[]) {
    if (key === 'carrierState') continue;
    const invalid = { ...valid, [key]: key === 'complianceHold' ? true : false };
    assert.equal(maySubmitCarrierBusiness(invalid), false, key);
    assert.ok(carrierAuthorizationBlocks(invalid).length > 0);
  }
});
test('contract cannot jump from requested to active', () => {
  assert.equal(canMoveCarrierContract('requested', 'active'), false);
  assert.equal(canMoveCarrierContract('requested', 'documents_prepared'), true);
  assert.equal(canMoveCarrierContract('approved', 'appointment_verified'), true);
  assert.equal(canMoveCarrierContract('approved', 'active'), false);
});
