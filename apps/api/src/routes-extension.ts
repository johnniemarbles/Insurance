// The Gmail extension reports its install when someone signs in to it. The server keeps one row per person and extension ID,
// and the first install is recorded on that person's partner onboarding cases.
import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import type { AppDeps } from './app.ts';

const EXTENSION_ID = /^[a-p]{32}$/;

export function registerExtensionRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/extension/check-in', {
    schema: {
      body: {
        type: 'object',
        required: ['extensionId', 'version'],
        additionalProperties: false,
        properties: {
          extensionId: { type: 'string', pattern: '^[a-p]{32}$' },
          version: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { extensionId: string; version: string };
    if (!EXTENSION_ID.test(b.extensionId)) return reply.code(400).send({ error: { code: 'invalid', message: 'Unknown extension ID' } });
    await withRequestTx(deps.appPool, ctx, (tx) => tx.query(
      `INSERT INTO extension_installs (tenant_id, user_id, extension_id, version) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, extension_id) DO UPDATE SET version = EXCLUDED.version, last_seen_at = now()`,
      [ctx.tenantId, ctx.userId, b.extensionId, b.version],
    ));
    // The first install is recorded on the partner's onboarding cases (the auth pool, like the sign-in does).
    await deps.authPool.query(
      `UPDATE onboarding_cases SET extension_installed_at = now()
        WHERE extension_installed_at IS NULL AND tenant_id = $1
          AND node_id IN (SELECT node_id FROM user_node_roles WHERE user_id = $2)`,
      [ctx.tenantId, ctx.userId],
    );
    return reply.code(204).send();
  });
}
