import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '@pii/platform';
import { assertDeployment, type Db } from '@pii/db';
import type { Authenticator, Identity } from './auth.ts';
import type { GoogleClient } from './google.ts';
import { HttpError, mapDbError } from './errors.ts';
import { registerOrgRoutes } from './routes-org.ts';
import { registerPeopleRoutes } from './routes-people.ts';
import { registerPipelineRoutes } from './routes-pipelines.ts';
import { registerBoxRoutes } from './routes-boxes.ts';
import { registerContactRoutes } from './routes-contacts.ts';
import { registerNoteRoutes } from './routes-notes.ts';
import { registerAuthRoutes, originGuard } from './routes-auth.ts';
import { registerConsentRoutes, hasAcceptedFirstLogin } from './routes-consent.ts';
import { withRequestTx } from '@pii/db';

export interface AppDeps {
  config: Config;
  appPool: Db;
  authenticate: Authenticator;
  /** Pool for the narrow auth role (sessions, login lookup, invitation acceptance). */
  authPool: Db;
  google?: GoogleClient;
}

export function buildApp(input: AppDeps): FastifyInstance {
  // Authenticate once per request, however many times handlers and hooks ask.
  const memo = new WeakMap<object, Promise<Identity>>();
  const deps: AppDeps = {
    ...input,
    authenticate: (req) => {
      let p = memo.get(req);
      if (!p) { p = input.authenticate(req); memo.set(req, p); }
      return p;
    },
  };
  const app = Fastify({
    ajv: { customOptions: { allowUnionTypes: true } },
    logger: deps.config.appEnv === 'test' ? false : {
      level: deps.config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-dev-user-email"]'],
      // Never log query strings: sign-in callbacks and invitation links carry one-time codes.
      serializers: { req: (r: { method: string; url: string; host?: string }) => ({ method: r.method, url: r.url.split('?')[0], host: r.host }) },
    },
  });

  app.setErrorHandler((err, req, reply) => {
    const mapped = err instanceof HttpError ? err : mapDbError(err);
    if (mapped) return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } });
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: { code: 'bad_request', message: e.message } });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      const d = await assertDeployment(deps.appPool, deps.config.region);
      return { ok: true, region: d.region, environment: d.environment, physicalRegionVerified: d.verified };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  app.addHook('preHandler', originGuard(deps));
  // People must accept the first-login notice before using anything else (Law 25 / PIPEDA).
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/v1/') || path === '/v1/me' || path.startsWith('/v1/consent/')) return;
    const id = await deps.authenticate(req);
    const ok = await withRequestTx(deps.appPool, id.ctx, (tx) => hasAcceptedFirstLogin(tx, id.ctx));
    if (!ok) throw new HttpError(403, 'consent_required', 'Please review and accept the privacy notice first');
  });

  registerAuthRoutes(app, deps);
  registerConsentRoutes(app, deps);
  registerOrgRoutes(app, deps);
  registerPeopleRoutes(app, deps);
  registerPipelineRoutes(app, deps);
  registerBoxRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerNoteRoutes(app, deps);
  return app;
}
