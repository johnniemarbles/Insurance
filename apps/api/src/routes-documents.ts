import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { DOC_TYPES, type RequestContext } from '@pii/domain';
import { open, seal } from '@pii/platform';
import { audit } from './audit.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { notify } from './notify.ts';
import type { AppDeps } from './app.ts';

/** Documents on a record. Kept in PII only (encrypted at rest), seen by whoever can see the record. */
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'], 'image/gif': ['gif'],
  'text/plain': ['txt'], 'text/csv': ['csv'],
  'application/msword': ['doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};

export const cleanName = (n: string): string => n.replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);

export function registerDocumentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const keys = () => { if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Documents are not available on this server yet'); return deps.keys; };
  const idp = { type: 'object', properties: { id: uuid } } as const;

  async function box(tx: Tx, id: string) {
    const r = await tx.query<{ id: string; name: string; owner_node_id: string; owner_user_id: string | null }>('SELECT id, name, owner_node_id, owner_user_id FROM boxes WHERE id = $1', [id]);
    if (!r.rows[0]) throw notFound('Record not found');
    return r.rows[0];
  }

  app.get('/v1/boxes/:id/documents', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await box(tx, id);
      const rows = (await tx.query(
        `SELECT d.id, d.name, d.mime, d.doc_type AS "docType", d.size_bytes AS "sizeBytes", d.created_at AS "createdAt", coalesce(u.display_name, u.email::text) AS "uploadedBy"
           FROM box_documents d LEFT JOIN app_users u ON u.id = d.uploaded_by WHERE d.box_id = $1 ORDER BY d.created_at DESC LIMIT 200`, [id])).rows;
      return { documents: rows, maxBytes: MAX_BYTES, types: Object.values(TYPES).flat() };
    });
  });

  app.post('/v1/boxes/:id/documents', {
    bodyLimit: 14 * 1024 * 1024,
    schema: { params: idp, body: { type: 'object', required: ['name', 'mime', 'dataBase64'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 300 }, mime: { type: 'string', maxLength: 100 }, docType: { enum: [...DOC_TYPES] }, dataBase64: { type: 'string', minLength: 4, maxLength: 12 * 1024 * 1024 } } } },
  }, async (req, reply) => {
    const { ctx, user } = await (async () => { const i = await deps.authenticate(req); return { ctx: i.ctx, user: i.user }; })();
    requireCrm(ctx);
    const kp = keys();
    const { id } = req.params as { id: string };
    const b = req.body as { name: string; mime: string; dataBase64: string; docType?: string };
    const name = cleanName(b.name);
    if (!name) throw invalid('Give the file a name');
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    const allowed = TYPES[b.mime];
    if (!allowed) throw invalid('That kind of file is not allowed. Use PDF, images, Word, Excel, PowerPoint, text or CSV.');
    if (!allowed.includes(ext)) throw invalid('The file name does not match its type');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.dataBase64)) throw invalid('The file could not be read');
    const data = Buffer.from(b.dataBase64, 'base64');
    if (data.length === 0) throw invalid('The file is empty');
    if (data.length > MAX_BYTES) throw invalid(`Files can be up to ${MAX_BYTES / 1024 / 1024} MB`);
    const docId = randomUUID();
    const out = await run(ctx, async (tx) => {
      const bx = await box(tx, id);
      requireEdit(ctx, bx.owner_node_id);
      const sealed = seal(kp, data, `${ctx.tenantId}:doc:${docId}`);
      await tx.query(
        `INSERT INTO box_documents (id, tenant_id, box_id, name, mime, size_bytes, data_enc, key_id, uploaded_by, doc_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [docId, ctx.tenantId, id, name, b.mime, data.length, sealed.data, sealed.keyId, ctx.userId, b.docType ?? null]);
      await audit(tx, ctx, 'document_added', 'box', id, { documentId: docId, name, size: data.length, ...(b.docType ? { docType: b.docType } : {}) });
      if (bx.owner_user_id) await notify(tx, { tenantId: ctx.tenantId, userId: bx.owner_user_id, actorId: ctx.userId, kind: 'document_added', boxId: id, data: { boxName: bx.name, name } });
      return { id: docId, name };
    });
    void user;
    return reply.code(201).send(out);
  });

  // The file comes back as base64 in JSON so it travels through the extension like every other call.
  app.get('/v1/documents/:id', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const kp = keys();
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query<{ name: string; mime: string; data_enc: Buffer; key_id: string; box_id: string }>('SELECT name, mime, data_enc, key_id, box_id FROM box_documents WHERE id = $1', [id])).rows[0];
      if (!r) throw notFound('Document not found');
      await audit(tx, ctx, 'document_read', 'box', r.box_id, { documentId: id });
      const data = open(kp, { keyId: r.key_id, data: r.data_enc }, `${ctx.tenantId}:doc:${id}`);
      return { name: r.name, mime: r.mime, dataBase64: data.toString('base64') };
    });
  });

  app.delete('/v1/documents/:id', { schema: { params: idp } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = (await tx.query<{ box_id: string; name: string }>('SELECT box_id, name FROM box_documents WHERE id = $1', [id])).rows[0];
      if (!r) throw notFound('Document not found');
      const bx = await box(tx, r.box_id);
      requireEdit(ctx, bx.owner_node_id);
      await tx.query('DELETE FROM box_documents WHERE id = $1', [id]);
      await audit(tx, ctx, 'document_deleted', 'box', r.box_id, { documentId: id, name: r.name });
    });
    return reply.code(204).send();
  });
}
