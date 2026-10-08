import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { ADVICE_KINDS, ADVICE_LABELS, OTP_MAX_ATTEMPTS, OTP_MINUTES, gateTypeFor, signingTierFor, type AdviceKind, type RequestContext } from '@pii/domain';
import { seal } from '@pii/platform';
import { audit } from './audit.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

interface Row {
  id: string; box_id: string; kind: AdviceKind; title: string; body: string; tier: 'builtin' | 'vendor'; status: 'draft' | 'awaiting_signature' | 'signed';
  client_name: string; client_email: string | null; content_hash: string | null; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number;
  signed_at: string | null; signed_method: string | null; vendor_name: string | null; vendor_ref: string | null; document_id: string | null; owner_node_id: string; box_name: string;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const contentHash = (r: Pick<Row, 'box_id' | 'kind' | 'title' | 'body' | 'client_name' | 'client_email'>) =>
  sha(JSON.stringify({ box: r.box_id, kind: r.kind, title: r.title, body: r.body, client: r.client_name, email: r.client_email ?? '' }));
const PUBLIC = `a.id, a.box_id AS "boxId", a.kind, a.title, a.body, a.tier, a.status, a.client_name AS "clientName", a.client_email AS "clientEmail", a.content_hash AS "contentHash",
  a.signed_at AS "signedAt", a.signed_method AS "signedMethod", a.vendor_name AS "vendorName", a.vendor_ref AS "vendorRef", a.document_id AS "documentId", a.created_at AS "createdAt",
  coalesce(u.display_name, u.email::text) AS "createdBy"`;

/** Advice records: the brokerage's own system of record for advice given, with a built-in one-time-code signature or a record of a vendor signature. */
export function registerAdviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const kindEnum = { enum: [...ADVICE_KINDS] } as const;
  const text = (max: number, min = 1) => ({ type: 'string', minLength: min, maxLength: max }) as const;

  async function load(tx: Tx, id: string): Promise<Row> {
    const r = (await tx.query<Row>(
      `SELECT a.*, b.owner_node_id, b.name AS box_name FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = $1`, [id])).rows[0];
    if (!r) throw notFound('Advice record not found');
    return r;
  }

