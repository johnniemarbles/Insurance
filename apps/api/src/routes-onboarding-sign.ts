// Partner agency agreement signing. The Compliance officer sends the agreement once the standing is good; the partner signs
// through a private link, with a one-time code emailed to the partner's people. The signed agreement and its sealed PDF are kept
// with the onboarding case. Separate from client advice signing (routes-sign.ts), which is tied to client boxes and consents.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { OTP_MAX_ATTEMPTS, OTP_MINUTES, stageMoveBlock, type OnboardingStage, type RequestContext, type StandingOutcome } from '@pii/domain';
import { audit } from './audit.ts';
import { actingAs } from './effects.ts';
import { conflict, forbidden, invalid, notFound, HttpError } from './errors.ts';
import { agreementHash, sealedPartnerAgreementPdf } from './partner-agreement-pdf.ts';
import { blank, fillAgreement, signDateParts } from './aga-agreement.ts';
import { seal, open } from '@pii/platform';
import { signPage } from './routes-sign.ts';
import type { AppDeps } from './app.ts';

const LINK_DAYS = 7;
const MAX_SENDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenHash = (t: string) => createHash('sha256').update(t).digest();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '');
const MAX_BODY = 60_000;

interface CaseRow { id: string; tenantId: string; nodeId: string; stage: OnboardingStage; standing: StandingOutcome | null; partnerName: string }
interface LinkRow {
  id: string; tenant_id: string; case_id: string; node_id: string; created_by: string; title: string; body: string; version: string;
  expires_at: Date; otp_hash: Buffer | null; otp_expires_at: Date | null; otp_attempts: number; sends: number; used_at: Date | null;
  agent_signed_at: Date | null; agent_typed_name: string | null; agent_signed_ip: string | null; agent_signed_agent: string | null;
  cm_user_id: string | null; cm_name: string | null; cm_email: string | null;
}

const body = (req: FastifyRequest): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;
const caseId = (raw: string): string => {
  if (!UUID.test(raw)) throw notFound('Unknown onboarding case');
  return raw;
};
const text = (v: unknown, label: string, max: number): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw invalid(`${label} is required (up to ${max} characters)`);
  return v.trim();
};

