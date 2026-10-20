import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, localKeyProvider, seal, open, newToken, hashToken } from '../src/index.ts';

const env = { REGION: 'ca-qc', DATABASE_URL: 'a', APP_DATABASE_URL: 'b', AUTH_DATABASE_URL: 'c' };

test('config refuses dev shortcuts in prod and staging', () => {
  // staging/prod must also say where they are hosted (see the hosting-country test below)
  assert.throws(() => loadConfig({ ...env, HOSTED_IN: 'ca', APP_ENV: 'prod', DEV_AUTH: 'true' }), /not allowed/);
  assert.throws(() => loadConfig({ ...env, HOSTED_IN: 'ca', APP_ENV: 'staging', LOCAL_KEYS: 'true', LOCAL_KEY_SECRET: 'x'.repeat(31) }), /32\+/);
  assert.equal(loadConfig({ ...env, HOSTED_IN: 'ca', APP_ENV: 'prod', LOCAL_KEYS: 'true', LOCAL_KEY_SECRET: 'x'.repeat(32) }).localKeys, true);
  assert.equal(loadConfig({ ...env, APP_ENV: 'dev', DEV_AUTH: 'true' }).devAuth, true);
});

test('config requires a valid region and database urls', () => {
  assert.throws(() => loadConfig({ ...env, REGION: 'eu' }));
  assert.throws(() => loadConfig({ REGION: 'us' }));
});

test('dataCountry is where the data is physically hosted, not the tenant region', () => {
  // HOSTED_IN (the physical hosting country) decides, whatever the tenant region is.
  assert.equal(loadConfig({ ...env, REGION: 'ca-qc', HOSTED_IN: 'ca' }).dataCountry, 'CA');
  assert.equal(loadConfig({ ...env, REGION: 'us', HOSTED_IN: 'us' }).dataCountry, 'US');
  assert.equal(loadConfig({ ...env, REGION: 'ca-qc', HOSTED_IN: 'us', APP_ENV: 'prod' }).dataCountry, 'US');
  // DATA_COUNTRY may be given instead, or alongside when it agrees.
  assert.equal(loadConfig({ ...env, REGION: 'us', DATA_COUNTRY: 'CA', APP_ENV: 'prod' }).dataCountry, 'CA');
  assert.equal(loadConfig({ ...env, HOSTED_IN: 'ca', DATA_COUNTRY: 'CA', APP_ENV: 'prod' }).dataCountry, 'CA');
  assert.throws(() => loadConfig({ ...env, HOSTED_IN: 'ca', DATA_COUNTRY: 'US' }), /DATA_COUNTRY conflicts with HOSTED_IN/);
  // Unknown values are refused.
  assert.throws(() => loadConfig({ ...env, HOSTED_IN: 'eu' }), /Invalid HOSTED_IN/);
  assert.throws(() => loadConfig({ ...env, DATA_COUNTRY: 'GB' }), /Invalid DATA_COUNTRY/);
  // dev may leave it out and falls back to the region; staging/prod must say where they are hosted.
  assert.equal(loadConfig({ ...env, REGION: 'ca-qc' }).dataCountry, 'CA');
  assert.equal(loadConfig({ ...env, REGION: 'us', APP_ENV: 'dev' }).dataCountry, 'US');
  assert.throws(() => loadConfig({ ...env, APP_ENV: 'prod' }), /Hosting country must be configured/);
  assert.throws(() => loadConfig({ ...env, REGION: 'us', APP_ENV: 'staging' }), /Hosting country must be configured/);
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
