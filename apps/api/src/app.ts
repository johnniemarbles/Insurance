import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '@pii/platform';
import { assertDeployment, type Db } from '@pii/db';
import type { Authenticator } from './auth.ts';
import { HttpError, mapDbError } from './errors.ts';
import { registerOrgRoutes } from './routes-org.ts';
import { registerPeopleRoutes } from './routes-people.ts';

export interface AppDeps {
  config: Config;
  appPool: Db;
  authenticate: Authenticator;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.config.appEnv === 'test' ? false : { level: deps.config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-dev-user-email"]'] },
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

  registerOrgRoutes(app, deps);
  registerPeopleRoutes(app, deps);
  return app;
}