  app.get('/v1/boxes/:id/advice', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM boxes WHERE id = $1', [id])).rowCount) throw notFound('Record not found');
      const rows = (await tx.query(`SELECT ${PUBLIC} FROM advice_records a LEFT JOIN app_users u ON u.id = a.created_by WHERE a.box_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [id])).rows;
      return { advice: rows, kinds: ADVICE_KINDS.map((k) => ({ kind: k, tier: signingTierFor(k), label: ADVICE_LABELS[k] })) };
    });
  });

  app.post('/v1/boxes/:id/advice', {
    schema: { params: idp, body: { type: 'object', required: ['kind', 'title', 'body', 'clientName'], additionalProperties: false, properties: { kind: kindEnum, title: text(200), body: text(20000), clientName: text(200), clientEmail: { type: 'string', format: 'email', maxLength: 200 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { kind: AdviceKind; title: string; body: string; clientName: string; clientEmail?: string };
    const out = await run(ctx, async (tx) => {
      const bx = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!bx) throw notFound('Record not found');
      requireEdit(ctx, bx.owner_node_id);
      const r = await tx.query<{ id: string }>(
        `INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, client_name, client_email, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, b.kind, b.title.trim(), b.body.trim(), signingTierFor(b.kind), b.clientName.trim(), b.clientEmail ?? null, ctx.userId]);
      await audit(tx, ctx, 'advice_created', 'box', id, { adviceId: r.rows[0]!.id, kind: b.kind });
      return { id: r.rows[0]!.id, tier: signingTierFor(b.kind) };
    });
    return reply.code(201).send(out);
  });

  // Drafts can be edited; once a code has been sent or the record is signed, the wording is fixed.
  app.patch('/v1/advice/:id', {
    schema: { params: idp, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { title: text(200), body: text(20000), clientName: text(200), clientEmail: { type: 'string', format: 'email', maxLength: 200 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { title?: string; body?: string; clientName?: string; clientEmail?: string };
    await run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status !== 'draft') throw new HttpError(409, 'advice_locked', 'This record has been sent for signature or signed, so its wording is fixed. Create a new one to change it.');
      await tx.query(`UPDATE advice_records SET title = coalesce($2,title), body = coalesce($3,body), client_name = coalesce($4,client_name), client_email = coalesce($5,client_email), updated_at = now() WHERE id = $1`,
        [id, b.title?.trim() ?? null, b.body?.trim() ?? null, b.clientName?.trim() ?? null, b.clientEmail ?? null]);
      await audit(tx, ctx, 'advice_edited', 'box', r.box_id, { adviceId: id });
    });
    return reply.code(204).send();
  });

  app.delete('/v1/advice/:id', { schema: { params: idp } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'A signed advice record cannot be removed');
      await tx.query('DELETE FROM advice_records WHERE id = $1', [id]);
      await audit(tx, ctx, 'advice_deleted', 'box', r.box_id, { adviceId: id, kind: r.kind });
    });
    return reply.code(204).send();
  });

  // Built-in signature, step 1: fix the wording (hash it) and send a one-time code to the client.
  app.post('/v1/advice/:id/send-code', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.tier !== 'builtin') throw new HttpError(409, 'needs_vendor', 'This kind of paperwork must be signed through a certified e-signature vendor. Record the vendor signature instead.');
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'Already signed');
      if (!r.client_email) throw invalid('Add the client’s email address first');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.query(`UPDATE advice_records SET status = 'awaiting_signature', content_hash = $2, otp_hash = $3, otp_expires_at = now() + ($4 || ' minutes')::interval, otp_attempts = 0, updated_at = now() WHERE id = $1`,
        [id, contentHash(r), sha(`${code}:${id}`), String(OTP_MINUTES)]);
      await audit(tx, ctx, 'advice_code_sent', 'box', r.box_id, { adviceId: id });
      let sent = false;
      if (deps.mailer) {
        const subject = `Your confirmation code: ${code}`;
        const body = `Hello ${r.client_name},\n\nYour confirmation code for “${r.title}” is ${code}. It expires in ${OTP_MINUTES} minutes. Give it only to your advisor once you have read the document.`;
        try { await deps.mailer.send({ to: r.client_email, subject, text: body, html: `<p>${body.replace(/\n\n/g, '</p><p>')}</p>` }); sent = true; } catch { sent = false; }
      }
      return { sent, expiresInMinutes: OTP_MINUTES, ...(deps.config.appEnv === 'test' ? { devCode: code } : {}) };
    });
  });

  // Built-in signature, step 2: the client's code seals the record and files a copy on the record.
  app.post('/v1/advice/:id/confirm', { schema: { params: idp, body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const { code } = req.body as { code: string };
    const result = await run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status !== 'awaiting_signature' || !r.otp_hash || !r.otp_expires_at) throw new HttpError(409, 'not_awaiting', 'Send a code to the client first');
      if (r.otp_attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Send a new code.');
      if (new Date(r.otp_expires_at).getTime() < Date.now()) throw new HttpError(409, 'code_expired', 'That code has expired. Send a new one.');
      const good = timingSafeEqual(Buffer.from(sha(`${code}:${id}`)), Buffer.from(r.otp_hash));
      if (!good) {
        await tx.query('UPDATE advice_records SET otp_attempts = otp_attempts + 1 WHERE id = $1', [id]);
        return { ok: false as const };
      }
      const now = new Date().toISOString();
      const cert = `${r.title}\nClient: ${r.client_name} <${r.client_email}>\n\n${r.body}\n\n--- Signature record ---\nSigned by one-time code sent to ${r.client_email}\nAt: ${now}\nContent hash (SHA-256): ${r.content_hash}\nRecord: ${id}\n`;
      let documentId: string | null = null;
      if (deps.keys) {
        documentId = randomUUID();
        const data = Buffer.from(cert, 'utf8');
        const sealed = seal(deps.keys, data, `${ctx.tenantId}:doc:${documentId}`);
        await tx.query(`INSERT INTO box_documents (id, tenant_id, box_id, name, mime, size_bytes, data_enc, key_id, uploaded_by, doc_type) VALUES ($1,$2,$3,$4,'text/plain',$5,$6,$7,$8,$9)`,
          [documentId, ctx.tenantId, r.box_id, `${r.title.replace(/[^\w .-]/g, '_').slice(0, 150)} (signed).txt`, data.length, sealed.data, sealed.keyId, ctx.userId, gateTypeFor(r.kind)]);
      }
      await tx.query(`UPDATE advice_records SET status = 'signed', signed_at = $2, signed_method = 'otp', document_id = $3, otp_hash = NULL, otp_expires_at = NULL, updated_at = now() WHERE id = $1`, [id, now, documentId]);
      await audit(tx, ctx, 'advice_signed', 'box', r.box_id, { adviceId: id, method: 'otp', contentHash: r.content_hash });
      return { ok: true as const, documentId };
    });
    if (!result.ok) throw new HttpError(422, 'wrong_code', 'That code is not right');
    return result;
  });

  // Vendor tier: record that a certified third party signed it. Needs the vendor's reference and the completed document on the record.
  app.post('/v1/advice/:id/vendor-signed', {
    schema: { params: idp, body: { type: 'object', required: ['vendorName', 'vendorRef', 'documentId'], additionalProperties: false, properties: { vendorName: text(100), vendorRef: text(200), documentId: uuid } } },
  }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { vendorName: string; vendorRef: string; documentId: string };
    return run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'Already signed');
      const doc = (await tx.query('SELECT 1 FROM box_documents WHERE id = $1 AND box_id = $2', [b.documentId, r.box_id])).rowCount;
      if (!doc) throw invalid('Upload the completed, vendor-signed document to this record first');
      const g = gateTypeFor(r.kind);
      if (g) await tx.query('UPDATE box_documents SET doc_type = $2 WHERE id = $1 AND doc_type IS NULL', [b.documentId, g]);
      const now = new Date().toISOString();
      await tx.query(`UPDATE advice_records SET status = 'signed', signed_at = $2, signed_method = 'vendor', vendor_name = $3, vendor_ref = $4, document_id = $5, content_hash = $6, updated_at = now() WHERE id = $1`,
        [id, now, b.vendorName.trim(), b.vendorRef.trim(), b.documentId, contentHash(r)]);
      await audit(tx, ctx, 'advice_signed', 'box', r.box_id, { adviceId: id, method: 'vendor', vendor: b.vendorName.trim(), ref: b.vendorRef.trim() });
      return { ok: true };
    });
  });
}
