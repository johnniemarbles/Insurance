import type { AiClient } from './ai.ts';
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
import type { KeyProvider } from '@pii/platform';
import { registerPageRoutes } from './routes-pages.ts';
import { registerThreadRoutes } from './routes-threads.ts';
import { registerNoteRoutes } from './routes-notes.ts';
import { registerLmsRoutes } from './routes-lms.ts';
import { registerInsightRoutes } from './routes-insights.ts';
import { registerAutomationRoutes } from './routes-automation.ts';
import { registerIntegrationRoutes } from './routes-integrations.ts';
import { registerMergeRoutes } from './routes-merge.ts';
import { registerAiRoutes } from './routes-ai.ts';
import { registerSettingRoutes } from './routes-settings.ts';
import { registerNavRoutes } from './routes-nav.ts';
import { registerNotificationRoutes } from './routes-notifications.ts';
import { registerPrivacyRoutes } from './routes-privacy.ts';
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
  /** Encryption keys for linked email content. Absent: linking is refused (503). */
  keys?: KeyProvider;
  /** AI text service. Absent: AI features answer 503. */
  ai?: AiClient;
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

  // Some tools (Jotform, Wufoo, plain HTML forms) post form-encoded data to a capture link; nothing else accepts it.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 40_000 }, (req, body, done) => {
    if (!req.url.startsWith('/v1/hooks/') && !req.url.startsWith('/u/')) return done(new HttpError(415, 'unsupported_media_type', 'Send JSON'), undefined);
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (e) { done(e as Error, undefined); }
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
    if (!path.startsWith('/v1/') || path === '/v1/me' || path.startsWith('/v1/consent/') || path.startsWith('/v1/hooks/')) return;
    const id = await deps.authenticate(req);
    const ok = await withRequestTx(deps.appPool, id.ctx, (tx) => hasAcceptedFirstLogin(tx, id.ctx));
    if (!ok) throw new HttpError(403, 'consent_required', 'Please review and accept the privacy notice first');
  });

  registerPageRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerConsentRoutes(app, deps);
  registerOrgRoutes(app, deps);
  registerPeopleRoutes(app, deps);
  registerPipelineRoutes(app, deps);
  registerBoxRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerNoteRoutes(app, deps);
  registerThreadRoutes(app, deps);
  registerLmsRoutes(app, deps);
  registerInsightRoutes(app, deps);
  registerAutomationRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerMergeRoutes(app, deps);
  registerAiRoutes(app, deps);
  registerSettingRoutes(app, deps);
  registerNavRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerPrivacyRoutes(app, deps);
  return app;
}