async function loadCase(tx: Tx, id: string): Promise<CaseRow> {
  const r = (await tx.query<CaseRow>(
    `SELECT c.id, c.tenant_id AS "tenantId", c.node_id AS "nodeId", c.stage, c.standing, n.name AS "partnerName"
       FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id WHERE c.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Unknown onboarding case');
  return r;
}

async function requireOfficer(tx: Tx, c: CaseRow): Promise<void> {
  const ok = (await tx.query<{ ok: boolean }>('SELECT app_is_compliance_at_or_above($1, $2) AS ok', [c.tenantId, c.nodeId])).rows[0]?.ok === true;
  if (!ok) throw forbidden('Only the Compliance officer for this region can do this');
}

/** Partner administrators on this broker. The signing link and the code go only to them, never to staff, learners or trainers on the same node. */
async function partnerEmails(authPool: AppDeps['authPool'], nodeId: string): Promise<string[]> {
  return (await authPool.query<{ email: string }>(
    `SELECT DISTINCT u.email::text AS email FROM app_users u JOIN user_node_roles r ON r.user_id = u.id
      WHERE r.node_id = $1 AND u.status::text <> 'disabled' AND r.role::text IN ('admin', 'partner')
      ORDER BY email`, [nodeId])).rows.map((r) => r.email);
}

async function linkFor(authPool: AppDeps['authPool'], token: string, allowUsed = false): Promise<LinkRow> {
  const l = (await authPool.query<LinkRow>('SELECT * FROM onboarding_signing_links WHERE token_hash = $1', [tokenHash(token)])).rows[0];
  if (!l || l.expires_at.getTime() < Date.now() || (l.used_at && !allowUsed)) {
    throw notFound('This signing link is not valid any more. Ask your Compliance officer for a new one.');
  }
  return l;
}

export function registerOnboardingSignRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const actor = (l: LinkRow): RequestContext => ({ ...actingAs(l.tenant_id, l.created_by, l.node_id), isTenantAdmin: true });

  // ---- Compliance officer ------------------------------------------------------------------------------------------

  /** Send the agency agreement to the partner. Needs a good-standing decision; the wording is the officer's, as issued by counsel. */
  app.post('/v1/onboarding/cases/:id/agreement', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    const title = text(b.title, 'Title', 200);
    const rawBody = text(b.body, 'Agreement text', MAX_BODY);
    const version = text(b.version, 'Version', 60);
    const out = await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      const profile = (await tx.query<{ legalName: string | null; entityType: string | null; fields: Record<string, string> }>(
        `SELECT legal_name AS "legalName", entity_type AS "entityType", fields FROM compliance_profiles WHERE node_id = $1`,
        [c.nodeId])).rows[0];
      const director = (await tx.query<{ name: string; brokerType: string | null }>(
        `SELECT o.full_name AS name, c.broker_type AS "brokerType"
           FROM onboarding_cases c
           LEFT JOIN onboarding_owners o ON o.case_id = c.id AND o.is_director
          WHERE c.id = $1
          ORDER BY o.created_at NULLS LAST LIMIT 1`, [id])).rows[0];
      const licence = (await tx.query<{ label: string; number: string | null; jurisdiction: string | null }>(
        `SELECT label, number, jurisdiction FROM compliance_items WHERE node_id = $1 AND kind = 'licence' ORDER BY created_at DESC LIMIT 1`,
        [c.nodeId])).rows[0];
      const cm = (await tx.query<{ id: string; name: string; email: string }>(
        `SELECT u.id, coalesce(nullif(btrim(u.display_name), ''), u.email::text) AS name, u.email::text AS email
           FROM app_users u
           JOIN user_node_roles r ON r.user_id = u.id AND r.role::text = 'compliance'
           JOIN org_reach o ON o.ancestor_id = r.node_id AND o.descendant_id = $2
          WHERE u.status::text <> 'disabled'
          ORDER BY (u.id = $1) DESC, u.email
          LIMIT 1`, [ctx.userId, c.nodeId])).rows[0];
      if (!cm) throw conflict('Add a Compliance Manager before sending the agreement. Their name is written into it.');
      const agaName = profile?.legalName?.trim() || c.partnerName;
      const province = typeof profile?.fields?.province === 'string' ? profile.fields.province.trim() : '';
      const city = typeof profile?.fields?.city === 'string' ? profile.fields.city.trim() : '';
      const corporate = director?.brokerType === 'corporate' || profile?.entityType === 'corporation' || profile?.entityType === 'llc' || profile?.entityType === 's_corp';
      const licenceText = licence ? [licence.label, licence.number, licence.jurisdiction].filter(Boolean).join(' · ') : blank;
      const kept = {
        advisor_name: '{{advisor_name}}', sign_day: '{{sign_day}}', sign_month: '{{sign_month}}', sign_year: '{{sign_year}}',
        cm_signed_name: '{{cm_signed_name}}', cm_sign_day: '{{cm_sign_day}}', cm_sign_month: '{{cm_sign_month}}', cm_sign_year: '{{cm_sign_year}}',
      };
      const agreementBody = fillAgreement(rawBody, {
        ...signDateParts(new Date()),
        ...kept,
        aga_name: agaName,
        aga_email: '{{aga_email}}',
        city: city || blank,
        province: province || blank,
        licence: licenceText,
        corporation_name: corporate ? (profile?.legalName?.trim() || c.partnerName) : 'N/A',
        officer_name: director?.name?.trim() || blank,
        officer_title: blank,
        cm_name: cm.name,
        cm_email: cm.email,
        cm_title: 'Compliance Manager',
      });
      if (c.stage !== 'agency_agreement_sent') {
        const block = stageMoveBlock(c.stage, 'agency_agreement_sent', c.standing ?? 'pending');
        if (block) throw conflict(block === 'standing_not_good' ? 'The agency agreement waits for a good-standing decision' : 'The agreement is sent after the standing is decided');
        await tx.query(`UPDATE onboarding_cases SET stage = 'agency_agreement_sent', updated_at = now() WHERE id = $1`, [id]);
        await audit(tx, ctx, 'onboarding.stage', 'onboarding_case', id, { to: 'agency_agreement_sent' });
      }
      await audit(tx, ctx, 'onboarding.agreement_sent', 'onboarding_case', id, { version, hash: agreementHash(title, agreementBody, version) });
      return { partnerName: c.partnerName, nodeId: c.nodeId, tenantId: c.tenantId, body: agreementBody, cm };
    });
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
    const to = await partnerEmails(deps.authPool, out.nodeId);
    const agreementBody = fillAgreement(out.body, { aga_email: to[0] ?? blank });
    await deps.authPool.query('DELETE FROM onboarding_signing_links WHERE case_id = $1 AND used_at IS NULL', [id]);
    await deps.authPool.query(
      `INSERT INTO onboarding_signing_links (tenant_id, case_id, node_id, created_by, title, body, version, token_hash, expires_at, cm_user_id, cm_name, cm_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [out.tenantId, id, out.nodeId, ctx.userId, title, agreementBody, version, tokenHash(token), expires, out.cm.id, out.cm.name, out.cm.email]);
    const url = `${deps.config.appOrigin}/sign/partner/${token}`;
    let emailed = false;
    if (deps.mailer && to.length > 0) {
      const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [out.tenantId])).rows[0]?.name ?? '';
      const msg = `${firm} has prepared “${title}” for ${out.partnerName}. Please read it and sign here:\n${url}\n\nThe link works for ${LINK_DAYS} days.`;
      for (const email of to) {
        try { await deps.mailer.send({ to: email, subject: `Please review and sign: ${title}`, text: msg, html: `<p>${esc(msg).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>` }); emailed = true; } catch { /* the officer can share the link */ }
      }
    }
    return { url, expiresAt: expires.toISOString(), emailed, signers: to.length };
  });

  /** The signed agreements for a case, newest first. Visibility follows the case (officer above the partner, and the partner itself). */
  app.get('/v1/onboarding/cases/:id/agreements', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    return run(ctx, async (tx) => {
      await loadCase(tx, id);
      const rows = (await tx.query(
        `SELECT id, title, version, typed_name AS "typedName", signed_at AS "signedAt" FROM onboarding_agreements WHERE case_id = $1 ORDER BY signed_at DESC`, [id])).rows;
      return { agreements: rows };
    });
  });

  /** The sealed PDF of one signed agreement. */
  app.get('/v1/onboarding/agreements/:agreementId/pdf', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const aid = (req.params as { agreementId: string }).agreementId;
    if (!UUID.test(aid)) throw notFound('Unknown agreement');
    const row = await run(ctx, async (tx) => (await tx.query<{ sealed: Buffer; title: string }>(
      'SELECT sealed_pdf AS sealed, title FROM onboarding_agreements WHERE id = $1', [aid])).rows[0]);
    if (!row) throw notFound('Unknown agreement');
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="${row.title.replace(/[^A-Za-z0-9 _-]/g, '')}.pdf"`).send(row.sealed);
  });

  // ---- The partner's signing page -------------------------------------------------------------------------------------

  /** The page the partner opens from the link. Same page as the client's, pointed at the partner routes. */
  app.get('/sign/partner/:token', async (_req, reply) => {
    const nonce = randomBytes(12).toString('base64');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
      .send(signPage(nonce, '/v1/public/partner-sign/'));
  });

  app.get('/v1/public/partner-sign/:token', async (req) => {
    const { token } = req.params as { token: string };
    const l = await linkFor(deps.authPool, token, true);
    const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [l.tenant_id])).rows[0]?.name ?? '';
    const emails = await partnerEmails(deps.authPool, l.node_id);
    const partnerName = (await deps.authPool.query<{ name: string }>('SELECT name FROM org_nodes WHERE id = $1', [l.node_id])).rows[0]?.name ?? '';
    return {
      firm, partnerName, clientName: partnerName, kind: { en: 'Agency agreement', 'fr-CA': 'Entente d’agence' },
      title: l.title, body: l.body, version: l.version, signed: !!l.used_at, agentSigned: !!l.agent_signed_at,
      emailHint: mask(emails[0] ?? null),
      codeSent: !!l.otp_hash && !!l.otp_expires_at && l.otp_expires_at.getTime() > Date.now(),
    };
  });

  app.post('/v1/public/partner-sign/:token/code', async (req) => {
    const { token } = req.params as { token: string };
    const l = await linkFor(deps.authPool, token);
    if (l.agent_signed_at) throw conflict('You have already signed. The compliance manager signs next.');
    if (l.sends >= MAX_SENDS) throw new HttpError(429, 'too_many_codes', 'Too many codes were sent. Ask your Compliance officer for a new link.');
    await withRequestTx(deps.appPool, actor(l), async (tx) => {
      const c = await loadCase(tx, l.case_id);
      if (c.stage !== 'agency_agreement_sent') throw conflict('This agreement is not waiting for a signature');
    });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deps.authPool.query(
      `UPDATE onboarding_signing_links SET otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, sends = sends + 1 WHERE id = $1`,
      [l.id, tokenHash(`${code}:${l.id}`), String(OTP_MINUTES)]);
    let sent = false;
    if (deps.mailer) {
      const msg = `Your confirmation code for “${l.title}” is ${code}. It expires in ${OTP_MINUTES} minutes. Enter it on the signing page only.`;
      for (const email of await partnerEmails(deps.authPool, l.node_id)) {
        try { await deps.mailer.send({ to: email, subject: `Your confirmation code: ${code}`, text: msg, html: `<p>${esc(msg)}</p>` }); sent = true; } catch { /* try the rest */ }
      }
    }
    return { sent, minutes: OTP_MINUTES, ...(deps.config.appEnv === 'test' ? { devCode: code } : {}) };
  });

  app.post('/v1/public/partner-sign/:token/confirm', async (req) => {
    const { token } = req.params as { token: string };
    const b = body(req);
    const code = typeof b.code === 'string' ? b.code : '';
    const typedName = text(b.typedName, 'Your full name', 200);
    if (b.agree !== true) throw invalid('Please confirm you have read the agreement and agree to sign it');
    const l = await linkFor(deps.authPool, token);
    if (!l.otp_hash || !l.otp_expires_at) throw new HttpError(409, 'not_awaiting', 'Ask for a code first.');
    if (l.otp_attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new code.');
    if (l.otp_expires_at.getTime() < Date.now()) throw new HttpError(409, 'code_expired', 'That code has expired. Ask for a new one.');
    if (!/^[0-9]{6}$/.test(code) || !timingSafeEqual(Buffer.from(tokenHash(`${code}:${l.id}`)), Buffer.from(l.otp_hash))) {
      await deps.authPool.query('UPDATE onboarding_signing_links SET otp_attempts = otp_attempts + 1 WHERE id = $1', [l.id]);
      throw new HttpError(422, 'wrong_code', 'That code is not right.');
    }
    const ctx = actor(l);
    const signedAt = new Date();
    const ip = (req.ip ?? null) as string | null;
    const agent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null;
    if (l.agent_signed_at) throw conflict('You have already signed. The compliance manager signs next.');
    await withRequestTx(deps.appPool, ctx, async (tx) => {
      const c = await loadCase(tx, l.case_id);
      if (c.stage !== 'agency_agreement_sent') throw conflict('This agreement is not waiting for the agent’s signature');
    });
    const signedBody = fillAgreement(l.body, { ...signDateParts(signedAt), advisor_name: typedName });
    await deps.authPool.query(
      `UPDATE onboarding_signing_links
          SET agent_signed_at = $2, agent_typed_name = $3, agent_signed_ip = $4, agent_signed_agent = $5, body = $6, otp_hash = NULL
        WHERE id = $1 AND agent_signed_at IS NULL`,
      [l.id, signedAt, typedName, ip, agent, signedBody]);
    if (deps.mailer && l.cm_email) {
      const msg = `${typedName} has signed “${l.title}”. Open PII, go to Compliance, then Onboarding, and sign it. You sign after the agent. Both of you receive a copy once you have signed.`;
      try { await deps.mailer.send({ to: l.cm_email, subject: `Please countersign: ${l.title}`, text: msg, html: `<p>${esc(msg)}</p>` }); } catch { /* the agreement is waiting in the app */ }
    }
    return { ok: true, waitingFor: 'compliance' };
  });

  /** Where the agreement stands: who has signed, and whether this person is the compliance manager who signs next. */
  app.get('/v1/onboarding/cases/:id/agreement-status', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    await run(ctx, async (tx) => { const c = await loadCase(tx, id); await requireOfficer(tx, c); });
    const link = (await deps.authPool.query<{ agent_signed_at: Date | null; used_at: Date | null; cm_user_id: string | null; cm_name: string | null; cm_email: string | null }>(
      `SELECT agent_signed_at, used_at, cm_user_id, cm_name, cm_email FROM onboarding_signing_links
        WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    const vault = await run(ctx, async (tx) => (await tx.query<{ id: string }>(
      'SELECT id FROM agreement_vault WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0]);
    return {
      sent: !!link,
      agentSigned: !!link?.agent_signed_at,
      fullySigned: !!link?.used_at,
      cmName: link?.cm_name ?? null,
      cmEmail: link?.cm_email ?? null,
      canCountersign: !!link?.agent_signed_at && !link.used_at && link.cm_user_id === ctx.userId,
      vaultId: vault?.id ?? null,
    };
  });

  /** The compliance manager named on the agreement signs second. Then both parties are sent a copy, and the vault keeps one. */
  app.post('/v1/onboarding/cases/:id/agreement/countersign', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = caseId((req.params as { id: string }).id);
    const b = body(req);
    const typedName = text(b.typedName, 'Your full name', 200);
    if (b.agree !== true) throw invalid('Please confirm you have read the agreement and agree to sign it');
    const link = (await deps.authPool.query<LinkRow>(
      `SELECT * FROM onboarding_signing_links WHERE case_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
    if (!link?.agent_signed_at || !link.agent_typed_name) throw conflict('The agent signs first');
    if (link.cm_user_id !== ctx.userId) throw forbidden('Only the compliance manager named on this agreement can sign it');
    const signedAt = new Date();
    const parts = signDateParts(signedAt);
    const signedBody = fillAgreement(link.body, {
      cm_signed_name: typedName, cm_sign_day: parts.sign_day, cm_sign_month: parts.sign_month, cm_sign_year: parts.sign_year,
    });
    const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [link.tenant_id])).rows[0]?.name ?? '';
    const agreementId = randomUUID();
    await run(ctx, async (tx) => {
      const c = await loadCase(tx, id);
      await requireOfficer(tx, c);
      if (c.stage !== 'agency_agreement_sent') throw conflict('This agreement is not waiting for the compliance manager');
      const pdf = await sealedPartnerAgreementPdf({
        firm, partnerName: c.partnerName, title: link.title, body: signedBody, version: link.version,
        typedName: link.agent_typed_name!, signedAt: link.agent_signed_at!, ip: null, agent: null,
        countersigner: { name: typedName, signedAt },
      });
      await tx.query(
        `INSERT INTO onboarding_agreements (id, tenant_id, case_id, node_id, title, body, version, body_hash, typed_name, signed_ip, signed_agent, signed_at, sealed_pdf, officer_name, officer_signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [agreementId, link.tenant_id, id, link.node_id, link.title, signedBody, link.version, agreementHash(link.title, signedBody, link.version),
          link.agent_typed_name, link.agent_signed_ip ?? null, link.agent_signed_agent ?? null, link.agent_signed_at, Buffer.from(pdf), typedName, signedAt]);
      if (deps.keys) {
        const sealed = seal(deps.keys, Buffer.from(pdf), `${link.tenant_id}:agreement-vault:${agreementId}`);
        await tx.query(
          `INSERT INTO agreement_vault (id, tenant_id, case_id, agreement_id, node_id, title, key_id, data_enc, plain_sha256)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [randomUUID(), link.tenant_id, id, agreementId, link.node_id, link.title, sealed.keyId, sealed.data, createHash('sha256').update(Buffer.from(pdf)).digest('hex')]);
      }
      await tx.query(`UPDATE onboarding_cases SET stage = 'agency_agreement_signed', updated_at = now() WHERE id = $1`, [id]);
      await audit(tx, ctx, 'onboarding.agreement_signed', 'onboarding_case', id, { version: link.version, by: 'agent_and_compliance' });
    });
    await deps.authPool.query('UPDATE onboarding_signing_links SET used_at = now(), body = $2 WHERE id = $1', [link.id, signedBody]);
    if (deps.mailer) {
      const partners = await partnerEmails(deps.authPool, link.node_id);
      const note = `“${link.title}” is signed by ${link.agent_typed_name} and ${typedName}. Open PII to download the signed copy. The compliance copy is kept in the agreement vault.`;
      for (const email of [...new Set([...partners, link.cm_email].filter((e): e is string => !!e))]) {
        try { await deps.mailer.send({ to: email, subject: `Signed copy: ${link.title}`, text: note, html: `<p>${esc(note)}</p>` }); } catch { /* the copy remains in PII */ }
      }
    }
    return { ok: true };
  });

  /** The encrypted compliance copy. A partner does not see these rows. */
  app.get('/v1/onboarding/agreement-vault', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const caseFilter = typeof (req.query as { caseId?: string }).caseId === 'string' ? (req.query as { caseId: string }).caseId : null;
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT id, case_id AS "caseId", title, created_at AS "createdAt" FROM agreement_vault
          ${caseFilter && UUID.test(caseFilter) ? 'WHERE case_id = $1' : ''} ORDER BY created_at DESC LIMIT 50`,
        caseFilter && UUID.test(caseFilter) ? [caseFilter] : [])).rows;
      return { agreements: rows };
    });
  });

  app.get('/v1/onboarding/agreement-vault/:vaultId/pdf', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const vaultId = (req.params as { vaultId: string }).vaultId;
    if (!UUID.test(vaultId)) throw notFound('Unknown agreement');
    if (!deps.keys) throw new HttpError(503, 'no_keys', 'The agreement vault cannot be opened without the encryption key');
    const row = await run(ctx, async (tx) => (await tx.query<{ key_id: string; data_enc: Buffer; title: string; agreement_id: string; tenant_id: string }>(
      'SELECT key_id, data_enc, title, agreement_id, tenant_id FROM agreement_vault WHERE id = $1', [vaultId])).rows[0]);
    if (!row) throw notFound('Unknown agreement');
    const pdf = open(deps.keys, { keyId: row.key_id, data: row.data_enc }, `${row.tenant_id}:agreement-vault:${row.agreement_id}`);
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="${row.title.replace(/[^A-Za-z0-9 _-]/g, '')}.pdf"`).send(pdf);
  });
}
