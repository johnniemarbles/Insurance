import { createHash, randomBytes } from 'node:crypto';

/** Invitation tokens: random, URL-safe, only the SHA-256 hash is stored. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
