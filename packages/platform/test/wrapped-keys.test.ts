// Keys from a managed key service: new data is sealed under the KMS-held key, data sealed before the switch still opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { localKeyProvider, open, seal, wrappedKeyProvider } from '../src/index.ts';

test('after moving to KMS: new data uses the KMS key; old data still opens; a wrong-size key is refused', async () => {
  const local = localKeyProvider('0123456789abcdef0123456789abcdef', 'local-1');
  const old = seal(local, 'client note from before the switch', 't1:note:1');
  const dataKey = randomBytes(32);
  const unwrapped: Buffer[] = [];
  const kms = await wrappedKeyProvider({ keyId: 'kms-1', wrappedKeyB64: Buffer.from('wrapped-blob').toString('base64'), previous: local,
    unwrap: async (blob) => { unwrapped.push(blob); return dataKey; } });
  assert.equal(unwrapped[0]!.toString(), 'wrapped-blob', 'the wrapped key is what KMS is asked to unwrap');
  const fresh = seal(kms, 'client note after the switch', 't1:note:2');
  assert.equal(fresh.keyId, 'kms-1');
  assert.equal(open(kms, fresh, 't1:note:2').toString(), 'client note after the switch');
  assert.equal(open(kms, old, 't1:note:1').toString(), 'client note from before the switch');
  assert.throws(() => open(local, fresh, 't1:note:2'), 'the old key cannot open new data');
  await assert.rejects(wrappedKeyProvider({ keyId: 'kms-1', wrappedKeyB64: 'eA==', unwrap: async () => randomBytes(16) }), /32 bytes/);
  const alone = await wrappedKeyProvider({ keyId: 'kms-1', wrappedKeyB64: 'eA==', unwrap: async () => dataKey });
  assert.throws(() => alone.getKey('local-1'), /No key for local-1/);
});
