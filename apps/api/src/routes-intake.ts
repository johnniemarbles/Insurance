// Client self-intake (roadmap Phase 2, feature 6). Switch: INTAKE_ENABLED (404 when off).
//
// The advisor makes a private link for one client on a deal and chooses what to ask. The client opens it, fills it
// in (it saves as they go), uploads documents, gives consents, can start the electronic ID check, and submits with a
// 6-digit code sent to the email on file plus their typed name. The client's consents are recorded when they submit
// (channel "esign"); their documents go onto the deal. Their answers change nothing until the advisor reviews them and
// applies them: contact details are updated and a draft needs analysis is prefilled for the advisor to finish.
// The client side acts as the advisor who sent the link (like the signing page), never with more access.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { CONSENT_WORDING, OBJECTIVES, OTP_MAX_ATTEMPTS, OTP_MINUTES, OBJECTIVE_LABELS, WORDING_VERSION, consentStates, type RequestContext } from '@pii/domain';
import { seal } from '@pii/platform';
import { audit } from './audit.ts';
import { actingAs } from './effects.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { cleanName } from './routes-documents.ts';
import { cleanAnswers } from './needs-analysis.ts';
import { startStripeCheck } from './routes-eid.ts';
import { eidEnabled } from './eid.ts';
import { INTAKE_CONSENTS, SECTIONS, cleanIntake, contactChanges, intakeEnabled, missingForSubmit, needsDraftFrom } from './intake.ts';
import type { AppDeps } from './app.ts';

const LINK_DAYS = 14;
const MAX_SENDS = 5;
const DOC_TYPES: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/heic': ['heic'], 'image/webp': ['webp'] };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tokenHash = (t: string) => createHash('sha256').update(t).digest();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '');

interface Link { id: string; tenant_id: string; intake_id: string; created_by: string; node_id: string; expires_at: Date; otp_hash: string | null; otp_expires_at: Date | null; otp_attempts: number; sends: number; used_at: Date | null }
interface Intake { id: string; box_id: string; contact_id: string; sections: string[]; status: string; answers: Record<string, unknown>; document_ids: string[]; consents: string[]; sent_by_name: string; expires_at: Date }

