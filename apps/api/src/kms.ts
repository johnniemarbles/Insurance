// Field-encryption keys from AWS KMS (SOC 2 readiness gap 12; code review finding M-03). Switched on by setting
// KMS_WRAPPED_DATA_KEY: a 32-byte data key encrypted by a KMS key (aws kms generate-data-key --key-spec AES_256, the
// CiphertextBlob). The plaintext key lives only in memory. Data sealed earlier under LOCAL_KEY_SECRET keeps opening.
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { localKeyProvider, wrappedKeyProvider, type Config, type KeyProvider } from '@pii/platform';

export async function keysFromEnv(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<KeyProvider | undefined> {
  const local = config.localKeys && config.localKeySecret ? localKeyProvider(config.localKeySecret, config.currentKeyId) : undefined;
  const wrapped = env.KMS_WRAPPED_DATA_KEY?.trim();
  if (!wrapped) return local;
  const region = env.KMS_REGION ?? env.VAULT_S3_REGION;
  if (!region) throw new Error('KMS_REGION is required with KMS_WRAPPED_DATA_KEY');
  const accessKeyId = env.KMS_AWS_ACCESS_KEY_ID ?? env.VAULT_AWS_ACCESS_KEY_ID, secretAccessKey = env.KMS_AWS_SECRET_ACCESS_KEY ?? env.VAULT_AWS_SECRET_ACCESS_KEY;
  const kms = new KMSClient({ region, ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) });
  return wrappedKeyProvider({
    keyId: env.KMS_KEY_ID_LABEL ?? 'kms-1',
    wrappedKeyB64: wrapped,
    previous: local,
    unwrap: async (blob) => {
      const r = await kms.send(new DecryptCommand({ CiphertextBlob: blob, ...(env.KMS_KEY_ARN ? { KeyId: env.KMS_KEY_ARN } : {}) }));
      if (!r.Plaintext) throw new Error('KMS returned no key');
      return Buffer.from(r.Plaintext);
    },
  });
}
