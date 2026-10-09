import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { archiveSigned, readArchived } from './vault.ts';
import type { AppDeps } from './app.ts';

/** The archive vault: whether it is connected, what is in it, and a way to prove a copy is intact. Administrators and compliance only. */
export function registerVaultRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.get('/v1/compliance/vault', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can see the archive vault');
    return run(ctx, async (tx) => {
      const n = (await tx.query<{ archived: number; pending: number; last: string | null }>(
        `SELECT (SELECT count(*)::int FROM vault_objects) AS archived,
                (SELECT count(*)::int FROM advice_records a WHERE a.status = 'signed' AND a.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM box_documents d WHERE d.id = a.document_id)
                    AND NOT EXISTS (SELECT 1 FROM vault_objects v WHERE v.document_id = a.document_id)) AS pending,
                (SELECT max(created_at)::text FROM vault_objects) AS last`)).rows[0]!;
      const recent = (await tx.query(`SELECT v.document_id AS "documentId", d.name, v.retain_until::text AS "retainUntil", v.lock_mode AS "lockMode", v.created_at AS "archivedAt"
        FROM vault_objects v LEFT JOIN box_documents d ON d.id = v.document_id ORDER BY v.created_at DESC LIMIT 20`)).rows;
      const v = deps.vault;
      return { connected: !!v, bucket: v?.bucket ?? null, region: v?.region ?? null, lockMode: v?.lockMode ?? null, archived: n.archived, pending: n.pending, lastArchivedAt: n.last, recent };
    });
  });

  // Archive anything signed and not yet copied, now instead of waiting for the next scheduled pass.
  app.post('/v1/compliance/vault/archive-now', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can run the archive');
    if (!deps.vault) throw new HttpError(503, 'vault_unavailable', 'The archive vault is not connected on this server yet');
    return archiveSigned(deps, ctx.tenantId);
  });

  // Fetch the copy out of the vault, decrypt it and compare its fingerprint with the one recorded when it was archived.
  app.get('/v1/compliance/vault/:id/verify', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can verify the archive');
    if (!deps.vault) throw new HttpError(503, 'vault_unavailable', 'The archive vault is not connected on this server yet');
    const { id } = req.params as { id: string };
    const row = await run(ctx, async (tx) => (await tx.query<{ plain_sha256: string }>('SELECT plain_sha256 FROM vault_objects WHERE document_id = $1', [id])).rows[0]);
    if (!row) throw notFound('That document is not in the vault');
    const { createHash } = await import('node:crypto');
    const plain = await readArchived(deps, ctx.tenantId, id);
    const ok = createHash('sha256').update(plain).digest('hex') === row.plain_sha256;
    await run(ctx, (tx) => audit(tx, ctx, 'vault_verified', 'document', id, { intact: ok }));
    return { intact: ok };
  });
}
