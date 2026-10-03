import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Field encryption for tokens and linked email content (AES-256-GCM).
// KeyProvider is the seam where AWS KMS / Azure Key Vault / GCP KMS plugs in after migration.
export interface KeyProvider {
  currentKeyId(): string;
  /** 32-byte data key for the given key id. */
  getKey(keyId: string): Buffer;
}

/** Development only: keys derived from an environment secret. Blocked in staging/prod by loadConfig. */
export function localKeyProvider(secret: string, keyId = 'local-1'): KeyProvider {
  if (secret.length < 16) throw new Error('Local key secret too short');
  const key = Buffer.alloc(32);
  Buffer.from(secret, 'utf8').copy(key);
  return { currentKeyId: () => keyId, getKey: () => key };
}

export interface Sealed {
  keyId: string;
  data: Buffer; // iv (12) | tag (16) | ciphertext
}

export function seal(provider: KeyProvider, plaintext: Buffer | string, aad: string): Sealed {
  const keyId = provider.currentKeyId();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', provider.getKey(keyId), iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { keyId, data: Buffer.concat([iv, c.getAuthTag(), ct]) };
}

/** `aad` binds the ciphertext to its row (e.g. tenant id + row id) so it cannot be moved between rows. */
export function open(provider: KeyProvider, sealed: Sealed, aad: string): Buffer {
  const d = sealed.data;
  const dec = createDecipheriv('aes-256-gcm', provider.getKey(sealed.keyId), d.subarray(0, 12));
  dec.setAAD(Buffer.from(aad, 'utf8'));
  dec.setAuthTag(d.subarray(12, 28));
  return Buffer.concat([dec.update(d.subarray(28)), dec.final()]);
}
