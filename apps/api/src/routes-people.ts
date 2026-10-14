import type { FastifyInstance } from 'fastify';
import { ORG_ROLES, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { newToken } from '@pii/platform';
import { audit } from './audit.ts';
import { hasAcceptedFirstLogin } from './routes-consent.ts';
import { HttpError, conflict, forbidden, invalid, notFound } from './errors.ts';
import { isDemoTenant } from './routes-demo.ts';
import type { AppDeps } from './app.ts';

const INVITE_DAYS = 7;

/** Admin on the node itself, or on any node that reaches it (location -> partner -> sub-partner). */
export async function isAdminAbove(tx: Tx, ctx: RequestContext, nodeId: string): Promise<boolean> {
  if (ctx.isTenantAdmin) return true;
  if (ctx.adminNodeIds.includes(nodeId)) return true;
  if (ctx.adminNodeIds.length === 0) return false;
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM org_reach WHERE descendant_id = $1 AND ancestor_id = ANY($2::uuid[])) AS ok`,
    [nodeId, ctx.adminNodeIds],
  );
  return rows[0]?.ok === true;
}

async function emailOf(tx: Tx, userId: string): Promise<string | null> {
  return (await tx.query<{ e: string }>('SELECT email::text AS e FROM app_users WHERE id = $1', [userId])).rows[0]?.e ?? null;
}

export function registerPeopleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.put('/v1/me/locale', { schema: { body: { type: 'object', required: ['locale'], additionalProperties: false, properties: { locale: { type: 'string', enum: ['en', 'fr-CA'] } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    await deps.authPool.query('UPDATE app_users SET locale = $2::locale_code WHERE id = $1', [ctx.userId, (req.body as { locale: string }).locale]);
    return reply.code(204).send();
  });

  app.get('/v1/me', async (req) => {
    const { ctx, user } = await deps.authenticate(req);
    const consented = await run(ctx, (tx) => hasAcceptedFirstLogin(tx, ctx));
    return {
      needsConsent: !consented,
      user: { id: user.userId, email: user.email, displayName: user.displayName, locale: user.locale },
      tenant: { id: user.tenantId, name: user.tenantName },
      region: deps.config.region,
      minExtension: process.env.MIN_EXT_VERSION ?? '0.0.0',
      supportEmail: deps.config.supportEmail,
      supportUrl: deps.config.supportUrl,
      termsUrl: deps.config.termsUrl,
      product: { name: deps.config.productDisplayName, logoUrl: `${deps.config.appOrigin}/brand/logo.png` },
      isTenantAdmin: ctx.isTenantAdmin,
      demo: await isDemoTenant(deps, user.tenantId),
      roles: ctx.roles,
      isHeadOffice: (await run(ctx, async (tx) => (await tx.query<{ h: boolean }>('SELECT app_is_head_office() AS h')).rows[0]!.h)),
      country: deps.config.region === 'us' ? 'US' : 'CA',
      canAdminister: ctx.isTenantAdmin || ctx.adminNodeIds.length > 0,
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
      const role = body.role ?? 'partner';
      if (role === 'learner') throw invalid('Learner is added automatically when someone takes a course; invite them as a Partner');
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
        await audit(tx, ctx, 'invitation_created', 'invitation', id, { email: body.email.trim().toLowerCase(), nodeId: body.nodeId, role }, body.nodeId);
        return { id, status: 'created', expiresAt: expiresAt.toISOString(), acceptUrl: `${deps.config.appOrigin}/accept?token=${token}` };
      });
      return reply.code(201).send(out);
    },
  );

  const STATUS_SQL = `CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.expires_at <= now() THEN 'expired' WHEN i.link_opened_at IS NOT NULL THEN 'opened'
                           WHEN i.sent_at IS NOT NULL THEN 'sent' WHEN i.delivery_error IS NOT NULL THEN 'not_sent' ELSE 'created' END`;
  const INVITE_COLS = `i.id, i.email::text AS email, i.node_id AS "nodeId", i.role::text AS role, i.locale::text AS locale, i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt",
        i.created_at AS "createdAt", i.sent_at AS "sentAt", i.delivery_method AS "deliveryMethod", i.delivery_error AS "deliveryError", i.gmail_thread_id AS "gmailThreadId", i.attempts, i.last_attempt_at AS "lastAttemptAt",
        i.link_opened_at AS "linkOpenedAt", coalesce(iu.display_name, iu.email::text) AS "invitedBy", i.invited_by AS "invitedById", ${STATUS_SQL} AS status`;

  app.get('/v1/invitations', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${INVITE_COLS} FROM invitations i LEFT JOIN app_users iu ON iu.id = i.invited_by
          WHERE i.accepted_at IS NULL OR i.accepted_at > now() - interval '30 days' ORDER BY i.created_at DESC`,
      );
      return { invitations: rows };
    });
  });

  async function loadInvite(tx: Tx, ctx: RequestContext, id: string) {
    const inv = (await tx.query<{ node_id: string; email: string; invited_by: string | null; accepted_at: string | null; attempts: number; last_attempt_at: string | null; role: string; locale: string }>(
      'SELECT node_id, email::text AS email, invited_by, accepted_at, attempts, last_attempt_at, role::text AS role, locale::text AS locale FROM invitations WHERE id = $1', [id])).rows[0];
    if (!inv) throw notFound('No invitation with that id');
    if (!(inv.invited_by === ctx.userId || (await isAdminAbove(tx, ctx, inv.node_id)))) throw forbidden();
    return inv;
  }

  // The extension (or the person copying the link) reports what happened when the invitation was sent.
  app.post('/v1/invitations/:id/delivery', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', required: ['method', 'ok'], additionalProperties: false, properties: { method: { enum: ['gmail', 'link'] }, ok: { type: 'boolean' }, error: { type: 'string', maxLength: 300 }, threadId: { type: 'string', pattern: '^[A-Za-z0-9_:-]{4,80}$' } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as { method: 'gmail' | 'link'; ok: boolean; error?: string; threadId?: string };
    await run(ctx, async (tx) => {
      const inv = await loadInvite(tx, ctx, id);
      if (inv.accepted_at) throw conflict('This person has already joined');
      await tx.query(
        `UPDATE invitations SET attempts = attempts + 1, last_attempt_at = now(), delivery_method = $2,
                sent_at = CASE WHEN $3 THEN now() ELSE sent_at END, sent_by = CASE WHEN $3 THEN $4::uuid ELSE sent_by END,
                delivery_error = CASE WHEN $3 THEN NULL ELSE $5 END, gmail_thread_id = CASE WHEN $3 AND $2 = 'gmail' THEN $6 ELSE gmail_thread_id END WHERE id = $1`,
        [id, b.method, b.ok, ctx.userId, b.error ?? 'Not sent', b.threadId ?? null],
      );
      await audit(tx, ctx, b.ok ? 'invitation_sent' : 'invitation_not_sent', 'invitation', id, { email: inv.email, method: b.method, ...(b.ok ? {} : { error: b.error ?? 'Not sent' }) }, inv.node_id);
    });
    return reply.code(204).send();
  });

  // A fresh link: the old one stops working and the state starts again.
  app.post('/v1/invitations/:id/resend', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const inv = await loadInvite(tx, ctx, id);
      if (inv.accepted_at) throw conflict('This person has already joined');
      if (inv.attempts >= 10) throw new HttpError(429, 'too_many', 'Too many attempts for this invitation. Withdraw it and invite again.');
      if (inv.last_attempt_at && Date.now() - new Date(inv.last_attempt_at).getTime() < 3000) throw new HttpError(429, 'too_fast', 'Please wait a moment before sending again.');
      const { token, hash } = newToken();
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
      await tx.query(
        `UPDATE invitations SET token_hash = $2, expires_at = $3, sent_at = NULL, sent_by = NULL, gmail_thread_id = NULL, link_opened_at = NULL, delivery_error = NULL, stale_notified_at = NULL, last_attempt_at = now() WHERE id = $1`,
        [id, hash, expiresAt],
      );
      await audit(tx, ctx, 'invitation_resent', 'invitation', id, { email: inv.email }, inv.node_id);
      return { id, status: 'created', expiresAt: expiresAt.toISOString(), acceptUrl: `${deps.config.appOrigin}/accept?token=${token}`, email: inv.email, role: inv.role, nodeId: inv.node_id, locale: inv.locale };
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

  // ---- People: who is where, change roles, switch someone off, withdraw an invitation ----
  app.get('/v1/org/members', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.node_id AS "nodeId", r.role::text AS role, u.id AS "userId", u.email::text AS email, u.display_name AS "displayName", u.status::text AS status
           FROM user_node_roles r JOIN app_users u ON u.id = r.user_id
          WHERE r.node_id IN (SELECT id FROM org_nodes) ORDER BY u.email`,
      );
      return { members: rows };
    });
  });

  const roleBody = { type: 'object', required: ['userId', 'nodeId', 'role'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' }, nodeId: { type: 'string', format: 'uuid' }, role: { type: 'string', enum: [...ORG_ROLES] } } } as const;

  async function mayManageRole(tx: Tx, ctx: RequestContext, nodeId: string, role: string): Promise<void> {
    const node = (await tx.query<{ type: string }>('SELECT type FROM org_nodes WHERE id = $1', [nodeId])).rows[0];
    if (!node) throw notFound('Unknown organization node');
    if (!(await isAdminAbove(tx, ctx, nodeId))) throw forbidden('You can only change roles in a branch you administer');
    if (role === 'admin' && !ctx.isTenantAdmin && node.type !== 'partner') throw forbidden('Only a company administrator can make someone an admin here');
  }

  app.post('/v1/org/members', { schema: { body: roleBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { userId: string; nodeId: string; role: string };
    await run(ctx, async (tx) => {
      await mayManageRole(tx, ctx, b.nodeId, b.role);
      if (!(await tx.query('SELECT 1 FROM app_users WHERE id = $1', [b.userId])).rowCount) throw notFound('Unknown person');
      await tx.query('INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [ctx.tenantId, b.userId, b.nodeId, b.role]);
      await audit(tx, ctx, 'role_added', 'user', b.userId, { nodeId: b.nodeId, role: b.role, email: await emailOf(tx, b.userId) }, b.nodeId);
    });
    return reply.code(204).send();
  });

  app.delete('/v1/org/members', { schema: { querystring: roleBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.query as { userId: string; nodeId: string; role: string };
    await run(ctx, async (tx) => {
      await mayManageRole(tx, ctx, b.nodeId, b.role);
      const root = (await tx.query<{ id: string }>(`SELECT id FROM org_nodes WHERE type = 'tenant'`)).rows[0]!.id;
      if (b.role === 'admin' && b.nodeId === root) {
        const n = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM user_node_roles WHERE node_id = $1 AND role = 'admin'`, [root])).rows[0]!.n;
        if (n <= 1) throw invalid('The company needs at least one administrator');
      }
      const r = await tx.query('DELETE FROM user_node_roles WHERE user_id = $1 AND node_id = $2 AND role = $3', [b.userId, b.nodeId, b.role]);
      if (!r.rowCount) throw notFound('No such role');
      await audit(tx, ctx, 'role_removed', 'user', b.userId, { nodeId: b.nodeId, role: b.role, email: await emailOf(tx, b.userId) }, b.nodeId);
    });
    return reply.code(204).send();
  });

  app.patch('/v1/users/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { enum: ['active', 'disabled'] } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    if (id === ctx.userId) throw invalid('You cannot switch yourself off');
    const { status } = req.body as { status: 'active' | 'disabled' };
    await run(ctx, async (tx) => {
      const u = (await tx.query<{ home: string; status: string }>('SELECT home_node_id AS home, status::text AS status FROM app_users WHERE id = $1', [id])).rows[0];
      if (!u) throw notFound('Unknown person');
      if (u.status === 'invited') throw invalid('This person has not signed in yet; withdraw the invitation instead');
      if (!(await isAdminAbove(tx, ctx, u.home))) throw forbidden('You can only manage people in a branch you administer');
      await tx.query('UPDATE app_users SET status = $2 WHERE id = $1', [id, status]);
      await audit(tx, ctx, status === 'disabled' ? 'user_disabled' : 'user_enabled', 'user', id, { email: await emailOf(tx, id) }, u.home);
    });
    return reply.code(204).send();
  });

  app.delete('/v1/invitations/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const inv = (await tx.query<{ node_id: string; email: string }>('SELECT node_id, email::text AS email FROM invitations WHERE id = $1 AND accepted_at IS NULL', [id])).rows[0];
      if (!inv) throw notFound('No pending invitation with that id');
      if (!(await isAdminAbove(tx, ctx, inv.node_id))) throw forbidden();
      await tx.query('DELETE FROM invitations WHERE id = $1', [id]);
      await audit(tx, ctx, 'invitation_withdrawn', 'invitation', id, { email: inv.email }, inv.node_id);
    });
    return reply.code(204).send();
  });
}