export function registerIntakeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const tokenP = { type: 'object', properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{20,80}$' } } } as const;
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const actor = (l: Link): RequestContext => ({ ...actingAs(l.tenant_id, l.created_by, l.node_id), isTenantAdmin: true });
  const on = () => { if (!intakeEnabled()) throw notFound('Not found'); };
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => { on(); const i = await deps.authenticate(req); requireCrm(i.ctx); return i; };
  const nameOf = async (tx: Tx, userId: string) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [userId])).rows[0]?.n ?? '';

  async function linkFor(token: string): Promise<Link> {
    on();
    const l = (await deps.authPool.query<Link>('SELECT * FROM intake_links WHERE token_hash = $1', [tokenHash(token)])).rows[0];
    if (!l || l.used_at || l.expires_at.getTime() < Date.now()) throw notFound('This link is not valid any more. Ask your advisor for a new one.');
    return l;
  }
  async function intakeOf(tx: Tx, id: string, forClient = true): Promise<Intake> {
    const r = (await tx.query<Intake>('SELECT id, box_id, contact_id, sections, status, answers, document_ids, consents, sent_by_name, expires_at FROM client_intakes WHERE id = $1', [id])).rows[0];
    if (!r) throw notFound('Not found');
    if (forClient && !['sent', 'in_progress'].includes(r.status)) throw new HttpError(409, 'intake_closed', r.status === 'canceled' ? 'This link was cancelled. Ask your advisor for a new one.' : 'Thank you, your answers have been sent to your advisor.');
    return r;
  }
  const commsWithdrawn = async (tx: Tx, boxId: string) => {
    const cs = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>(`SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 AND kind = 'electronic_comms' ORDER BY created_at`, [boxId])).rows;
    return consentStates(cs).withdrawn.includes('electronic_comms');
  };

  // ---------------------------------------------------------------- the advisor's side
  app.get('/v1/boxes/:id/intakes', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM boxes WHERE id = $1', [id])).rowCount) throw notFound('Deal not found');
      const clients = (await tx.query(`SELECT c.id, coalesce(c.full_name, c.email::text, '') AS name, c.email IS NOT NULL AS "hasEmail" FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 ORDER BY 2`, [id])).rows;
      const intakes = (await tx.query(
        `SELECT i.id, i.contact_id AS "contactId", coalesce(c.full_name, '') AS "clientName", i.sections, i.status, i.sent_by_name AS "sentBy", i.created_at AS "createdAt", i.expires_at AS "expiresAt",
                i.expires_at < now() AND i.status IN ('sent','in_progress') AS expired, i.opened_at AS "openedAt", i.submitted_at AS "submittedAt", i.applied_at AS "appliedAt", i.applied_by_name AS "appliedBy"
           FROM client_intakes i JOIN contacts c ON c.id = i.contact_id WHERE i.box_id = $1 ORDER BY i.created_at DESC LIMIT 30`, [id])).rows;
      const eid = eidEnabled() && !!deps.stripeIdentity && !!(await tx.query('SELECT 1 FROM tenant_eid WHERE stripe_enabled')).rowCount;
      return { clients, intakes, idCheckAvailable: eid };
    });
  });

  app.post('/v1/boxes/:id/intakes', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['contactId', 'sections'], properties: {
      contactId: uuid, sections: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { enum: [...SECTIONS] } } } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { contactId: string; sections: string[] };
    const sections = [...new Set(['about', ...b.sections])];
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
    const info = await run(ctx, async (tx) => {
      const bx = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!bx) throw notFound('Deal not found');
      requireEdit(ctx, bx.owner_node_id);
      const c = (await tx.query<{ full_name: string | null; email: string | null }>('SELECT c.full_name, c.email::text AS email FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 AND bc.contact_id = $2', [id, b.contactId])).rows[0];
      if (!c) throw invalid('Choose a client on this deal');
      if (!c.email) throw invalid('Add the client\'s email address first: they confirm with a code sent there');
      // One open link per client per deal: a new one replaces the old.
      const old = (await tx.query<{ id: string }>(`UPDATE client_intakes SET status = 'canceled' WHERE box_id = $1 AND contact_id = $2 AND status IN ('sent','in_progress') RETURNING id`, [id, b.contactId])).rows.map((r) => r.id);
      const me = await nameOf(tx, ctx.userId);
      const r = (await tx.query<{ id: string }>(`INSERT INTO client_intakes (tenant_id, box_id, contact_id, sections, status, sent_by, sent_by_name, expires_at) VALUES ($1,$2,$3,$4,'sent',$5,$6,$7) RETURNING id`,
        [ctx.tenantId, id, b.contactId, sections, ctx.userId, me, expires])).rows[0]!;
      await audit(tx, ctx, 'intake_sent', 'box', id, { intake: r.id, sections }, bx.owner_node_id);
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
      return { intakeId: r.id, old, c, me, firm, canEmail: !(await commsWithdrawn(tx, id)) };
    });
    if (info.old.length) await deps.authPool.query('DELETE FROM intake_links WHERE intake_id = ANY($1) AND used_at IS NULL', [info.old]);
    const token = randomBytes(24).toString('base64url');
    await deps.authPool.query('INSERT INTO intake_links (tenant_id, intake_id, created_by, node_id, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [ctx.tenantId, info.intakeId, ctx.userId, ctx.nodeIds[0], tokenHash(token), expires]);
    const url = `${deps.config.appOrigin}/intake/${token}`;
    let emailed = false;
    if (deps.mailer && info.canEmail) {
      const first = (info.c.full_name ?? '').split(' ')[0] || 'there';
      const text = `Hello ${first},\n\n${info.me} at ${info.firm} has asked you to fill in a short form before your next meeting: your details, your situation and your goals. It saves as you go.\n${url}\n\nThe link works for ${LINK_DAYS} days. If you were not expecting this, ignore this email.`;
      try { await deps.mailer.send({ to: info.c.email!, subject: `${info.firm}: a few questions before we meet`, text, html: `<p>${esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>` }); emailed = true; } catch { emailed = false; }
    }
    return reply.code(201).send({ id: info.intakeId, url, emailed, emailBlocked: !info.canEmail, expiresAt: expires.toISOString() });
  });

  app.get('/v1/intakes/:id', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const i = await intakeOf(tx, id, false);
      const c = (await tx.query<{ full_name: string | null; phone: string | null; date_of_birth: string | null; preferred_language: string | null }>('SELECT full_name, phone, date_of_birth::text AS date_of_birth, preferred_language FROM contacts WHERE id = $1', [i.contact_id])).rows[0]!;
      const a = cleanIntake(i.answers, i.sections);
      const docs = i.document_ids.length ? (await tx.query('SELECT id, name, mime, size_bytes AS "sizeBytes" FROM box_documents WHERE id = ANY($1)', [i.document_ids])).rows : [];
      const t = (await tx.query<{ typed_name: string | null; submitted_at: string | null }>('SELECT typed_name, submitted_at FROM client_intakes WHERE id = $1', [id])).rows[0]!;
      return { id: i.id, status: i.status, sections: i.sections, answers: a, consents: i.consents, documents: docs, typedName: t.typed_name, submittedAt: t.submitted_at,
        contactChanges: contactChanges(a, c), canApply: i.status === 'submitted' };
    });
  });

  app.post('/v1/intakes/:id/apply', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['updateContact', 'createNeedsDraft'], properties: { updateContact: { type: 'boolean' }, createNeedsDraft: { type: 'boolean' } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { updateContact: boolean; createNeedsDraft: boolean };
    return run(ctx, async (tx) => {
      const i = await intakeOf(tx, id, false);
      const bx = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [i.box_id])).rows[0]!;
      requireEdit(ctx, bx.owner_node_id);
      if (i.status !== 'submitted') throw invalid('Only a submitted intake can be applied');
      const a = cleanIntake(i.answers, i.sections);
      const c = (await tx.query<{ full_name: string | null; email: string | null; phone: string | null; date_of_birth: string | null; preferred_language: string | null }>(
        'SELECT full_name, email::text AS email, phone, date_of_birth::text AS date_of_birth, preferred_language FROM contacts WHERE id = $1', [i.contact_id])).rows[0]!;
      const changes = b.updateContact ? contactChanges(a, c) : [];
      for (const ch of changes) {
        const col = ch.field === 'phone' ? 'phone' : ch.field === 'dateOfBirth' ? 'date_of_birth' : 'preferred_language';
        await tx.query(`UPDATE contacts SET ${col} = $2 WHERE id = $1`, [i.contact_id, ch.to]);
      }
      let naId: string | null = null;
      if (b.createNeedsDraft && i.sections.includes('situation')) {
        const answers = cleanAnswers('needs_analysis', needsDraftFrom(a));
        const body = `Prefilled from ${c.full_name ?? 'the client'}'s online intake, submitted ${new Date().toISOString().slice(0, 10)}. Go through every answer with the client and complete the rest before it is signed.`;
        naId = (await tx.query<{ id: string }>(`INSERT INTO advice_records (tenant_id, box_id, kind, title, body, tier, client_name, client_email, created_by, answers) VALUES ($1,$2,'needs_analysis',$3,$4,'builtin',$5,$6,$7,$8) RETURNING id`,
          [ctx.tenantId, i.box_id, 'Needs analysis (from the client\'s intake)', body, c.full_name ?? (a.about.legalName as string), c.email, ctx.userId, JSON.stringify(answers)])).rows[0]!.id;
      }
      const me = await nameOf(tx, ctx.userId);
      await tx.query(`UPDATE client_intakes SET status = 'applied', applied_at = now(), applied_by_name = $2, needs_analysis_id = $3 WHERE id = $1`, [id, me, naId]);
      await audit(tx, ctx, 'intake_applied', 'box', i.box_id, { intake: id, contactFields: changes.map((x) => x.field), needsDraft: !!naId }, bx.owner_node_id);
      return { status: 'applied', contactFields: changes.map((x) => x.field), needsAnalysisId: naId };
    });
  });

  app.post('/v1/intakes/:id/cancel', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const i = await intakeOf(tx, id, false);
      const bx = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [i.box_id])).rows[0]!;
      requireEdit(ctx, bx.owner_node_id);
      if (!['sent', 'in_progress'].includes(i.status)) throw invalid('Only an open intake can be cancelled');
      await tx.query(`UPDATE client_intakes SET status = 'canceled' WHERE id = $1`, [id]);
      await audit(tx, ctx, 'intake_canceled', 'box', i.box_id, { intake: id }, bx.owner_node_id);
    });
    await deps.authPool.query('DELETE FROM intake_links WHERE intake_id = $1 AND used_at IS NULL', [id]);
    return { status: 'canceled' };
  });

  // ---------------------------------------------------------------- the client's side
  app.get('/intake/:token', { schema: { params: tokenP } }, async (_req, reply) => {
    on();
    const nonce = randomBytes(12).toString('base64');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' blob:; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
      .send(intakePage(nonce));
  });

  app.get('/v1/public/intake/:token', { schema: { params: tokenP } }, async (req) => {
    const l = await linkFor((req.params as { token: string }).token);
    return run(actor(l), async (tx) => {
      const i = await intakeOf(tx, l.intake_id);
      const c = (await tx.query<{ full_name: string | null; email: string | null }>('SELECT full_name, email::text AS email FROM contacts WHERE id = $1', [i.contact_id])).rows[0]!;
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [l.tenant_id])).rows[0]?.name ?? '';
      if (i.status === 'sent') {
        await tx.query(`UPDATE client_intakes SET opened_at = coalesce(opened_at, now()) WHERE id = $1`, [i.id]);
      }
      const docs = i.document_ids.length ? (await tx.query('SELECT id, name FROM box_documents WHERE id = ANY($1)', [i.document_ids])).rows : [];
      const idc = i.sections.includes('id_check') ? (await tx.query<{ status: string }>(`SELECT status FROM id_verifications WHERE box_id = $1 AND contact_id = $2 ORDER BY created_at DESC LIMIT 1`, [i.box_id, i.contact_id])).rows[0]?.status ?? null : null;
      return {
        firm, advisor: i.sent_by_name, firstName: (c.full_name ?? '').split(' ')[0] ?? '', sections: i.sections, answers: cleanIntake(i.answers, i.sections), consents: i.consents,
        consentKinds: INTAKE_CONSENTS.map((k) => ({ kind: k, en: CONSENT_WORDING[k].en, fr: CONSENT_WORDING[k]['fr-CA'], required: k === 'collection_use' })),
        objectives: OBJECTIVES.map((o) => ({ value: o, en: OBJECTIVE_LABELS[o].en, fr: OBJECTIVE_LABELS[o]['fr-CA'] })),
        documents: docs, idCheck: idc, emailHint: mask(c.email), minutes: OTP_MINUTES, expiresAt: i.expires_at,
      };
    });
  });

  app.post('/v1/public/intake/:token/save', {
    bodyLimit: 64 * 1024,
    schema: { params: tokenP, body: { type: 'object', additionalProperties: false, required: ['answers'], properties: { answers: { type: 'object' }, consents: { type: 'array', maxItems: 3, items: { enum: [...INTAKE_CONSENTS] } } } } },
  }, async (req) => {
    const l = await linkFor((req.params as { token: string }).token);
    const b = req.body as { answers: unknown; consents?: string[] };
    return run(actor(l), async (tx) => {
      const i = await intakeOf(tx, l.intake_id);
      const a = cleanIntake(b.answers, i.sections);
      const consents = i.sections.includes('consents') ? [...new Set(b.consents ?? [])] : [];
      await tx.query(`UPDATE client_intakes SET answers = $2, consents = $3, status = 'in_progress' WHERE id = $1`, [i.id, JSON.stringify(a), consents]);
      return { saved: true, missing: missingForSubmit(a, i.sections, consents) };
    });
  });

  app.post('/v1/public/intake/:token/document', {
    bodyLimit: 14 * 1024 * 1024,
    schema: { params: tokenP, body: { type: 'object', additionalProperties: false, required: ['name', 'mime', 'dataBase64'], properties: { name: { type: 'string', minLength: 1, maxLength: 300 }, mime: { type: 'string', maxLength: 100 }, dataBase64: { type: 'string', minLength: 4, maxLength: 12 * 1024 * 1024 } } } },
  }, async (req, reply) => {
    const l = await linkFor((req.params as { token: string }).token);
    if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Uploads are not available right now. Bring the document to your meeting instead.');
    const b = req.body as { name: string; mime: string; dataBase64: string };
    const name = cleanName(b.name), ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (!DOC_TYPES[b.mime] || !DOC_TYPES[b.mime]!.includes(ext)) throw invalid('Upload a PDF or a photo (JPEG, PNG, HEIC or WebP)');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.dataBase64)) throw invalid('The file could not be read');
    const data = Buffer.from(b.dataBase64, 'base64');
    if (!data.length || data.length > 8 * 1024 * 1024) throw invalid('Files can be up to 8 MB');
    const ctx = actor(l);
    const out = await run(ctx, async (tx) => {
      const i = await intakeOf(tx, l.intake_id);
      if (!i.sections.includes('documents')) throw invalid('This form does not take documents');
      if (i.document_ids.length >= 8) throw invalid('You can upload up to 8 files. Bring anything else to your meeting.');
      const docId = randomUUID();
      const sealed = seal(deps.keys!, data, `${ctx.tenantId}:doc:${docId}`);
      await tx.query(`INSERT INTO box_documents (id, tenant_id, box_id, name, mime, size_bytes, data_enc, key_id, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [docId, ctx.tenantId, i.box_id, `Client upload - ${name}`.slice(0, 200), b.mime, data.length, sealed.data, sealed.keyId, ctx.userId]);
      await tx.query(`UPDATE client_intakes SET document_ids = array_append(document_ids, $2::uuid), status = 'in_progress' WHERE id = $1`, [i.id, docId]);
      await audit(tx, ctx, 'intake_document_added', 'box', i.box_id, { intake: i.id, documentId: docId, size: data.length });
      return { id: docId, name: `Client upload - ${name}` };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/public/intake/:token/id-check', { schema: { params: tokenP } }, async (req) => {
    const l = await linkFor((req.params as { token: string }).token);
    const ctx = actor(l);
    const i = await run(ctx, (tx) => intakeOf(tx, l.intake_id));
    if (!i.sections.includes('id_check') || !eidEnabled()) throw invalid('This form does not include an ID check');
    return startStripeCheck(deps, ctx, i.box_id, i.contact_id, req.log, { skipEditCheck: true });
  });

  app.post('/v1/public/intake/:token/code', { schema: { params: tokenP } }, async (req) => {
    const l = await linkFor((req.params as { token: string }).token);
    if (l.sends >= MAX_SENDS) throw new HttpError(429, 'too_many_codes', 'Too many codes were sent. Ask your advisor for a new link.');
    const info = await run(actor(l), async (tx) => {
      const i = await intakeOf(tx, l.intake_id);
      const missing = missingForSubmit(cleanIntake(i.answers, i.sections), i.sections, i.consents);
      if (missing.length) throw new HttpError(422, 'incomplete', 'Fill in the required answers first.');
      return (await tx.query<{ email: string | null; title: string }>(`SELECT c.email::text AS email, t.name AS title FROM contacts c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = $1`, [i.contact_id])).rows[0]!;
    });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deps.authPool.query(`UPDATE intake_links SET otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, sends = sends + 1 WHERE id = $1`, [l.id, sha(`${code}:${l.id}`), String(OTP_MINUTES)]);
    let sent = false;
    if (deps.mailer && info.email) {
      const text = `Your confirmation code for ${info.title} is ${code}. It expires in ${OTP_MINUTES} minutes. Enter it on the form only.`;
      try { await deps.mailer.send({ to: info.email, subject: `Your confirmation code: ${code}`, text, html: `<p>${esc(text)}</p>` }); sent = true; } catch { sent = false; }
    }
    return { sent, minutes: OTP_MINUTES, ...(deps.config.appEnv === 'test' || (deps.config.appEnv === 'dev' && !deps.mailer) ? { devCode: code } : {}) };
  });

  app.post('/v1/public/intake/:token/submit', {
    schema: { params: tokenP, body: { type: 'object', additionalProperties: false, required: ['code', 'typedName', 'agree'], properties: { code: { type: 'string', pattern: '^[0-9]{6}$' }, typedName: { type: 'string', minLength: 2, maxLength: 200 }, agree: { const: true } } } },
  }, async (req) => {
    const l = await linkFor((req.params as { token: string }).token);
    const b = req.body as { code: string; typedName: string };
    if (!l.otp_hash || !l.otp_expires_at) throw new HttpError(409, 'not_awaiting', 'Ask for a code first.');
    if (l.otp_attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new code.');
    if (l.otp_expires_at.getTime() < Date.now()) throw new HttpError(409, 'code_expired', 'That code has expired. Ask for a new one.');
    if (!timingSafeEqual(Buffer.from(sha(`${b.code}:${l.id}`)), Buffer.from(l.otp_hash))) {
      await deps.authPool.query('UPDATE intake_links SET otp_attempts = otp_attempts + 1 WHERE id = $1', [l.id]);
      throw new HttpError(422, 'wrong_code', 'That code is not right.');
    }
    const ctx = actor(l);
    const done = await run(ctx, async (tx) => {
      const i = await intakeOf(tx, l.intake_id);
      if (missingForSubmit(cleanIntake(i.answers, i.sections), i.sections, i.consents).length) throw new HttpError(422, 'incomplete', 'Fill in the required answers first.');
      const typed = b.typedName.trim();
      await tx.query(`UPDATE client_intakes SET status = 'submitted', submitted_at = now(), typed_name = $2, signer_ip = $3, signer_agent = $4 WHERE id = $1`,
        [i.id, typed, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 400)]);
      for (const k of i.consents) {
        await tx.query(`INSERT INTO client_consents (tenant_id, box_id, kind, wording_version, channel, granted_on, recorded_by, recorded_by_name, note) VALUES ($1,$2,$3,$4,'esign',current_date,$5,$6,$7)`,
          [ctx.tenantId, i.box_id, k, WORDING_VERSION, ctx.userId, `Client online intake (sent by ${i.sent_by_name})`, `Given by the client in the online intake, confirmed with an email code and typed name "${typed.slice(0, 120)}".`]);
      }
      await audit(tx, ctx, 'intake_submitted', 'box', i.box_id, { intake: i.id, consents: i.consents, documents: i.document_ids.length });
      const adv = (await tx.query<{ email: string; name: string }>(`SELECT u.email::text AS email, b.name FROM app_users u, boxes b WHERE u.id = $1 AND b.id = $2`, [l.created_by, i.box_id])).rows[0];
      return { adv };
    });
    await deps.authPool.query('UPDATE intake_links SET used_at = now(), otp_hash = NULL WHERE id = $1', [l.id]);
    if (deps.mailer && done.adv) {
      const text = `Your client has submitted their intake for “${done.adv.name}”. Review their answers on the deal in PII, then apply them to the file.`;
      void deps.mailer.send({ to: done.adv.email, subject: `Client intake submitted: ${done.adv.name}`, text, html: `<p>${esc(text)}</p>` }).catch(() => undefined);
    }
    return { ok: true };
  });
}

/** The client's page: plain HTML and a small script, no outside resources, works on a phone. English and French. */
export function intakePage(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Before we meet</title>
<style>body{margin:0;background:#f3f4f6;font:16px/1.55 system-ui,sans-serif;color:#1f2937}main{max-width:720px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:12px;padding:18px 20px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:0 0 8px}.firm{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text],input[type=date],input[type=tel],input[type=number],select,textarea{width:100%;box-sizing:border-box;padding:10px;font:inherit;border:1px solid #9ca3af;border-radius:8px;background:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}@media(max-width:520px){.row{grid-template-columns:1fr}}.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:10px 0}.chk input{margin-top:4px;width:18px;height:18px;flex:none}
button{font:600 16px system-ui;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:11px 18px;cursor:pointer;margin-top:14px}button.q{background:#e5e7eb;color:#1f2937}button:disabled{opacity:.5;cursor:default}
.err{color:#b3261e;font-weight:600;margin-top:10px}.ok{color:#137333;font-weight:700}.muted{color:#6b7280;font-size:14px}.lang{float:right;background:none;color:#1d4ed8;margin:0;padding:0;font-size:14px}.req{color:#b3261e}ul.docs{padding-left:18px}</style></head><body><main>
<div class="card" id="head"><div class="muted" id="loading">…</div></div><div id="body"></div></main>
<script nonce="${nonce}">
(function(){
var T={en:{lang:'Français',hello:'Hello',intro:' has asked you to answer a few questions before your meeting. Your answers save as you go. Nothing changes on your file until your advisor reviews them with you.',
about:'About you',legalName:'Full legal name',dateOfBirth:'Date of birth',phone:'Phone',address:'Street address',city:'City',province:'Province',postalCode:'Postal code',occupation:'Occupation',employer:'Employer',preferredLanguage:'Preferred language',
situation:'Your situation',maritalStatus:'Marital status',dependants:'People who depend on you',annualIncome:'Your yearly income ($)',spouseIncome:'Spouse\\'s yearly income ($)',monthlyExpenses:'Household spending per month ($)',liquidAssets:'Savings and investments ($)',mortgage:'Mortgage owing ($)',otherDebts:'Other debts ($)',existingIndividual:'Life insurance you own ($)',existingGroup:'Life insurance through work ($)',existingPolicies:'Policies you have (company, type)',replacing:'Are you thinking of replacing a policy you have?',replacingNote:'Which one, and why?',objectives:'What would you like help with?',objectivesNote:'Anything else we should know',monthlyBudget:'Monthly budget for insurance ($)',
consents:'Your consent',consentsHelp:'Tick what you agree to. You can withdraw at any time by telling your advisor.',documents:'Documents',documentsHelp:'Optional: statements, policies, or anything your advisor asked for. PDF or photos, up to 8 MB each.',upload:'Add a file',idc:'Check your ID',idcHelp:'Photograph your driver\\'s licence and take a selfie on Stripe\\'s secure page. Your advisor sees only whether it matched.',idcGo:'Start the ID check',idcDone:'ID check started. You can finish it now or later.',
choose:'Choose…',yes:'Yes',no:'No',other:'Other',save:'Save for later',saved:'Saved',submit:'Send to my advisor',submitHelp:'We will send a 6-digit code to your email (',code:'6-digit code',name:'Type your full name',agree:'My answers are true and complete to the best of my knowledge.',send:'Send me a code',sent:'A code was sent. It works for ',min:' minutes.',dev:'(test code: ',done:'Thank you. Your answers have been sent to your advisor. You can close this page.',need:'Please fill in the fields marked *.',gone:'This link is not valid any more.',fail:'Something went wrong. Please try again.',
ms:{single:'Single',married:'Married',common_law:'Common-law',separated:'Separated',divorced:'Divorced',widowed:'Widowed'},pl:{en:'English',fr:'French',pa:'Punjabi',hi:'Hindi',other:'Other'}},
fr:{lang:'English',hello:'Bonjour',intro:' vous demande de répondre à quelques questions avant votre rencontre. Vos réponses sont enregistrées au fur et à mesure. Rien ne change à votre dossier avant que votre conseiller les revoie avec vous.',
about:'À propos de vous',legalName:'Nom légal complet',dateOfBirth:'Date de naissance',phone:'Téléphone',address:'Adresse',city:'Ville',province:'Province',postalCode:'Code postal',occupation:'Profession',employer:'Employeur',preferredLanguage:'Langue préférée',
situation:'Votre situation',maritalStatus:'État civil',dependants:'Personnes à votre charge',annualIncome:'Votre revenu annuel ($)',spouseIncome:'Revenu annuel du conjoint ($)',monthlyExpenses:'Dépenses du ménage par mois ($)',liquidAssets:'Épargne et placements ($)',mortgage:'Solde hypothécaire ($)',otherDebts:'Autres dettes ($)',existingIndividual:'Assurance vie personnelle ($)',existingGroup:'Assurance vie collective ($)',existingPolicies:'Vos polices (assureur, type)',replacing:'Pensez-vous remplacer une police existante?',replacingNote:'Laquelle, et pourquoi?',objectives:'Pour quoi souhaitez-vous de l’aide?',objectivesNote:'Autre chose à savoir',monthlyBudget:'Budget mensuel pour l’assurance ($)',
consents:'Votre consentement',consentsHelp:'Cochez ce que vous acceptez. Vous pouvez retirer votre consentement en tout temps en avisant votre conseiller.',documents:'Documents',documentsHelp:'Facultatif : relevés, polices ou tout document demandé. PDF ou photos, 8 Mo au plus chacun.',upload:'Ajouter un fichier',idc:'Vérifier votre identité',idcHelp:'Photographiez votre permis de conduire et prenez un égoportrait sur la page sécurisée de Stripe. Votre conseiller voit seulement si la vérification a réussi.',idcGo:'Commencer la vérification',idcDone:'Vérification commencée. Vous pouvez la terminer maintenant ou plus tard.',
choose:'Choisir…',yes:'Oui',no:'Non',other:'Autre',save:'Enregistrer pour plus tard',saved:'Enregistré',submit:'Envoyer à mon conseiller',submitHelp:'Nous enverrons un code à 6 chiffres à votre courriel (',code:'Code à 6 chiffres',name:'Tapez votre nom complet',agree:'Mes réponses sont vraies et complètes à ma connaissance.',send:'Envoyez-moi un code',sent:'Un code a été envoyé. Il est valide ',min:' minutes.',dev:'(code de test : ',done:'Merci. Vos réponses ont été envoyées à votre conseiller. Vous pouvez fermer cette page.',need:'Remplissez les champs marqués *.',gone:'Ce lien n’est plus valide.',fail:'Un problème est survenu. Réessayez.',
ms:{single:'Célibataire',married:'Marié(e)',common_law:'Union de fait',separated:'Séparé(e)',divorced:'Divorcé(e)',widowed:'Veuf ou veuve'},pl:{en:'Anglais',fr:'Français',pa:'Pendjabi',hi:'Hindi',other:'Autre'}}};
var L=(navigator.language||'en').toLowerCase().indexOf('fr')===0?'fr':'en';var token=location.pathname.split('/').pop();var D=null;var A={about:{},situation:{}};var C=[];var timer=null;
var PROV=['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT','other'];
function $(i){return document.getElementById(i)}function el(t,p,c){var e=document.createElement(t);if(p)for(var k in p)e[k]=p[k];(c||[]).forEach(function(x){if(x!=null)e.append(x)});return e}
function api(path,body){return fetch('/v1/public/intake/'+token+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j&&j.error&&j.error.message||j&&j.message||T[L].fail);return j})})}
function save(now){clearTimeout(timer);var go=function(){return api('/save',{answers:A,consents:C}).then(function(){var s=$('st');if(s)s.textContent=T[L].saved}).catch(function(e){var s=$('st');if(s)s.textContent=e.message})};if(now)return go();timer=setTimeout(go,800)}
function field(g,k,type,opts){var t=T[L];var id=g+'_'+k;var v=A[g][k];var req=(g==='about'&&(k==='legalName'||k==='dateOfBirth'));var lab=el('label',{htmlFor:id},[t[k],req?el('span',{className:'req',textContent:' *'}):null]);var inp;
var set=function(x){if(x===''||x==null)delete A[g][k];else A[g][k]=x;save()};
if(type==='choice'){inp=el('select',{id:id,onchange:function(){set(inp.value)}},[el('option',{value:'',textContent:t.choose})].concat(opts.map(function(o){return el('option',{value:o[0],textContent:o[1],selected:v===o[0]})})))}
else if(type==='bool'){inp=el('select',{id:id,onchange:function(){set(inp.value===''?'':inp.value==='y')}},[el('option',{value:'',textContent:t.choose}),el('option',{value:'y',textContent:t.yes,selected:v===true}),el('option',{value:'n',textContent:t.no,selected:v===false})])}
else if(type==='long'){inp=el('textarea',{id:id,rows:2,value:v||'',oninput:function(){set(inp.value)}})}
else{inp=el('input',{id:id,type:type==='money'||type==='int'?'number':type,min:type==='money'||type==='int'?'0':undefined,value:v==null?'':v,oninput:function(){set(type==='money'||type==='int'?(inp.value===''?'':Number(inp.value)):inp.value)}})}
return el('div',{},[lab,inp])}
function row(a,b){return el('div',{className:'row'},[a,b])}
function render(){var t=T[L],d=D;var h=$('head');h.textContent='';h.append(el('button',{className:'lang',type:'button',textContent:t.lang,onclick:function(){L=L==='en'?'fr':'en';document.documentElement.lang=L==='fr'?'fr-CA':'en';render()}}),el('div',{className:'firm',textContent:d.firm}),el('h1',{textContent:t.hello+(d.firstName?' '+d.firstName:'')}),el('p',{textContent:d.advisor+t.intro}));
var b=$('body');b.textContent='';
b.append(el('div',{className:'card'},[el('h2',{textContent:t.about}),field('about','legalName','text'),row(field('about','dateOfBirth','date'),field('about','phone','tel')),field('about','address','text'),row(field('about','city','text'),field('about','province','choice',PROV.map(function(p){return [p,p==='other'?t.other:p]}))),row(field('about','postalCode','text'),field('about','preferredLanguage','choice',['en','fr','pa','hi','other'].map(function(x){return [x,t.pl[x]]}))),row(field('about','occupation','text'),field('about','employer','text'))]));
if(d.sections.indexOf('situation')>=0){var ob=el('div',{},[el('label',{textContent:t.objectives})].concat(d.objectives.map(function(o){var cb=el('input',{type:'checkbox',checked:(A.situation.objectives||[]).indexOf(o.value)>=0,onchange:function(){var l=(A.situation.objectives||[]).filter(function(x){return x!==o.value});if(cb.checked)l.push(o.value);if(l.length)A.situation.objectives=l;else delete A.situation.objectives;save()}});return el('label',{className:'chk'},[cb,L==='fr'?o.fr:o.en])})));
b.append(el('div',{className:'card'},[el('h2',{textContent:t.situation}),row(field('situation','maritalStatus','choice',Object.keys(t.ms).map(function(k){return [k,t.ms[k]]})),field('situation','dependants','int')),row(field('situation','annualIncome','money'),field('situation','spouseIncome','money')),row(field('situation','monthlyExpenses','money'),field('situation','liquidAssets','money')),row(field('situation','mortgage','money'),field('situation','otherDebts','money')),row(field('situation','existingIndividual','money'),field('situation','existingGroup','money')),field('situation','existingPolicies','long'),field('situation','replacing','bool'),field('situation','replacingNote','long'),ob,field('situation','objectivesNote','long'),field('situation','monthlyBudget','money')]))}
if(d.sections.indexOf('consents')>=0){b.append(el('div',{className:'card'},[el('h2',{textContent:t.consents}),el('p',{className:'muted',textContent:t.consentsHelp})].concat(d.consentKinds.map(function(k){var cb=el('input',{type:'checkbox',id:'c_'+k.kind,checked:C.indexOf(k.kind)>=0,onchange:function(){C=C.filter(function(x){return x!==k.kind});if(cb.checked)C.push(k.kind);save()}});return el('label',{className:'chk',htmlFor:'c_'+k.kind},[cb,el('span',{},[L==='fr'?k.fr:k.en,k.required?el('span',{className:'req',textContent:' *'}):null])])}))))}
if(d.sections.indexOf('documents')>=0){var list=el('ul',{className:'docs'},d.documents.map(function(x){return el('li',{textContent:x.name})}));var fi=el('input',{type:'file',id:'file',accept:'application/pdf,image/jpeg,image/png,image/heic,image/webp',onchange:function(){var f=fi.files&&fi.files[0];if(!f)return;var r=new FileReader();r.onload=function(){var b64=String(r.result).split(',')[1]||'';api('/document',{name:f.name,mime:f.type||'application/octet-stream',dataBase64:b64}).then(function(x){d.documents.push(x);list.append(el('li',{textContent:x.name}));fi.value=''}).catch(function(e){alertIn(dc,e.message)})};r.readAsDataURL(f)}});
var dc=el('div',{className:'card'},[el('h2',{textContent:t.documents}),el('p',{className:'muted',textContent:t.documentsHelp}),list,el('label',{htmlFor:'file',textContent:t.upload}),fi]);b.append(dc)}
if(d.sections.indexOf('id_check')>=0){var ic=el('div',{className:'card'},[el('h2',{textContent:t.idc}),el('p',{className:'muted',textContent:t.idcHelp})]);if(d.idCheck&&d.idCheck!=='canceled'&&d.idCheck!=='failed')ic.append(el('p',{className:'ok',textContent:t.idcDone}));else ic.append(el('button',{type:'button',textContent:t.idcGo,onclick:function(){api('/id-check',{}).then(function(r){save(true).then(function(){location.href=r.url})}).catch(function(e){alertIn(ic,e.message)})}}));b.append(ic)}
var sc=el('div',{className:'card',id:'submit'},[el('button',{type:'button',className:'q',textContent:t.save,onclick:function(){save(true)}}),el('span',{id:'st',className:'muted',style:'margin-left:10px'}),el('p',{textContent:t.submitHelp+d.emailHint+').'}),el('button',{type:'button',id:'sendc',textContent:t.send,onclick:function(){var me=this;save(true).then(function(){return api('/code',{})}).then(function(r){alertIn(sc,t.sent+r.minutes+t.min+(r.devCode?' '+t.dev+r.devCode+')':''),'ok');form()}).catch(function(e){alertIn(sc,e.message==='Fill in the required answers first.'?t.need:e.message)})}})]);b.append(sc)}
function alertIn(box,m,cls){var x=box.querySelector('.msg');if(!x){x=el('div',{className:'msg'});box.append(x)}x.className='msg '+(cls||'err');x.textContent=m}
function form(){if($('f'))return;var t=T[L];var sc=$('submit');var code=el('input',{type:'text',id:'code',inputMode:'numeric',maxLength:6,autocomplete:'one-time-code'});var nm=el('input',{type:'text',id:'nm',autocomplete:'name'});var ag=el('input',{type:'checkbox',id:'ag'});
var go=el('button',{type:'button',textContent:t.submit,onclick:function(){go.disabled=true;api('/submit',{code:code.value.trim(),typedName:nm.value.trim(),agree:ag.checked?true:false}).then(function(){$('body').textContent='';$('body').append(el('div',{className:'card'},[el('p',{className:'ok',textContent:t.done})]))}).catch(function(e){go.disabled=false;alertIn(sc,e.message)})}});
sc.append(el('div',{id:'f'},[el('label',{htmlFor:'code',textContent:t.code}),code,el('label',{htmlFor:'nm',textContent:t.name}),nm,el('label',{className:'chk',htmlFor:'ag'},[ag,t.agree]),go]))}
api('').then(function(d){D=d;A={about:d.answers.about||{},situation:d.answers.situation||{}};C=d.consents||[];render()}).catch(function(e){$('loading').textContent=e.message||T[L].gone});
})();
</script></body></html>`;
}
