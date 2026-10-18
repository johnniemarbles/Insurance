import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CarrierConnectionUnavailable, CarrierTransportRegistry, assertCarrierConnection } from '../src/carrier-connectivity.ts';
const request = { tenantId: 't1', carrierId: 'ia', contractId: 'c1', operation: 'contract_packet' as const, jurisdiction: 'ON', idempotencyKey: 'key1', evidenceReference: 'sha256:abc' };
const connection = { tenantId: 't1', carrierId: 'ia', channel: 'api' as const, enabled: true, verified: true, approvedOperations: ['contract_packet' as const], approvedJurisdictions: ['ON'], destinationVerifiedAt: '2026-10-18T00:00:00Z' };
test('no carrier configuration fails closed', () => assert.throws(() => assertCarrierConnection(null, request), CarrierConnectionUnavailable));
test('cross tenant and cross carrier connections rejected', () => {
  assert.throws(() => assertCarrierConnection({ ...connection, tenantId: 't2' }, request), CarrierConnectionUnavailable);
  assert.throws(() => assertCarrierConnection({ ...connection, carrierId: 'other' }, request), CarrierConnectionUnavailable);
});
test('unverified or disabled connections rejected', () => {
  assert.throws(() => assertCarrierConnection({ ...connection, verified: false }, request), CarrierConnectionUnavailable);
  assert.throws(() => assertCarrierConnection({ ...connection, enabled: false }, request), CarrierConnectionUnavailable);
});
test('unapproved operation and jurisdiction rejected', () => {
  assert.throws(() => assertCarrierConnection(connection, { ...request, operation: 'business_submission' }), CarrierConnectionUnavailable);
  assert.throws(() => assertCarrierConnection(connection, { ...request, jurisdiction: 'BC' }), CarrierConnectionUnavailable);
});
test('manual portal cannot masquerade as API', () => {
  assert.throws(() => assertCarrierConnection({ ...connection, channel: 'manual_portal' }, request), CarrierConnectionUnavailable);
});
test('registered adapter is required; never fabricate acknowledgment', async () => {
  await assert.rejects(new CarrierTransportRegistry().dispatch(connection, request), CarrierConnectionUnavailable);
});
test('verified matching adapter returns real adapter receipt', async () => {
  const registry = new CarrierTransportRegistry();
  registry.register('ia', { channel: 'api', async dispatch() { return { externalReference: 'external-1', acknowledgedAt: '2026-10-18T00:00:00Z', channel: 'api' }; } });
  assert.equal((await registry.dispatch(connection, request)).externalReference, 'external-1');
});
