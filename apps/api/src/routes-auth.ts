import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSession, deleteSession, signInWithGoogle, EMBED_TOKEN_MINUTES } from '@pii/db';
import { parseCookies, serializeCookie, signValue, verifySigned } from '@pii/platform';
import { pkce } from './google.ts';
import { HttpError } from './errors.ts';
import type { AppDeps } from './app.ts';

export const SESSION_COOKIE = 'pii_session';
const FLOW_COOKIE = 'pii_flow';
const SESSION_SECONDS = 14 * 86_400;

export const sessionCookie = (deps: AppDeps, token: string) =>
  serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_SECONDS, secure: deps.config.appOrigin.startsWith('https://') });
const clearCookie = (deps: AppDeps, name: string) => serializeCookie(name, '', { maxAgeSeconds: 0, secure: deps.config.appOrigin.startsWith('https://') });

function fail(deps: AppDeps, reply: FastifyReply, reason: string) {
  reply.header('set-cookie', clearCookie(deps, FLOW_COOKIE));
  return reply.redirect(`${deps.config.appOrigin}/login?error=${encodeURIComponent(reason)}`, 302);
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const google = deps.google;
  const secret = deps.config.cookieSecret;
  if (!google || !secret) return; // Google sign-in not configured (dev header auth only)
  const redirectUri = `${deps.config.appOrigin}/auth/google/callback`;

  app.get('/auth/google/start', async (req, reply) => {
    const q = req.query as { invite?: string; tenant?: string; hint?: string };
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const { verifier, challenge } = pkce();
    const flow = JSON.stringify({ s: state, n: nonce, v: verifier, i: q.invite ?? null, t: q.tenant ?? null });
    reply.header('set-cookie', serializeCookie(FLOW_COOKIE, signValue(secret, Buffer.from(flow).toString('base64url')), {
      maxAgeSeconds: 600,
      secure: deps.config.appOrigin.startsWith('https://'),
    }));
    return reply.redirect(google.authUrl({ state, nonce, codeChallenge: challenge, redirectUri, loginHint: q.hint }), 302);
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code || !q.state) return fail(deps, reply, 'cancelled');
    const raw = verifySigned(secret, parseCookies(req.headers.cookie)[FLOW_COOKIE]);
    if (!raw) return fail(deps, reply, 'expired');
    const flow = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { s: string; n: string; v: string; i: string | null; t: string | null };
    if (flow.s !== q.state) return fail(deps, reply, 'state');
    let profile;
    try {
      profile = await google.exchange({ code: q.code, codeVerifier: flow.v, redirectUri, nonce: flow.n });
    } catch (err) {
      req.log.warn({ err }, 'google exchange failed');
      return fail(deps, reply, 'google');
    }
    if (!profile.emailVerified) return fail(deps, reply, 'email_not_verified');
    const result = await signInWithGoogle(deps.authPool, { sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture }, { inviteToken: flow.i ?? undefined, tenantId: flow.t ?? undefined });
    if (!result.ok) return fail(deps, reply, result.reason);
    const token = await createSession(deps.authPool, result.user.tenantId, result.user.userId);
    reply.header('set-cookie', [sessionCookie(deps, token), clearCookie(deps, FLOW_COOKIE)]);
    return reply.redirect(`${deps.config.appOrigin}/?signed_in=1${result.accepted ? '&welcome=1' : ''}`, 302);
  });

  // A short-lived token for the screens the extension shows inside Gmail. Only a cookie sign-in can ask for one, so a token cannot mint another.
  app.post('/v1/embed-token', async (req, reply) => {
    if (!parseCookies(req.headers.cookie)[SESSION_COOKIE]) throw new HttpError(403, 'cookie_required', 'Sign in to PII first');
    const { user } = await deps.authenticate(req);
    const token = await createSession(deps.authPool, user.tenantId, user.userId, EMBED_TOKEN_MINUTES);
    return reply.header('cache-control', 'no-store').send({ token, expiresInSeconds: EMBED_TOKEN_MINUTES * 60 });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await deleteSession(deps.authPool, token);
    reply.header('set-cookie', clearCookie(deps, SESSION_COOKIE));
    return reply.code(204).send();
  });
}

/** Cross-site request forgery guard for cookie sessions: state-changing requests must come from our own origin. */
export function originGuard(deps: AppDeps) {
  return async (req: FastifyRequest) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (!parseCookies(req.headers.cookie)[SESSION_COOKIE]) return; // not cookie-authenticated
    const origin = req.headers.origin;
    if (origin !== deps.config.appOrigin && !deps.config.extensionOrigins.includes(origin ?? '')) {
      throw new HttpError(403, 'bad_origin', 'Request origin not allowed');
    }
  };
}
