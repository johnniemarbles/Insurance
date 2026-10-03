import type { FastifyInstance } from 'fastify';
import { ORG_ROLES, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { newToken } from '@pii/platform';
import { audit } from './audit.ts';
import { forbidden, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const INVITE_DAYS = 7;

/** Admin on the node itself, or on any node that reaches it (location -> partner -> sub-partner). */
async function isAdminAbove(tx: Tx, ctx: RequestContext, nodeId: string): Promise<boolean> {
  if (ctx.isTenantAdmin) return true;
  if (ctx.adminNodeIds.includes(nodeId)) return true;
  if (ctx.adminNodeIds.length === 0) return false;
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM org_reach WHERE descendant_id = $1 AND ancestor_id = ANY($2::uuid[])) AS ok`,
    [nodeId, ctx.adminNodeIds],
  );
  return rows[0]?.ok === true;
}

export function registerPeopleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.get('/v1/me', async (req) => {
    const { ctx, user } = await deps.authenticate(req);
    return {
      user: { id: user.userId, email: user.email, displayName: user.displayName, locale: user.locale },
      tenant: { id: user.tenantId, name: user.tenantName },
      region: deps.config.region,
      product: { name: deps.config.productDisplayName, logoUrl: `${deps.config.appOrigin}/brand/logo.png` },
      isTenantAdmin: ctx.isTenantAdmin,
      roles: ctx.roles,
    };
  });

  app.get('/v1/users', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, email::text AS email, display_name AS "displayName", status::text AS status, home_node_id AS "homeNodeId" FROM app_users ORDER BY email`,
      );
      return { users: rows };
    });
  });

  app.post(
    '/v1/invitations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'nodeId'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            nodeId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: [...ORG_ROLES] },
            locale: { type: 'string', enum: ['en', 'fr-CA'] },
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const body = req.body as { email: string; nodeId: string; role?: string; locale?: string };
      const role = body.role ?? 'member';
      const out = await run(ctx, async (tx) => {
        const node = await tx.query<{ type: string }>('SELECT type FROM org_nodes WHERE id = $1', [body.nodeId]);
        if (!node.rows[0]) throw notFound('Unknown organization node');
        if (node.rows[0].type === 'tenant' && !ctx.isTenantAdmin) throw forbidden();
        if (!(await isAdminAbove(tx, ctx, body.nodeId))) throw forbidden('You can only invite people into a branch you administer');
        if (role === 'admin' && !ctx.isTenantAdmin && node.rows[0].type === 'location') throw forbidden('Only a tenant admin can add a location admin');
        const { token, hash } = newToken();
        const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO invitations (tenant_id, email, node_id, role, locale, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [ctx.tenantId, body.email.trim().toLowerCase(), body.nodeId, role, body.locale ?? 'en', hash, ctx.userId, expiresAt],
        );
        const id = rows[0]!.id;
        await audit(tx, ctx, 'invitation_created', 'invitation', id, { nodeId: body.nodeId, role });
        return { id, expiresAt: expiresAt.toISOString(), acceptUrl: `${deps.config.appOrigin}/accept?token=${token}` };
      });
      return reply.code(201).send(out);
    },
  );

  app.get('/v1/invitations', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, email::text AS email, node_id AS "nodeId", role::text AS role, expires_at AS "expiresAt", accepted_at AS "acceptedAt" FROM invitations ORDER BY expires_at DESC`,
      );
      return { invitations: rows };
    });
  });

  app.get('/v1/audit', async (req) => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin) throw forbidden();
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, actor_user_id AS "actorUserId", action, entity_type AS "entityType", entity_id AS "entityId", detail, created_at AS "createdAt"
           FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 200`,
      );
      return { events: rows };
    });
  });
}

