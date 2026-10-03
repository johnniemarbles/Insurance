import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { setGoogleKeysForTest, verifyIdToken, type Jwk } from '../src/google.ts';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string }), kid: 'k1', alg: 'RS256' } as Jwk;
setGoogleKeysForTest([jwk]);

const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}) {
  const head = b({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' });
  const body = b({ iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n1', sub: 's1', email: 'a@b.co', email_verified: true, name: 'A', ...claims });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

test('a valid Google id_token yields a profile', async () => {
  const p = await verifyIdToken(token({}), 'cid', 'n1');
  assert.deepEqual(p, { sub: 's1', email: 'a@b.co', emailVerified: true, name: 'A' });
});

test('wrong audience, nonce, issuer, expiry, algorithm, key or signature are all refused', async () => {
  await assert.rejects(verifyIdToken(token({ aud: 'other' }), 'cid', 'n1'), /audience/);
  await assert.rejects(verifyIdToken(token({}), 'cid', 'different'), /nonce/);
  await assert.rejects(verifyIdToken(token({ iss: 'https://evil.example' }), 'cid', 'n1'), /issuer/);
  await assert.rejects(verifyIdToken(token({ exp: 1 }), 'cid', 'n1'), /expired/);
  await assert.rejects(verifyIdToken(token({}, { alg: 'none' }), 'cid', 'n1'), /algorithm/);
  await assert.rejects(verifyIdToken(token({}, { kid: 'zzz' }), 'cid', 'n1'), /Unknown/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyIdToken(token({}, { key: other }), 'cid', 'n1'), /signature/);
});
