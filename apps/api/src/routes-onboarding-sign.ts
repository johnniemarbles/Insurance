// Partner agency agreement signing. The Compliance officer sends the agreement once the standing is good; the partner signs
// through a private link, with a one-time code emailed to the partner's people. The signed agreement and its sealed PDF are kept
// with the onboarding case. Separate from client advice signing (routes-sign.ts), which is tied to client boxes and consents.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { OTP_MAX_ATTEMPTS, OTP_MINUTES, stageMoveBlock, type OnboardingStage, type RequestContext, type StandingOutcome } from '@pii/domain';
import { audit } from './audit.ts';
import { actingAs } from './effects.ts';
import { conflict, forbidden, invalid, notFound, HttpError } from './errors.ts';
import { agreementHash, sealedPartnerAgreementPdf } from './partner-agreement-pdf.ts';
import { blank, fillAgreement, signDateParts } from './aga-agreement.ts';
import { signPage } from './routes-sign.ts';
import type { AppDeps } from './app.ts';

const LINK_DAYS = 7;
const MAX_SENDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tokenHash = (t: string) => createHash('sha256').update(t).digest();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '');
const MAX_BODY = 60_000;

interface CaseRow { id: string; tenantId: string; nodeId: string; stage: OnboardingStage; standing: StandingOutcome | null; partnerName: string }
interface LinkRow {
  id: string; tenant_id: string; case_id: string; node_id: string; created_by: string; title: string; body: string; version: string;
  expires_at: Date; otp_hash: Buffer | null; otp_expires_at: Date | null; otp_attempts: number; sends: number; used_at: Date | null;
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
      const agaName = c.partnerName;
      const province = typeof profile?.fields?.province === 'string' ? profile.fields.province.trim() : '';
      const city = typeof profile?.fields?.city === 'string' ? profile.fields.city.trim() : '';
      const corporate = director?.brokerType === 'corporate' || profile?.entityType === 'corporation' || profile?.entityType === 'llc' || profile?.entityType === 's_corp';
      const agreementBody = fillAgreement(rawBody, {
        ...signDateParts(new Date()),
        aga_name: agaName,
        city: city || blank,
        province: province || blank,
        corporation_name: corporate ? (profile?.legalName?.trim() || c.partnerName) : 'N/A',
        officer_name: director?.name?.trim() || blank,
        officer_title: blank,
        advisor_name: '{{advisor_name}}',
        sign_day: '{{sign_day}}',
        sign_month: '{{sign_month}}',
        sign_year: '{{sign_year}}',
      });
      if (c.stage !== 'agency_agreement_sent') {
        const block = stageMoveBlock(c.stage, 'agency_agreement_sent', c.standing ?? 'pending');
        if (block) throw conflict(block === 'standing_not_good' ? 'The agency agreement waits for a good-standing decision' : 'The agreement is sent after the standing is decided');
        await tx.query(`UPDATE onboarding_cases SET stage = 'agency_agreement_sent', updated_at = now() WHERE id = $1`, [id]);
        await audit(tx, ctx, 'onboarding.stage', 'onboarding_case', id, { to: 'agency_agreement_sent' });
      }
      await audit(tx, ctx, 'onboarding.agreement_sent', 'onboarding_case', id, { version, hash: agreementHash(title, agreementBody, version) });
      return { partnerName: c.partnerName, nodeId: c.nodeId, tenantId: c.tenantId, body: agreementBody };
    });
    // A fresh link replaces any unused one for this case.
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await deps.authPool.query('DELETE FROM onboarding_signing_links WHERE case_id = $1 AND used_at IS NULL', [id]);
    await deps.authPool.query(
      `INSERT INTO onboarding_signing_links (tenant_id, case_id, node_id, created_by, title, body, version, token_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [out.tenantId, id, out.nodeId, ctx.userId, title, out.body, version, tokenHash(token), expires]);
    const url = `${deps.config.appOrigin}/sign/partner/${token}`;
    const to = await partnerEmails(deps.authPool, out.nodeId);
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
      title: l.title, body: l.body, version: l.version, signed: !!l.used_at,
      emailHint: mask(emails[0] ?? null),
      codeSent: !!l.otp_hash && !!l.otp_expires_at && l.otp_expires_at.getTime() > Date.now(),
    };
  });

  app.post('/v1/public/partner-sign/:token/code', async (req) => {
    const { token } = req.params as { token: string };
    const l = await linkFor(deps.authPool, token);
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
    const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [l.tenant_id])).rows[0]?.name ?? '';
    await withRequestTx(deps.appPool, ctx, async (tx) => {
      const c = await loadCase(tx, l.case_id);
      if (c.stage !== 'agency_agreement_sent') throw conflict('This agreement has already been signed');
      const signedBody = fillAgreement(l.body, { ...signDateParts(signedAt), advisor_name: typedName });
      const pdf = await sealedPartnerAgreementPdf({
        firm, partnerName: c.partnerName, title: l.title, body: signedBody, version: l.version, typedName, signedAt, ip, agent,
      });
      await tx.query(
        `INSERT INTO onboarding_agreements (tenant_id, case_id, node_id, title, body, version, body_hash, typed_name, signed_ip, signed_agent, signed_at, sealed_pdf)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [l.tenant_id, l.case_id, l.node_id, l.title, signedBody, l.version, agreementHash(l.title, signedBody, l.version), typedName, ip, agent, signedAt, Buffer.from(pdf)]);
      await tx.query(`UPDATE onboarding_cases SET stage = 'agency_agreement_signed', updated_at = now() WHERE id = $1`, [l.case_id]);
      await audit(tx, ctx, 'onboarding.agreement_signed', 'onboarding_case', l.case_id, { version: l.version });
    });
    await deps.authPool.query('UPDATE onboarding_signing_links SET used_at = now(), otp_hash = NULL WHERE id = $1', [l.id]);
    return { ok: true };
  });
}
