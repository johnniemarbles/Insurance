import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CarrierWebhookSecurityInput = {
  tenantId: string;
  carrierId: string;
  eventId: string;
  timestamp: number;
  signature: string;
  rawBody: Buffer;
};

export function carrierSecretPrefix(
  tenantId: string,
  carrierId: string
): string {
  if (!UUID.test(tenantId)) {
    throw new Error('Invalid tenant identifier');
  }
  if (!/^[a-z0-9-]+$/.test(carrierId)) {
    throw new Error('Invalid carrier identifier');
  }

  return `CARRIER_WEBHOOK_SECRET_${
    tenantId.replace(/-/g, '_').toUpperCase()
  }_${carrierId.replace(/-/g, '_').toUpperCase()}`;
}

export function getCarrierWebhookSecrets(
  tenantId: string,
  carrierId: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const prefix = carrierSecretPrefix(tenantId, carrierId);

  const candidates = [
    env[`${prefix}_PRIMARY`],
    env[`${prefix}_SECONDARY`],
  ];

  return candidates.filter(
    (secret): secret is string =>
      typeof secret === 'string' &&
      Buffer.byteLength(secret, 'utf8') >= 32
  );
}

export function verifyCarrierWebhookSignature(
  input: CarrierWebhookSecurityInput,
  secrets: string[],
  now = Date.now()
): boolean {
  const {
    eventId,
    timestamp,
    signature,
    rawBody,
  } = input;

  if (!Buffer.isBuffer(rawBody)) return false;
  if (!eventId || eventId.length > 200) return false;
  if (!Number.isSafeInteger(timestamp)) return false;

  // Existing PII protocol uses millisecond timestamps.
  if (Math.abs(now - timestamp) > 300_000) {
    return false;
  }

  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  if (secrets.length === 0) return false;

  const supplied = Buffer.from(signature, 'hex');

  const prefix = Buffer.from(
    `${timestamp}.${eventId}.`,
    'utf8'
  );

  const message = Buffer.concat([prefix, rawBody]);

  let matched = false;

  for (const secret of secrets) {
    const expected = createHmac('sha256', secret)
      .update(message)
      .digest();

    matched =
      timingSafeEqual(expected, supplied) || matched;
  }

  return matched;
}
