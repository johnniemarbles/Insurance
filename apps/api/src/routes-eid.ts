// Electronic ID verification (roadmap Phase 2, feature 7). Switch: EID_ENABLED (404 when off), then the company's own
// choice of routes (Settings): Stripe Identity, PII's own check, or both.
//
// Stripe Identity: the advisor creates a link for one client on the deal; the client photographs their driver's licence
// and takes a selfie on Stripe's page. Stripe's signed webhook tells PII the result; PII compares the name and birth date
// Stripe read with the client record, keeps yes/no answers, and (by default) asks Stripe to delete what it holds.
// PII's own check: the advisor uploads the licence photo and a selfie the client gave them. PII's Google Gemini key
// reads them once; nothing is stored. The advisor looks at the photos and confirms. Anything that does not match goes
// to compliance, who decide. A verified check, either way, adds an ID record (method 'electronic') the gates count.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { findLoginCandidates, withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { candidateToIdentity } from './auth.ts';
import {
  IMAGE_TYPES, LICENCE_SYSTEM, allClear, compareWithRecord, eidEnabled, parseLicenceRead, readFromStripe, stripeSignatureOk,
  fakeStripeIdentity, type Comparison, type StripeIdentity,
} from './eid.ts';
import type { AppDeps } from './app.ts';

const TERMINAL = ['verified', 'failed', 'canceled'];
const OPEN = ['link_sent', 'processing', 'needs_input', 'needs_confirmation'];
const today = () => new Date().toISOString().slice(0, 10);

/** The company's routes, with what this server can actually offer. */
async function settingsOf(tx: Tx, deps: AppDeps) {
  const s = (await tx.query<{ stripe_enabled: boolean; own_check_enabled: boolean; redact_at_stripe: boolean; updated_by_name: string; updated_at: string }>(
    'SELECT stripe_enabled, own_check_enabled, redact_at_stripe, updated_by_name, updated_at FROM tenant_eid')).rows[0];
  const stripeAvailable = !!deps.stripeIdentity, ownCheckAvailable = !!deps.aiProviders?.gemini?.see;
  return {
    stripeEnabled: !!s?.stripe_enabled, ownCheckEnabled: !!s?.own_check_enabled, redactAtStripe: s ? s.redact_at_stripe : true,
    stripeAvailable, ownCheckAvailable, stripeOn: !!s?.stripe_enabled && stripeAvailable, ownCheckOn: !!s?.own_check_enabled && ownCheckAvailable,
    updatedBy: s?.updated_by_name ?? null, updatedAt: s?.updated_at ?? null,
  };
}

const nameOf = async (tx: Tx, userId: string) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [userId])).rows[0]?.n ?? 'Unknown';

async function boxFor(tx: Tx, boxId: string) {
  const b = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [boxId])).rows[0];
  if (!b) throw notFound('Deal not found');
  return b;
}
async function clientOn(tx: Tx, boxId: string, contactId: string) {
  const c = (await tx.query<{ full_name: string | null; dob: string | null }>(
    `SELECT c.full_name, c.date_of_birth::text AS dob FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 AND bc.contact_id = $2`, [boxId, contactId])).rows[0];
  if (!c) throw invalid('Choose a client on this deal');
  return c;
}

/** The ID record the deal's gates count. Only called once a check's status is 'verified'. */
async function addIdRecord(tx: Tx, ctx: RequestContext, v: { id: string; box_id: string; route: string; issuing_region: string | null }, verifierId: string, verifierName: string) {
  const where = v.issuing_region ? ` (${v.issuing_region})` : '';
  const how = v.route === 'stripe' ? 'Stripe Identity' : 'PII electronic check';
  await tx.query(
    `INSERT INTO client_id_records (tenant_id, box_id, method, documents_seen, result, verified_on, verifier_id, verifier_name, verification_id) VALUES ($1,$2,'electronic',$3,'verified',$4,$5,$6,$7)`,
    [ctx.tenantId, v.box_id, [`Driver's licence${where} and selfie, ${how}`], today(), verifierId, verifierName, v.id]);
}

/** The context of the person who asked for a check, so a webhook writes under their access. */
async function contextOf(deps: AppDeps, tenantId: string, userId: string): Promise<RequestContext | null> {
  const r = (await deps.authPool.query<{ email: string }>('SELECT email::text AS email FROM app_users WHERE id = $1 AND tenant_id = $2', [userId, tenantId])).rows[0];
  if (!r) return null;
  const c = (await findLoginCandidates(deps.authPool, r.email)).find((x) => x.tenantId === tenantId && x.userId === userId);
  return c ? candidateToIdentity(c).ctx : null;
}

