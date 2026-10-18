import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  getCarrierWebhookSecrets,
  verifyCarrierWebhookSignature,
} from '../src/carrier-webhook-security.ts';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CARRIER = 'ia-financial-group';

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

const key = (tenant: string, suffix: string) =>
  `CARRIER_WEBHOOK_SECRET_${
    tenant.replace(/-/g, '_').toUpperCase()
  }_IA_FINANCIAL_GROUP_${suffix}`;

const timestamp = 1_800_000_000_000;
const eventId = 'evt-security-v2';

const rawBody = Buffer.from(
  '{ "eventType": "appointment.confirmed", "id": 1 }'
);

function sign(secret: string, body = rawBody): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.`)
    .update(body)
    .digest('hex');
}

const input = (signature: string, body = rawBody) => ({
  tenantId: TENANT_A,
  carrierId: CARRIER,
  eventId,
  timestamp,
  signature,
  rawBody: body,
});

test('primary secret verifies', () => {
  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_A)),
      [SECRET_A],
      timestamp
    ),
    true
  );
});

test('secondary secret supports rotation', () => {
  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_B)),
      [SECRET_A, SECRET_B],
      timestamp
    ),
    true
  );
});

test('unknown secret is rejected', () => {
  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_B)),
      [SECRET_A],
      timestamp
    ),
    false
  );
});

test('changed JSON whitespace invalidates signature', () => {
  const changed = Buffer.from(
    '{"eventType":"appointment.confirmed","id":1}'
  );

  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_A), changed),
      [SECRET_A],
      timestamp
    ),
    false
  );
});

test('expired timestamp is rejected', () => {
  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_A)),
      [SECRET_A],
      timestamp + 300_001
    ),
    false
  );
});

test('malformed signature is rejected', () => {
  assert.equal(
    verifyCarrierWebhookSignature(
      input('not-a-signature'),
      [SECRET_A],
      timestamp
    ),
    false
  );
});

test('tenant secrets remain isolated', () => {
  const env = {
    [key(TENANT_A, 'PRIMARY')]: SECRET_A,
    [key(TENANT_B, 'PRIMARY')]: SECRET_B,
  };

  const a = getCarrierWebhookSecrets(
    TENANT_A, CARRIER, env
  );

  const b = getCarrierWebhookSecrets(
    TENANT_B, CARRIER, env
  );

  assert.deepEqual(a, [SECRET_A]);
  assert.deepEqual(b, [SECRET_B]);

  assert.equal(
    verifyCarrierWebhookSignature(
      input(sign(SECRET_A)),
      b,
      timestamp
    ),
    false
  );
});
