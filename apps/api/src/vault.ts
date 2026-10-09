import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { withRequestTx } from '@pii/db';
import { retentionYears } from '@pii/domain';
import { open, seal } from '@pii/platform';
import { audit } from './audit.ts';
import { actingAs } from './effects.ts';
import type { AppDeps } from './app.ts';

export type LockMode = 'GOVERNANCE' | 'COMPLIANCE' | 'NONE';
export interface PutResult { versionId: string | null; sha256: string }
/** Write-once storage. Objects are stored encrypted; the bucket holds nothing readable. */
export interface Vault {
  readonly bucket: string; readonly region: string; readonly lockMode: LockMode;
  put(key: string, bytes: Buffer, retainUntil: Date | null): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  check(): Promise<void>;
}

/** Amazon S3 with Object Lock. The bucket must be created with Object Lock enabled (versioning on). */
export function s3Vault(env: Record<string, string | undefined> = process.env): Vault | undefined {
  const bucket = env.VAULT_S3_BUCKET; const region = env.VAULT_S3_REGION;
  if (!bucket || !region) return undefined;
  const raw = (env.VAULT_LOCK_MODE ?? 'GOVERNANCE').toUpperCase();
  const lockMode: LockMode = raw === 'COMPLIANCE' ? 'COMPLIANCE' : raw === 'NONE' ? 'NONE' : 'GOVERNANCE';
  const client = new S3Client({ region, ...(env.VAULT_AWS_ACCESS_KEY_ID && env.VAULT_AWS_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.VAULT_AWS_ACCESS_KEY_ID, secretAccessKey: env.VAULT_AWS_SECRET_ACCESS_KEY } } : {}) });
  return {
    bucket, region, lockMode,
    async put(key, bytes, retainUntil) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const out = await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/octet-stream', ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
        ServerSideEncryption: 'AES256',
        ...(lockMode !== 'NONE' && retainUntil ? { ObjectLockMode: lockMode, ObjectLockRetainUntilDate: retainUntil } : {}),
      }));
      return { versionId: out.VersionId ?? null, sha256 };
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    },
    async check() { await client.send(new HeadBucketCommand({ Bucket: bucket })); },
  };
}

export const vaultKey = (tenantId: string, documentId: string) => `${tenantId}/${documentId}.bin`;

/** Copy every signed document that is not yet archived. Returns how many were archived and how many failed. One failure never stops the rest. */
export async function archiveSigned(deps: AppDeps, onlyTenant?: string): Promise<{ archived: number; failed: number }> {
  const vault = deps.vault; const keys = deps.keys;
  if (!vault || !keys) return { archived: 0, failed: 0 };
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id WHERE n.type = 'tenant' AND n.is_active ${onlyTenant ? 'AND n.tenant_id = $1' : ''} LIMIT 500`, onlyTenant ? [onlyTenant] : [])).rows;
  let archived = 0, failed = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    const ctx = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
    try {
      const years = await withRequestTx(deps.appPool, ctx, async (tx) => {
        const r = (await tx.query<{ years: number }>(`SELECT years FROM retention_policies WHERE record_kind = 'advice'`)).rows[0];
        return retentionYears('advice', r?.years);
      });
      const todo = await withRequestTx(deps.appPool, ctx, async (tx) => (await tx.query<{ advice_id: string; box_id: string; document_id: string }>(
        `SELECT a.id AS advice_id, a.box_id, a.document_id FROM advice_records a
          WHERE a.status = 'signed' AND a.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM box_documents d WHERE d.id = a.document_id)
            AND NOT EXISTS (SELECT 1 FROM vault_objects v WHERE v.document_id = a.document_id)
          ORDER BY a.signed_at LIMIT 50`)).rows);
      for (const d of todo) {
        try {
          const doc = await withRequestTx(deps.appPool, ctx, async (tx) => (await tx.query<{ data_enc: Buffer; key_id: string }>('SELECT data_enc, key_id FROM box_documents WHERE id = $1', [d.document_id])).rows[0]);
          if (!doc) continue;
          const plain = open(keys, { keyId: doc.key_id, data: doc.data_enc }, `${t.tenant_id}:doc:${d.document_id}`);
          const sealed = seal(keys, plain, `${t.tenant_id}:vault:${d.document_id}`);
          const blob = Buffer.concat([Buffer.from(sealed.keyId + '\n'), sealed.data]);
          const retain = new Date(); retain.setUTCFullYear(retain.getUTCFullYear() + years);
          const key = vaultKey(t.tenant_id, d.document_id);
          const put = await vault.put(key, blob, retain);
          await withRequestTx(deps.appPool, ctx, async (tx) => {
            await tx.query(
              `INSERT INTO vault_objects (tenant_id, document_id, advice_id, box_id, bucket, object_key, version_id, sha256, plain_sha256, size_bytes, lock_mode, retain_until)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
              [t.tenant_id, d.document_id, d.advice_id, d.box_id, vault.bucket, key, put.versionId, put.sha256, createHash('sha256').update(plain).digest('hex'), blob.length, vault.lockMode, retain.toISOString().slice(0, 10)]);
            await audit(tx, ctx, 'vault_archived', 'box', d.box_id, { documentId: d.document_id, adviceId: d.advice_id, bucket: vault.bucket, retainUntil: retain.toISOString().slice(0, 10) });
          });
          archived++;
        } catch (e) { failed++; if (process.env.VAULT_DEBUG) console.error('vault', e); }
      }
    } catch (e) { failed++; if (process.env.VAULT_DEBUG) console.error('vault tenant', e); }
  }
  return { archived, failed };
}

/** Read an archived document back out of the vault and decrypt it. Used to prove the copy is intact. */
export async function readArchived(deps: AppDeps, tenantId: string, documentId: string): Promise<Buffer> {
  const blob = await deps.vault!.get(vaultKey(tenantId, documentId));
  const nl = blob.indexOf(10);
  return open(deps.keys!, { keyId: blob.subarray(0, nl).toString(), data: blob.subarray(nl + 1) }, `${tenantId}:vault:${documentId}`);
}
