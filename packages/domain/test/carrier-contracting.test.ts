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

test('terminal carrier states cannot be reactivated', () => {
  for (const state of ['declined','withdrawn','terminated'] as const) {
    assert.equal(canMoveCarrierContract(state, 'active'), false);
    assert.equal(canMoveCarrierContract(state, 'appointment_verified'), false);
  }
});
test('suspension, expiry and termination always block business submission', () => {
  for (const state of ['suspended','expired','terminated'] as const) {
    assert.equal(maySubmitCarrierBusiness({ ...valid, carrierState: state }), false);
    assert.ok(carrierAuthorizationBlocks({ ...valid, carrierState: state }).includes('carrier_not_active'));
  }
});
test('each appointment and licensing failure independently blocks authorization', () => {
  for (const patch of [
    { appointmentEffective: false },
    { appointmentNotExpired: false },
    { licenceValid: false },
    { eoValid: false },
    { jurisdictionAllowed: false },
    { productAllowed: false },
    { agencyAgreementCountersigned: false },
    { complianceHold: true },
  ]) {
    assert.equal(maySubmitCarrierBusiness({ ...valid, ...patch }), false);
  }
});

test('unrecognized carrier states fail closed rather than crash', () => {
  assert.equal(canMoveCarrierContract('unknown' as never, 'active'), false);
  assert.equal(canMoveCarrierContract('requested', 'unknown' as never), false);
  assert.equal(maySubmitCarrierBusiness({ ...valid, carrierState: 'unknown' as never }), false);
});
