import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { gateTypeFor, type RequestContext } from '@pii/domain';
import { open, seal } from '@pii/platform';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { unsignedAdvicePdf } from './advice-seal.ts';
import { contentHash, recordVendorSigned } from './routes-advice.ts';
import { ADOBE_HOST, AdobeError, adobeClient, adobeOutcome, cleanApiPoint, type AdobeConfig } from './adobe-sign.ts';
import { actingAs } from './effects.ts';
import type { AppDeps } from './app.ts';

const VENDOR = 'adobe_sign';
const aad = (tenantId: string) => `${tenantId}:esign:${VENDOR}`;

const keysOf = (deps: AppDeps) => { if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Connections are not available on this server yet'); return deps.keys; };
async function clientForTenant(deps: AppDeps, tx: Tx, tenantId: string) {
  const r = (await tx.query<{ config_enc: Buffer; key_id: string }>('SELECT config_enc, key_id FROM esign_connections WHERE vendor = $1', [VENDOR])).rows[0];
  if (!r) throw new HttpError(409, 'not_connected', 'Adobe Acrobat Sign is not connected. An administrator connects it on the Compliance page.');
  const cfg = JSON.parse(open(keysOf(deps), { keyId: r.key_id, data: r.config_enc }, aad(tenantId)).toString('utf8')) as AdobeConfig;
  return adobeClient(cfg, deps.fetchImpl ?? fetch);
}
const vendorFail = (e: unknown): never => {
  if (e instanceof AdobeError) throw new HttpError(502, 'adobe_error', e.message);
  throw e;
};

/** Ask Adobe where one record stands. When it is signed, bring the PDF home, file it and lock the record. */
async function refreshOne(deps: AppDeps, tx: Tx, ctx: RequestContext, adviceId: string): Promise<{ status: string; signed: boolean }> {
    const e = (await tx.query<{ id: string; external_id: string }>(`SELECT id, external_id FROM esign_envelopes WHERE advice_id = $1 AND status = 'sent' ORDER BY created_at DESC LIMIT 1`, [adviceId])).rows[0];
    if (!e) throw new HttpError(409, 'not_sent', 'Nothing is out for signature on this record');
    const r = (await tx.query<any>(`SELECT a.*, b.owner_node_id FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = $1`, [adviceId])).rows[0];
    const client = await clientForTenant(deps, tx, ctx.tenantId);
    let st: string;
    try { st = await client.status(e.external_id); } catch (x) { return vendorFail(x); }
    const outcome = adobeOutcome(st);
    if (outcome === 'open') { await tx.query('UPDATE esign_envelopes SET vendor_status = $2, updated_at = now() WHERE id = $1', [e.id, st]); return { status: st, signed: false }; }
    if (outcome === 'closed') {
      await tx.query(`UPDATE esign_envelopes SET status = $2, vendor_status = $3, updated_at = now() WHERE id = $1`, [e.id, st === 'EXPIRED' ? 'expired' : 'cancelled', st]);
      await audit(tx, ctx, 'esign_closed', 'box', r.box_id, { adviceId, vendor: VENDOR, vendorStatus: st });
      return { status: st, signed: false };
    }
    let pdf: Buffer;
    try { pdf = await client.signedPdf(e.external_id); } catch (x) { return vendorFail(x); }
    const docId = randomUUID();
    const sealed = seal(keysOf(deps), pdf, `${ctx.tenantId}:doc:${docId}`);
    await tx.query(`INSERT INTO box_documents (id, tenant_id, box_id, name, mime, size_bytes, data_enc, key_id, uploaded_by, doc_type) VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8,$9)`,
      [docId, ctx.tenantId, r.box_id, `${String(r.title).replace(/[^\w .-]/g, '_').slice(0, 130)} (Adobe Sign).pdf`, pdf.length, sealed.data, sealed.keyId, ctx.userId, gateTypeFor(r.kind)]);
    // the record may still read "awaiting"; the lock trigger only blocks edits once it is signed
    await recordVendorSigned(tx, ctx, r, { vendorId: VENDOR, label: 'Adobe Acrobat Sign', ref: e.external_id, documentId: docId });
    await tx.query(`UPDATE esign_envelopes SET status = 'signed', vendor_status = $2, updated_at = now() WHERE id = $1`, [e.id, st]);
    return { status: st, signed: true };
  }

/** Live Adobe Acrobat Sign connection: save the company's sign-in, send vendor-tier paperwork out, bring the signed PDF back. */
export function registerEsignRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const keys = () => keysOf(deps);
  const fetcher = () => deps.fetchImpl ?? fetch;
  const clientFor = (tx: Tx, tenantId: string) => clientForTenant(deps, tx, tenantId);

  app.get('/v1/compliance/esign/adobe', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const r = (await tx.query<{ api_host: string; set_by_name: string; updated_at: string }>('SELECT api_host, set_by_name, updated_at FROM esign_connections WHERE vendor = $1', [VENDOR])).rows[0];
      return { connected: !!r, apiAccessPoint: r?.api_host ?? null, setBy: r?.set_by_name ?? null, updatedAt: r?.updated_at ?? null, canManage: canWaive(ctx) };
    });
  });

  app.put('/v1/compliance/esign/adobe', {
    schema: { body: { type: 'object', required: ['apiAccessPoint'], additionalProperties: false, properties: {
      apiAccessPoint: { type: 'string', maxLength: 200 }, accessToken: { type: 'string', maxLength: 4000 }, clientId: { type: 'string', maxLength: 200 }, clientSecret: { type: 'string', maxLength: 400 }, refreshToken: { type: 'string', maxLength: 4000 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can connect a signing vendor');
    const b = req.body as AdobeConfig;
    const cfg: AdobeConfig = { apiAccessPoint: cleanApiPoint(b.apiAccessPoint) };
    if (!ADOBE_HOST.test(cfg.apiAccessPoint)) throw invalid('Use the API access point Adobe gave you, for example https://api.na1.adobesign.com');
    for (const k of ['accessToken', 'clientId', 'clientSecret', 'refreshToken'] as const) if (b[k]?.trim()) cfg[k] = b[k]!.trim();
    if (!cfg.accessToken && !(cfg.clientId && cfg.clientSecret && cfg.refreshToken)) throw invalid('Give an access token, or the client ID, client secret and refresh token');
    // prove it works before saving
    let who: string | null = null;
    try { who = (await adobeClient(cfg, fetcher()).me()).email; } catch (e) { vendorFail(e); }
    const sealed = seal(keys(), Buffer.from(JSON.stringify(cfg)), aad(ctx.tenantId));
    await run(ctx, async (tx) => {
      const name = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      await tx.query(`INSERT INTO esign_connections (tenant_id, vendor, config_enc, key_id, api_host, set_by_name) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id, vendor) DO UPDATE SET config_enc = EXCLUDED.config_enc, key_id = EXCLUDED.key_id, api_host = EXCLUDED.api_host, set_by_name = EXCLUDED.set_by_name, updated_at = now()`,
        [ctx.tenantId, VENDOR, sealed.data, sealed.keyId, cfg.apiAccessPoint, name]);
      await audit(tx, ctx, 'esign_connected', 'vendor', null, { vendor: VENDOR, host: cfg.apiAccessPoint, signedInAs: who });
    });
    return reply.send({ ok: true, signedInAs: who });
  });

  app.delete('/v1/compliance/esign/adobe', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can disconnect a signing vendor');
    await run(ctx, async (tx) => { await tx.query('DELETE FROM esign_connections WHERE vendor = $1', [VENDOR]); await audit(tx, ctx, 'esign_disconnected', 'vendor', null, { vendor: VENDOR }); });
    return reply.code(204).send();
  });

  // Send vendor-tier paperwork to the client through Adobe. The wording is locked from here.
  app.post('/v1/advice/:id/esign', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query<any>(`SELECT a.*, b.owner_node_id FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Advice record not found');
      requireEdit(ctx, r.owner_node_id);
      if (r.tier !== 'vendor') throw new HttpError(409, 'wrong_tier', 'This paperwork is signed with the built-in signature, not a vendor');
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'Already signed');
      if (!r.client_email) throw invalid('Add the client’s email address first');
      const open_ = (await tx.query('SELECT 1 FROM esign_envelopes WHERE advice_id = $1 AND status = \'sent\'', [id])).rowCount;
      if (open_) throw new HttpError(409, 'already_sent', 'This is already out for signature. Check its status, or wait for it to expire.');
      const enabled = (await tx.query<{ vendor: string; enabled: boolean }>('SELECT vendor, enabled FROM signing_vendors')).rows;
      if (enabled.some((v) => v.enabled) && !enabled.some((v) => v.vendor === VENDOR && v.enabled)) throw invalid('Adobe Acrobat Sign is not turned on for your company');
      const client = await clientFor(tx, ctx.tenantId);
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
      const pdf = await unsignedAdvicePdf({ kind: r.kind, title: r.title, body: r.body, clientName: r.client_name, firm });
      let ext: string;
      try { ext = await client.send({ name: r.title.replace(/[^\w .-]/g, '_').slice(0, 120) || 'Document', pdf, signerEmail: r.client_email, message: `${firm}: please review and sign.` }); } catch (e) { return vendorFail(e); }
      await tx.query(`INSERT INTO esign_envelopes (tenant_id, advice_id, vendor, external_id, signer_email, sent_by) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, id, VENDOR, ext, r.client_email, ctx.userId]);
      await tx.query(`UPDATE advice_records SET status = 'awaiting_signature', content_hash = $2, updated_at = now() WHERE id = $1`, [id, contentHash(r)]);
      await audit(tx, ctx, 'esign_sent', 'box', r.box_id, { adviceId: id, vendor: VENDOR, agreementId: ext });
      return { sent: true, agreementId: ext };
    });
  });

  app.post('/v1/advice/:id/esign/check', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query<{ owner_node_id: string }>(`SELECT b.owner_node_id FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Advice record not found');
      requireEdit(ctx, r.owner_node_id);
      return refreshOne(deps, tx, ctx, id);
    });
  });
}

/** Background pass: check every envelope still out for signature, so a signed document comes home without anyone pressing a button. */
export async function sweepEsign(deps: AppDeps): Promise<number> {
  if (!deps.keys) return 0;
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let n = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    const ctx = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
    try {
      const due = await withRequestTx(deps.appPool, ctx, async (tx) => (await tx.query<{ advice_id: string }>(
        `SELECT advice_id FROM esign_envelopes WHERE status = 'sent' AND updated_at < now() - interval '10 minutes' ORDER BY updated_at LIMIT 50`)).rows);
      for (const d of due) {
        try { if ((await withRequestTx(deps.appPool, ctx, (tx) => refreshOne(deps, tx, ctx, d.advice_id))).signed) n++; } catch { /* next one; the person can still press check */ }
      }
    } catch { /* next company */ }
  }
  return n;
}
