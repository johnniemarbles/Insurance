import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, localKeyProvider, seal, open, newToken, hashToken } from '../src/index.ts';

const env = { REGION: 'ca-qc', DATABASE_URL: 'a', APP_DATABASE_URL: 'b', AUTH_DATABASE_URL: 'c' };

test('config refuses dev shortcuts in prod and staging', () => {
  assert.throws(() => loadConfig({ ...env, APP_ENV: 'prod', DEV_AUTH: 'true' }), /not allowed/);
  assert.throws(() => loadConfig({ ...env, APP_ENV: 'staging', LOCAL_KEYS: 'true', LOCAL_KEY_SECRET: 'x'.repeat(31) }), /32\+/);
  assert.equal(loadConfig({ ...env, APP_ENV: 'prod', LOCAL_KEYS: 'true', LOCAL_KEY_SECRET: 'x'.repeat(32) }).localKeys, true);
  assert.equal(loadConfig({ ...env, APP_ENV: 'dev', DEV_AUTH: 'true' }).devAuth, true);
});

test('config requires a valid region and database urls', () => {
  assert.throws(() => loadConfig({ ...env, REGION: 'eu' }));
  assert.throws(() => loadConfig({ REGION: 'us' }));
});

test('seal/open round trip, and ciphertext is bound to its row', () => {
  const kp = localKeyProvider('0123456789abcdef0123');
  const s = seal(kp, 'refresh-token', 'tenant:1/row:1');
  assert.equal(open(kp, s, 'tenant:1/row:1').toString(), 'refresh-token');
  assert.throws(() => open(kp, s, 'tenant:1/row:2'));
  const tampered = { ...s, data: Buffer.from(s.data) };
  tampered.data[tampered.data.length - 1]! ^= 1;
  assert.throws(() => open(kp, tampered, 'tenant:1/row:1'));
  assert.notDeepEqual(seal(kp, 'x', 'a').data, seal(kp, 'x', 'a').data);
});

test('invitation tokens are random and only the hash matches', () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a.token, b.token);
  assert.deepEqual(hashToken(a.token), a.hash);
  assert.equal(a.hash.length, 32);
});
