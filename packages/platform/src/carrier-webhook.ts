import { createHmac, timingSafeEqual } from 'node:crypto';

export class CarrierWebhookRejected extends Error {
  readonly code = 'CARRIER_WEBHOOK_REJECTED';
}
export interface CarrierWebhookEnvelope {
  carrierId: string;
  eventId: string;
  timestamp: number;
  body: string;
  signature: string;
}
export interface CarrierWebhookReceipt {
  carrierId: string;
  eventId: string;
  payload: unknown;
}
export function verifyCarrierWebhook(
  envelope: CarrierWebhookEnvelope,
  secret: string,
  now = Date.now(),
  maxSkewMs = 300_000,
): CarrierWebhookReceipt {
  if (!secret || Buffer.byteLength(secret) < 32) throw new CarrierWebhookRejected('Webhook secret not configured');
  if (!envelope.carrierId || !envelope.eventId || !Number.isSafeInteger(envelope.timestamp))
    throw new CarrierWebhookRejected('Invalid webhook metadata');
  if (Math.abs(now - envelope.timestamp) > maxSkewMs)
    throw new CarrierWebhookRejected('Webhook timestamp expired or in future');
  if (!/^[a-f0-9]{64}$/i.test(envelope.signature))
    throw new CarrierWebhookRejected('Invalid webhook signature');
  const canonical = envelope.timestamp + '.' + envelope.eventId + '.' + envelope.body;
  const expected = createHmac('sha256', secret).update(canonical).digest();
  const received = Buffer.from(envelope.signature, 'hex');
  if (!timingSafeEqual(expected, received))
    throw new CarrierWebhookRejected('Webhook authentication failed');
  let payload: unknown;
  try { payload = JSON.parse(envelope.body); }
  catch { throw new CarrierWebhookRejected('Malformed webhook payload'); }
  return { carrierId: envelope.carrierId, eventId: envelope.eventId, payload };
}
/**
 * Replay protection must be enforced in a durable database with a unique
 * (carrier_id,event_id) constraint. This helper verifies authenticity only.
 */
