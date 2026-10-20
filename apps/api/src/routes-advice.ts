import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { SIGNING_VENDORS, VENDOR_CATALOG, vendorName, ADVICE_KINDS, ADVICE_LABELS, OTP_MAX_ATTEMPTS, OTP_MINUTES, consentStates, gateTypeFor, signingTierFor, type AdviceKind, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { ADVICE_FLAG_LABELS, NEEDS_SECTIONS, RECOMMENDATION_FIELDS, calcNeed, cleanNeeds, needsSummary, recommendationSummary, type NeedsAnswers, type RecommendationAnswers } from '@pii/domain';
import { checkLink, cleanAnswers, isStructured, missingFor, prepareForSignature, selectForReview, stampBeforeSeal } from './needs-analysis.ts';
import { sealAdvice } from './advice-seal.ts';
import type { AppDeps } from './app.ts';

interface Row {
  id: string; box_id: string; kind: AdviceKind; title: string; body: string; tier: 'builtin' | 'vendor'; status: 'draft' | 'awaiting_signature' | 'signed';
  client_name: string; client_email: string | null; content_hash: string | null; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number;
  signed_at: string | null; signed_method: string | null; vendor_name: string | null; vendor_ref: string | null; document_id: string | null; owner_node_id: string; box_name: string;
  answers: Record<string, unknown> | null; linked_advice_id: string | null;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** The fingerprint of what the client signs. Structured answers and the needs analysis a recommendation answers are part of it;
 *  records without them hash exactly as before, so older fingerprints still check out. */
export const contentHash = (r: Pick<Row, 'box_id' | 'kind' | 'title' | 'body' | 'client_name' | 'client_email'> & { answers?: Record<string, unknown> | null; linked_advice_id?: string | null }) =>
  sha(JSON.stringify({ box: r.box_id, kind: r.kind, title: r.title, body: r.body, client: r.client_name, email: r.client_email ?? '',
    ...(r.answers ? { answers: r.answers } : {}), ...(r.linked_advice_id ? { linked: r.linked_advice_id } : {}) }));
const PUBLIC = `a.id, a.box_id AS "boxId", a.kind, a.title, a.body, a.tier, a.status, a.client_name AS "clientName", a.client_email AS "clientEmail", a.content_hash AS "contentHash",
  a.signed_at AS "signedAt", a.signed_method AS "signedMethod", a.vendor_name AS "vendorName", a.vendor_ref AS "vendorRef", a.document_id AS "documentId", a.created_at AS "createdAt",
  coalesce(u.display_name, u.email::text) AS "createdBy", a.answers, a.linked_advice_id AS "linkedAdviceId", a.flags, a.valid_until::text AS "validUntil",
  (SELECT json_build_object('status', v.status, 'reason', v.reason, 'findings', v.findings, 'reviewedAt', v.reviewed_at, 'reviewer', v.reviewer_name)
     FROM advice_reviews v WHERE v.advice_id = a.id ORDER BY v.created_at DESC LIMIT 1) AS review`;
const FORM = {
  needs: NEEDS_SECTIONS, recommendation: RECOMMENDATION_FIELDS,
  flags: ADVICE_FLAG_LABELS,
};

/** Lock an advice record as signed by a certified vendor, with the vendor's reference and the completed document. Runs inside the caller's transaction. */
export async function recordVendorSigned(tx: Tx, ctx: RequestContext, r: Pick<Row, 'id' | 'box_id' | 'kind' | 'title' | 'body' | 'client_name' | 'client_email'> & { answers?: Record<string, unknown> | null; linked_advice_id?: string | null }, v: { vendorId: string | null; label: string; ref: string; documentId: string }): Promise<void> {
  const g = gateTypeFor(r.kind);
  if (g) await tx.query('UPDATE box_documents SET doc_type = $2 WHERE id = $1 AND doc_type IS NULL', [v.documentId, g]);
  const at = new Date();
  await stampBeforeSeal(tx, r.id, at);
  const now = at.toISOString();
  await tx.query(`UPDATE advice_records SET status = 'signed', signed_at = $2, signed_method = 'vendor', vendor_name = $3, vendor_ref = $4, document_id = $5, content_hash = $6, vendor_id = $7, updated_at = now() WHERE id = $1`,
    [r.id, now, v.label, v.ref, v.documentId, contentHash(r), v.vendorId]);
  await audit(tx, ctx, 'advice_signed', 'box', r.box_id, { adviceId: r.id, method: 'vendor', vendor: v.label, ref: v.ref });
  await selectForReview(tx, ctx, r.id);
}

/** Advice records: the brokerage's own system of record for advice given, with a built-in one-time-code signature or a record of a vendor signature. */
export function registerAdviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const kindEnum = { enum: [...ADVICE_KINDS] } as const;
  const text = (max: number, min = 1) => ({ type: 'string', minLength: min, maxLength: max }) as const;
  const answersSchema = { type: 'object', maxProperties: 80 } as const;
  const summaryOf = (kind: AdviceKind, a: Record<string, unknown>) => kind === 'needs_analysis' ? needsSummary(a as unknown as NeedsAnswers) : recommendationSummary(a as RecommendationAnswers);

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
      const rows = (await tx.query<{ kind: AdviceKind; answers: Record<string, unknown> | null }>(`SELECT ${PUBLIC} FROM advice_records a LEFT JOIN app_users u ON u.id = a.created_by WHERE a.box_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [id])).rows;
      const advice = rows.map((r) => ({
        ...r, structured: isStructured(r.kind), missing: missingFor(r.kind, r.answers),
        ...(r.kind === 'needs_analysis' && r.answers ? { calc: calcNeed(cleanNeeds(r.answers)) } : {}),
      }));
      return { advice, kinds: ADVICE_KINDS.map((k) => ({ kind: k, tier: signingTierFor(k), label: ADVICE_LABELS[k], structured: isStructured(k) })), form: FORM };
    });
  });

  app.post('/v1/boxes/:id/advice', {
    schema: { params: idp, body: { type: 'object', required: ['kind', 'title', 'clientName'], additionalProperties: false, properties: { kind: kindEnum, title: text(200), body: text(20000), clientName: text(200), clientEmail: { type: 'string', format: 'email', maxLength: 200 }, answers: answersSchema, linkedAdviceId: uuid } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { kind: AdviceKind; title: string; body?: string; clientName: string; clientEmail?: string; answers?: unknown; linkedAdviceId?: string };
    const answers = cleanAnswers(b.kind, b.answers ?? {});
    const body = b.body?.trim() || (answers ? summaryOf(b.kind, answers) : '');
    if (!body) throw invalid('Write what you advised and why');
    const out = await run(ctx, async (tx) => {
      const bx = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!bx) throw notFound('Record not found');
      requireEdit(ctx, bx.owner_node_id);
      await checkLink(tx, b.kind, id, b.linkedAdviceId);
      const r = await tx.query<{ id: string }>(
        `INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, client_name, client_email, created_by, answers, linked_advice_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [ctx.tenantId, id, b.kind, b.title.trim(), body, signingTierFor(b.kind), b.clientName.trim(), b.clientEmail ?? null, ctx.userId, answers ? JSON.stringify(answers) : null, b.linkedAdviceId ?? null]);
      await audit(tx, ctx, 'advice_created', 'box', id, { adviceId: r.rows[0]!.id, kind: b.kind });
      return { id: r.rows[0]!.id, tier: signingTierFor(b.kind) };
    });
    return reply.code(201).send(out);
  });

  // Drafts can be edited; once a code has been sent or the record is signed, the wording is fixed.
  app.patch('/v1/advice/:id', {
    schema: { params: idp, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { title: text(200), body: text(20000), clientName: text(200), clientEmail: { type: 'string', format: 'email', maxLength: 200 }, answers: answersSchema, linkedAdviceId: uuid } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { title?: string; body?: string; clientName?: string; clientEmail?: string; answers?: unknown; linkedAdviceId?: string };
    await run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status !== 'draft') throw new HttpError(409, 'advice_locked', 'This record has been sent for signature or signed, so its wording is fixed. Create a new one to change it.');
      if (b.linkedAdviceId) await checkLink(tx, r.kind, r.box_id, b.linkedAdviceId);
      const answers = b.answers !== undefined ? cleanAnswers(r.kind, b.answers) : null;
      // A structured record's summary follows its answers unless the advisor wrote their own.
      const body = b.body?.trim() ?? (answers && r.body === summaryOf(r.kind, r.answers ?? {}) ? summaryOf(r.kind, answers) : null);
      await tx.query(`UPDATE advice_records SET title = coalesce($2,title), body = coalesce($3,body), client_name = coalesce($4,client_name), client_email = coalesce($5,client_email),
          answers = coalesce($6::jsonb, answers), linked_advice_id = coalesce($7, linked_advice_id), updated_at = now() WHERE id = $1`,
        [id, b.title?.trim() ?? null, body, b.clientName?.trim() ?? null, b.clientEmail ?? null, answers ? JSON.stringify(answers) : null, b.linkedAdviceId ?? null]);
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
      await prepareForSignature(tx, r);
      const cs = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>(`SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 AND kind = 'electronic_comms' ORDER BY created_at`, [r.box_id])).rows;
      if (consentStates(cs).withdrawn.includes('electronic_comms')) throw new HttpError(409, 'comms_withdrawn', 'This client has withdrawn consent to electronic messages. Do not email them; sign in person or by a vendor instead.');
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
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
      const { documentId } = await sealAdvice(tx, ctx, deps.keys, { adviceId: id, boxId: r.box_id, kind: r.kind, title: r.title, body: r.body, clientName: r.client_name, clientEmail: r.client_email, contentHash: r.content_hash!, firm, method: 'otp', typedName: null, ip: req.ip, agent: String(req.headers['user-agent'] ?? ''), signer: 'advisor' });
      return { ok: true as const, documentId };
    });
    if (!result.ok) throw new HttpError(422, 'wrong_code', 'That code is not right');
    return result;
  });

  // Vendor tier: record that a certified third party signed it. Needs the vendor's reference and the completed document on the record.
  app.post('/v1/advice/:id/vendor-signed', {
    schema: { params: idp, body: { type: 'object', required: ['vendorRef', 'documentId'], additionalProperties: false, properties: { vendorId: { enum: [...SIGNING_VENDORS] }, vendorName: text(100), vendorRef: text(200), documentId: uuid } } },
  }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { vendorId?: string; vendorName?: string; vendorRef: string; documentId: string };
    const label = (b.vendorId && b.vendorId !== 'other' ? vendorName(b.vendorId) : b.vendorName?.trim()) ?? '';
    if (!label) throw invalid('Say which vendor signed it');
    return run(ctx, async (tx) => {
      const r = await load(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'Already signed');
      if (b.vendorId) {
        const rows = (await tx.query<{ vendor: string; enabled: boolean }>('SELECT vendor, enabled FROM signing_vendors')).rows;
        if (rows.some((v) => v.enabled) && !rows.some((v) => v.vendor === b.vendorId && v.enabled)) throw invalid('That vendor is not turned on for your company');
      }
      await prepareForSignature(tx, r);
      const doc = (await tx.query('SELECT 1 FROM box_documents WHERE id = $1 AND box_id = $2', [b.documentId, r.box_id])).rowCount;
      if (!doc) throw invalid('Upload the completed, vendor-signed document to this record first');
      await recordVendorSigned(tx, ctx, r, { vendorId: b.vendorId ?? null, label, ref: b.vendorRef.trim(), documentId: b.documentId });
      return { ok: true };
    });
  });

  // The e-signature vendor catalogue and which ones this company has turned on. Everyone who records a signature reads it; administrators and compliance change it.
  app.get('/v1/compliance/signing-vendors', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ vendor: string; enabled: boolean; note: string | null }>('SELECT vendor, enabled, note FROM signing_vendors')).rows;
      const anySet = rows.some((r) => r.enabled);
      const adobe = !!(await tx.query(`SELECT 1 FROM esign_connections WHERE vendor = 'adobe_sign'`)).rowCount;
      const live = new Set(['adobe_sign']);
      return { vendors: VENDOR_CATALOG.map((v) => ({ ...v, live: live.has(v.id), connected: v.id === 'adobe_sign' ? adobe : v.connected, enabled: anySet ? !!rows.find((r) => r.vendor === v.id)?.enabled : true, note2: rows.find((r) => r.vendor === v.id)?.note ?? null })), restricted: anySet, canManage: canWaive(ctx) };
    });
  });
  app.put('/v1/compliance/signing-vendors/:vendor', {
    schema: { params: { type: 'object', properties: { vendor: { enum: [...SIGNING_VENDORS] } } }, body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' }, note: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can choose signing vendors');
    const { vendor } = req.params as { vendor: string };
    const b = req.body as { enabled: boolean; note?: string };
    await run(ctx, async (tx) => {
      const who = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      await tx.query(`INSERT INTO signing_vendors (tenant_id, vendor, enabled, note, set_by_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, vendor) DO UPDATE SET enabled = EXCLUDED.enabled, note = EXCLUDED.note, set_by_name = EXCLUDED.set_by_name, updated_at = now()`,
        [ctx.tenantId, vendor, b.enabled, b.note?.trim() || null, who]);
      await audit(tx, ctx, 'signing_vendor_set', 'vendor', null, { vendor, enabled: b.enabled });
    });
    return reply.code(204).send();
  });
}