/**
 * Bring a Stripe check up to date with Stripe. Called from the signed webhook (and the local stand-in). Writes as the
 * person who asked for the check. Idempotent: a finished check or one waiting for compliance is left alone.
 */
export async function applyStripeOutcome(deps: AppDeps, meta: { tenantId: string; verificationId: string; requestedBy: string; sessionId: string }, log: FastifyBaseLogger): Promise<string> {
  const stripe = deps.stripeIdentity;
  if (!stripe) return 'no_stripe';
  const ctx = await contextOf(deps, meta.tenantId, meta.requestedBy);
  if (!ctx) { log.warn({ verification: meta.verificationId }, 'eid: the person who asked for this check no longer has access'); return 'no_requester'; }
  const outcome = await stripe.getOutcome(meta.sessionId);
  const res = await withRequestTx(deps.appPool, ctx, async (tx) => {
    const v = (await tx.query<{ id: string; box_id: string; contact_id: string; route: string; status: string; issuing_region: string | null; stripe_session_id: string; requested_by_name: string; owner_node_id: string }>(
      `SELECT v.id, v.box_id, v.contact_id, v.route, v.status, v.issuing_region, v.stripe_session_id, v.requested_by_name, b.owner_node_id
         FROM id_verifications v JOIN boxes b ON b.id = v.box_id WHERE v.id = $1 FOR UPDATE OF v`, [meta.verificationId])).rows[0];
    if (!v || v.stripe_session_id !== meta.sessionId) return 'unknown';
    if (TERMINAL.includes(v.status) || v.status === 'needs_review') return 'unchanged';
    if (outcome.status === 'processing') { await tx.query(`UPDATE id_verifications SET status = 'processing' WHERE id = $1`, [v.id]); return 'processing'; }
    if (outcome.status === 'canceled') { await tx.query(`UPDATE id_verifications SET status = 'canceled' WHERE id = $1`, [v.id]); return 'canceled'; }
    if (outcome.status === 'requires_input') {
      const code = (outcome.errorCode ?? 'retry').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 50);
      await tx.query(`UPDATE id_verifications SET status = 'needs_input', reasons = $2 WHERE id = $1`, [v.id, [`stripe:${code}`]]);
      return 'needs_input';
    }
    const c = (await tx.query<{ full_name: string | null; dob: string | null }>('SELECT full_name, date_of_birth::text AS dob FROM contacts WHERE id = $1', [v.contact_id])).rows[0];
    const cmp = compareWithRecord(readFromStripe(outcome), { fullName: c?.full_name ?? null, dob: c?.dob ?? null });
    const ok = allClear(cmp);
    await tx.query(`UPDATE id_verifications SET status = $2, checks = $3, reasons = $4, document_type = $5, issuing_region = $6 WHERE id = $1`,
      [v.id, ok ? 'verified' : 'needs_review', JSON.stringify(cmp.checks), cmp.reasons, cmp.documentType, cmp.issuingRegion]);
    if (ok) await addIdRecord(tx, ctx, { ...v, issuing_region: cmp.issuingRegion }, meta.requestedBy, `Stripe Identity (requested by ${v.requested_by_name})`);
    await audit(tx, ctx, ok ? 'eid_verified' : 'eid_needs_review', 'box', v.box_id, { verification: v.id, route: 'stripe', reasons: cmp.reasons }, v.owner_node_id);
    return ok ? 'verified' : 'needs_review';
  });
  if (res === 'verified') await redactIfSet(deps, ctx, meta.verificationId, meta.sessionId, log);
  return res;
}

async function redactIfSet(deps: AppDeps, ctx: RequestContext, verificationId: string, sessionId: string, log: FastifyBaseLogger) {
  try {
    const on = await withRequestTx(deps.appPool, ctx, async (tx) => (await settingsOf(tx, deps)).redactAtStripe);
    if (!on || !deps.stripeIdentity) return;
    await deps.stripeIdentity.redact(sessionId);
    await withRequestTx(deps.appPool, ctx, (tx) => tx.query('UPDATE id_verifications SET redacted_at_stripe = now() WHERE id = $1', [verificationId]));
  } catch (e) { log.warn({ err: (e as Error).message, verification: verificationId }, 'eid: Stripe redaction failed; retry from the Stripe dashboard'); }
}

