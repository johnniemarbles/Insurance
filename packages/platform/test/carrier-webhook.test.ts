import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { verifyCarrierWebhook, CarrierWebhookRejected } from '../src/carrier-webhook.ts';
const secret = 'test-secret-for-signed-carrier-events-123456789';
const timestamp = 1_760_000_000_000;
const body = '{"status":"acknowledged"}';
const sign = (eventId: string, payload = body) => createHmac('sha256', secret).update(timestamp + '.' + eventId + '.' + payload).digest('hex');
test('authentic signed carrier webhook passes', () => {
  assert.deepEqual(verifyCarrierWebhook({ carrierId:'ia',eventId:'evt1',timestamp,body,signature:sign('evt1') },secret,timestamp).payload,{status:'acknowledged'});
});
test('tampered body and event id fail', () => {
  assert.throws(()=>verifyCarrierWebhook({carrierId:'ia',eventId:'evt1',timestamp,body:'{}',signature:sign('evt1')},secret,timestamp),CarrierWebhookRejected);
  assert.throws(()=>verifyCarrierWebhook({carrierId:'ia',eventId:'evt2',timestamp,body,signature:sign('evt1')},secret,timestamp),CarrierWebhookRejected);
});
test('expired webhook and absent secret fail', () => {
  const e={carrierId:'ia',eventId:'evt1',timestamp,body,signature:sign('evt1')};
  assert.throws(()=>verifyCarrierWebhook(e,secret,timestamp+300001),CarrierWebhookRejected);
  assert.throws(()=>verifyCarrierWebhook(e,'',timestamp),CarrierWebhookRejected);
});
test('malformed JSON rejected even when signed', () => {
  const malformed='no-json';
  assert.throws(()=>verifyCarrierWebhook({carrierId:'ia',eventId:'evt1',timestamp,body:malformed,signature:sign('evt1',malformed)},secret,timestamp),CarrierWebhookRejected);
});