export function registerEidRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const image = { type: 'object', additionalProperties: false, required: ['mime', 'dataBase64'], properties: { mime: { type: 'string', maxLength: 30 }, dataBase64: { type: 'string', minLength: 4, maxLength: 11_000_000 } } } as const;
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!eidEnabled()) throw notFound('Not found');
    const id = await deps.authenticate(req);
    requireCrm(id.ctx);
    return id;
  };
  const canChangeSettings = (ctx: RequestContext) => canWaive(ctx);

  app.get('/v1/eid/settings', async (req) => {
    const { ctx } = await begin(req);
    return run(ctx, async (tx) => ({ ...(await settingsOf(tx, deps)), canChange: canChangeSettings(ctx) }));
  });

  app.put('/v1/eid/settings', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['stripeEnabled', 'ownCheckEnabled', 'redactAtStripe'], properties: {
      stripeEnabled: { type: 'boolean' }, ownCheckEnabled: { type: 'boolean' }, redactAtStripe: { type: 'boolean' } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    if (!canChangeSettings(ctx)) throw forbidden('Only an administrator or the compliance role can choose how ID is checked');
    const b = req.body as { stripeEnabled: boolean; ownCheckEnabled: boolean; redactAtStripe: boolean };
    return run(ctx, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_eid (tenant_id, stripe_enabled, own_check_enabled, redact_at_stripe, updated_by_name) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id) DO UPDATE SET stripe_enabled = $2, own_check_enabled = $3, redact_at_stripe = $4, updated_by_name = $5, updated_at = now()`,
        [ctx.tenantId, b.stripeEnabled, b.ownCheckEnabled, b.redactAtStripe, await nameOf(tx, ctx.userId)]);
      await audit(tx, ctx, 'eid_settings_changed', 'tenant', ctx.tenantId, b);
      return { ...(await settingsOf(tx, deps)), canChange: true };
    });
  });

  app.get('/v1/boxes/:id/eid', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await boxFor(tx, id);
      const s = await settingsOf(tx, deps);
      const clients = (await tx.query(`SELECT c.id, coalesce(c.full_name, c.email::text, '') AS name, c.date_of_birth IS NOT NULL AS "hasDob" FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 ORDER BY 2`, [id])).rows;
      const checks = (await tx.query(
        `SELECT v.id, v.contact_id AS "contactId", coalesce(c.full_name, '') AS "clientName", v.route, v.status, v.document_type AS "documentType", v.issuing_region AS "issuingRegion",
                v.checks, v.reasons, v.requested_by AS "requestedById", v.requested_by_name AS "requestedBy", v.decided_by_name AS "decidedBy", v.decided_at AS "decidedAt", v.decision_note AS "decisionNote",
                v.redacted_at_stripe IS NOT NULL AS "redactedAtStripe", v.created_at AS "createdAt", v.updated_at AS "updatedAt"
           FROM id_verifications v JOIN contacts c ON c.id = v.contact_id WHERE v.box_id = $1 ORDER BY v.created_at DESC LIMIT 30`, [id])).rows;
      return { stripeOn: s.stripeOn, ownCheckOn: s.ownCheckOn, clients, checks, canReview: canWaive(ctx) };
    });
  });

  app.post('/v1/boxes/:id/eid/stripe', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['contactId'], properties: { contactId: uuid } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const { contactId } = req.body as { contactId: string };
    const stripe = deps.stripeIdentity as StripeIdentity | undefined;
    // Check access and the company's choice before anything goes to Stripe.
    const pre = await run(ctx, async (tx) => {
      requireEdit(ctx, (await boxFor(tx, id)).owner_node_id);
      if (!(await settingsOf(tx, deps)).stripeOn || !stripe) throw new HttpError(503, 'eid_unavailable', 'Stripe Identity is not switched on for your company');
      await clientOn(tx, id, contactId);
      if ((await tx.query(`SELECT 1 FROM id_verifications WHERE box_id = $1 AND contact_id = $2 AND status = ANY($3)`, [id, contactId, OPEN])).rowCount) {
        throw new HttpError(409, 'eid_open', 'A check for this client is already open. Cancel it first to send a new link.');
      }
      return { name: await nameOf(tx, ctx.userId) };
    });
    const verificationId = randomUUID();
    let session: { id: string; url: string };
    try {
      session = await stripe!.createSession({ returnUrl: `${deps.config.appOrigin}/eid-done`, metadata: { tenant_id: ctx.tenantId, verification_id: verificationId, requested_by: ctx.userId } });
    } catch (e) { req.log.warn({ err: (e as Error).message }, 'eid: Stripe session failed'); throw new HttpError(502, 'eid_failed', 'Stripe Identity could not create the link. Try again in a minute.'); }
    await run(ctx, async (tx) => {
      const b = await boxFor(tx, id);
      await tx.query(`INSERT INTO id_verifications (id, tenant_id, box_id, contact_id, route, status, stripe_session_id, requested_by, requested_by_name) VALUES ($1,$2,$3,$4,'stripe','link_sent',$5,$6,$7)`,
        [verificationId, ctx.tenantId, id, contactId, session.id, ctx.userId, pre.name]);
      await audit(tx, ctx, 'eid_requested', 'box', id, { verification: verificationId, route: 'stripe' }, b.owner_node_id);
    });
    return reply.code(201).send({ id: verificationId, url: session.url });
  });

  app.post('/v1/boxes/:id/eid/own-check', {
    bodyLimit: 24 * 1024 * 1024,
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['contactId', 'consentConfirmed', 'licence', 'selfie'], properties: {
      contactId: uuid, consentConfirmed: { type: 'boolean' }, licence: image, selfie: image } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { contactId: string; consentConfirmed: boolean; licence: { mime: string; dataBase64: string }; selfie: { mime: string; dataBase64: string } };
    if (!b.consentConfirmed) throw invalid('Confirm that the client agreed to this ID check and gave you these photos');
    for (const i of [b.licence, b.selfie]) if (!(IMAGE_TYPES as readonly string[]).includes(i.mime)) throw invalid('Upload photos: JPEG, PNG, WebP or HEIC');
    const images = [b.licence, b.selfie].map((i) => ({ mime: i.mime, data: Buffer.from(i.dataBase64, 'base64') }));
    if (images.some((i) => i.data.length > 8 * 1024 * 1024)) throw invalid('Each photo must be 8 MB or smaller');
    const seer = deps.aiProviders?.gemini;
    const pre = await run(ctx, async (tx) => {
      requireEdit(ctx, (await boxFor(tx, id)).owner_node_id);
      if (!(await settingsOf(tx, deps)).ownCheckOn || !seer?.see) throw new HttpError(503, 'eid_unavailable', 'PII\'s own ID check is not switched on for your company');
      const client = await clientOn(tx, id, b.contactId);
      if ((await tx.query(`SELECT 1 FROM id_verifications WHERE box_id = $1 AND contact_id = $2 AND status = ANY($3)`, [id, b.contactId, OPEN])).rowCount) {
        throw new HttpError(409, 'eid_open', 'A check for this client is already open. Finish or cancel it first.');
      }
      return { client, name: await nameOf(tx, ctx.userId) };
    });
    // Only the photos go to Gemini: no client name, birth date or other record data.
    let raw: string;
    try { raw = await seer!.see!({ system: LICENCE_SYSTEM, user: 'Check these two photos and answer with the JSON described.', images, maxTokens: 600 }); }
    catch (e) { req.log.warn({ err: (e as Error).message }, 'eid: licence read failed'); throw new HttpError(502, 'ai_failed', 'The photos could not be read. Try again, or use clearer photos.'); }
    const read = parseLicenceRead(raw);
    const cmp: Comparison = compareWithRecord(read, { fullName: pre.client.full_name, dob: pre.client.dob });
    const out = await run(ctx, async (tx) => {
      const box = await boxFor(tx, id);
      const v = (await tx.query<{ id: string }>(
        `INSERT INTO id_verifications (tenant_id, box_id, contact_id, route, status, document_type, issuing_region, checks, reasons, requested_by, requested_by_name)
         VALUES ($1,$2,$3,'own_check','needs_confirmation',$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, b.contactId, cmp.documentType, cmp.issuingRegion, JSON.stringify(cmp.checks), cmp.reasons, ctx.userId, pre.name])).rows[0]!;
      await audit(tx, ctx, 'eid_requested', 'box', id, { verification: v.id, route: 'own_check' }, box.owner_node_id);
      return v;
    });
    // What was read goes back to the advisor's screen to compare against the photos, and is not kept.
    return reply.code(201).send({ id: out.id, checks: cmp.checks, reasons: cmp.reasons, allClear: allClear(cmp), documentType: cmp.documentType, issuingRegion: cmp.issuingRegion,
      read: { fullName: read.fullName, dateOfBirth: read.dob, expiryDate: read.expiry, concerns: read.concerns } });
  });

  // The advisor who has the photos looked at them. All yes → verified; anything else → compliance decides.
  app.post('/v1/eid/:id/confirm', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['lookedAtPhotos'], properties: { lookedAtPhotos: { type: 'boolean' } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    if (!(req.body as { lookedAtPhotos: boolean }).lookedAtPhotos) throw invalid('Confirm that you looked at the licence and the selfie and they show this client');
    return run(ctx, async (tx) => {
      const v = (await tx.query<{ id: string; box_id: string; route: string; status: string; checks: Record<string, boolean | null>; reasons: string[]; document_type: 'drivers_licence' | 'other' | null; issuing_region: string | null; requested_by: string; owner_node_id: string }>(
        `SELECT v.id, v.box_id, v.route, v.status, v.checks, v.reasons, v.document_type, v.issuing_region, v.requested_by, b.owner_node_id FROM id_verifications v JOIN boxes b ON b.id = v.box_id WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
      if (!v) throw notFound('Check not found');
      requireEdit(ctx, v.owner_node_id);
      if (v.status !== 'needs_confirmation') throw invalid('This check is not waiting for your confirmation');
      if (v.requested_by !== ctx.userId) throw forbidden('Only the person who uploaded the photos can confirm them');
      const ok = allClear({ checks: v.checks, reasons: v.reasons, documentType: v.document_type, issuingRegion: v.issuing_region });
      await tx.query(`UPDATE id_verifications SET status = $2 WHERE id = $1`, [id, ok ? 'verified' : 'needs_review']);
      if (ok) await addIdRecord(tx, ctx, v, ctx.userId, await nameOf(tx, ctx.userId));
      await audit(tx, ctx, ok ? 'eid_verified' : 'eid_needs_review', 'box', v.box_id, { verification: id, route: v.route, reasons: v.reasons }, v.owner_node_id);
      return { status: ok ? 'verified' : 'needs_review' };
    });
  });

  // Compliance decides a check that did not match. A note is required either way.
  app.post('/v1/eid/:id/review', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['decision', 'note'], properties: {
      decision: { enum: ['verified', 'failed'] }, note: { type: 'string', minLength: 10, maxLength: 300 } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can decide an ID check');
    const { id } = req.params as { id: string };
    const b = req.body as { decision: 'verified' | 'failed'; note: string };
    if (/[0-9]{6,}/.test(b.note)) throw invalid('Do not enter ID numbers in the note');
    const r = await run(ctx, async (tx) => {
      const v = (await tx.query<{ id: string; box_id: string; route: string; status: string; issuing_region: string | null; stripe_session_id: string | null; owner_node_id: string }>(
        `SELECT v.id, v.box_id, v.route, v.status, v.issuing_region, v.stripe_session_id, b.owner_node_id FROM id_verifications v JOIN boxes b ON b.id = v.box_id WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
      if (!v) throw notFound('Check not found');
      if (v.status !== 'needs_review') throw invalid('This check is not waiting for a compliance decision');
      const who = await nameOf(tx, ctx.userId);
      await tx.query(`UPDATE id_verifications SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = now(), decision_note = $5 WHERE id = $1`, [id, b.decision, ctx.userId, who, b.note.trim()]);
      if (b.decision === 'verified') await addIdRecord(tx, ctx, v, ctx.userId, `${who} (compliance review)`);
      await audit(tx, ctx, 'eid_reviewed', 'box', v.box_id, { verification: id, decision: b.decision }, v.owner_node_id);
      return v;
    });
    if (r.stripe_session_id) await redactIfSet(deps, ctx, id, r.stripe_session_id, req.log);
    return { status: b.decision };
  });

  app.post('/v1/eid/:id/cancel', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const v = await run(ctx, async (tx) => {
      const v = (await tx.query<{ box_id: string; status: string; stripe_session_id: string | null; owner_node_id: string }>(
        `SELECT v.box_id, v.status, v.stripe_session_id, b.owner_node_id FROM id_verifications v JOIN boxes b ON b.id = v.box_id WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
      if (!v) throw notFound('Check not found');
      requireEdit(ctx, v.owner_node_id);
      if (!OPEN.includes(v.status)) throw invalid('Only an open check can be cancelled');
      await tx.query(`UPDATE id_verifications SET status = 'canceled' WHERE id = $1`, [id]);
      await audit(tx, ctx, 'eid_canceled', 'box', v.box_id, { verification: id }, v.owner_node_id);
      return v;
    });
    if (v.stripe_session_id) await deps.stripeIdentity?.cancel(v.stripe_session_id).catch((e) => req.log.warn({ err: (e as Error).message }, 'eid: Stripe cancel failed'));
    return { status: 'canceled' };
  });

  // Where Stripe sends the client when they finish. No login, nothing about the client.
  app.get('/eid-done', async (_req, reply) => {
    if (!eidEnabled()) throw notFound('Not found');
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ID check sent</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222"><h1 style="font-size:1.4rem">Thank you</h1>
<p>Your ID check has been sent to your advisor. You can close this page.</p><p lang="fr">Merci. Votre vérification d’identité a été transmise à votre conseiller. Vous pouvez fermer cette page.</p></body>`);
  });

  // Local acceptance runs only: the stand-in Stripe page, where the tester plays the client.
  const fake = deps.stripeIdentity as ReturnType<typeof fakeStripeIdentity> | undefined;
  if (deps.config.appEnv === 'dev' && fake && typeof fake.finish === 'function') {
    app.get('/dev/stripe-identity/:sid', async (req, reply) => {
      const { sid } = req.params as { sid: string };
      if (!fake.sessions.has(sid)) throw notFound('No such session');
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>Stand-in Stripe Identity</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:10vh auto;padding:0 16px"><h1 style="font-size:1.3rem">Stand-in Stripe Identity (local test only)</h1>
<p>Play the client: finish the check as they would on Stripe's page.</p>
<p><a role="button" href="/dev/stripe-identity/${sid}/finish?as=pass">Licence and selfie match</a> · <a role="button" href="/dev/stripe-identity/${sid}/finish?as=mismatch">Different birth date</a> · <a role="button" href="/dev/stripe-identity/${sid}/finish?as=unreadable">Photo unreadable</a></p></body>`);
    });
    {
      // A plain link (dev only), so the stand-in needs no form handling.
      app.get('/dev/stripe-identity/:sid/finish', async (req, reply) => {
        const { sid } = req.params as { sid: string };
        const as = String((req.query as Record<string, string> | undefined)?.as ?? 'pass');
        const m = fake.metadata.get(sid);
        if (as === 'unreadable') fake.finish(sid, { status: 'requires_input', errorCode: 'document_unverified_other' });
        else fake.finish(sid, { status: 'verified', documentType: 'drivers_licence', issuingCountry: 'CA', firstName: 'Raj', lastName: 'Singh', dob: as === 'mismatch' ? '1979-01-01' : '1980-04-12', expiry: '2030-06-30', selfieVerified: true, documentVerified: true });
        if (m) await applyStripeOutcome(deps, { tenantId: m.tenant_id!, verificationId: m.verification_id!, requestedBy: m.requested_by!, sessionId: sid }, req.log);
        return reply.redirect('/eid-done');
      });
    }
  }

  // Stripe's webhook: raw body for the signature, so it gets its own JSON parser in its own scope.
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_r, body, done) => done(null, body));
    scope.post('/v1/webhooks/stripe-identity', async (req, reply) => {
      if (!eidEnabled() || !deps.stripeIdentity) throw notFound('Not found');
      const raw = req.body as Buffer;
      const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET ?? '';
      if (!Buffer.isBuffer(raw) || !stripeSignatureOk(raw, req.headers['stripe-signature'] as string | undefined, secret)) {
        return reply.code(400).send({ error: { code: 'bad_signature', message: 'Signature check failed' } });
      }
      let ev: { type?: string; data?: { object?: { id?: string; object?: string; metadata?: Record<string, string> } } };
      try { ev = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: { code: 'bad_body', message: 'Not JSON' } }); }
      const o = ev.data?.object;
      const m = o?.metadata ?? {};
      if (!ev.type?.startsWith('identity.verification_session.') || o?.object !== 'identity.verification_session' || !o.id
          || ![m.tenant_id, m.verification_id, m.requested_by].every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))) {
        return { received: true, ignored: true };
      }
      const result = await applyStripeOutcome(deps, { tenantId: m.tenant_id!, verificationId: m.verification_id!, requestedBy: m.requested_by!, sessionId: o.id }, req.log);
      return { received: true, result };
    });
  });
}
