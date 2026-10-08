import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createSession } from '@pii/db';
import { serializeCookie } from '@pii/platform';
import { SESSION_COOKIE } from './routes-auth.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const DEMO_SESSION_MINUTES = 12 * 60;
const hashToken = (t: string) => createHash('sha256').update(t).digest();
const uuid = { type: 'string', format: 'uuid' } as const;

/** Writes that make no sense in a demo, or would reach outside it. Reads are unaffected. */
const BLOCKED = ['/v1/invitations', '/v1/api-keys', '/v1/privacy', '/v1/mail', '/v1/ai', '/v1/merges', '/v1/embed-token', '/v1/hooks'];

const cache = new Map<string, { v: boolean; at: number }>();
export async function isDemoTenant(deps: AppDeps, tenantId: string): Promise<boolean> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const { rows } = await deps.authPool.query<{ is_demo: boolean }>('SELECT is_demo FROM tenants WHERE id = $1', [tenantId]);
  const v = rows[0]?.is_demo === true;
  cache.set(tenantId, { v, at: Date.now() });
  return v;
}

export function registerDemoRoutes(app: FastifyInstance, deps: AppDeps): void {
  const secure = deps.config.appOrigin.startsWith('https://');
  const cookie = (token: string) => serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: DEMO_SESSION_MINUTES * 60, secure });
  const audit = (tenantId: string, actor: string | null, action: string, entityId: string | null, detail: Record<string, unknown>) =>
    deps.authPool.query(`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,'demo_invite',$4,$5)`, [tenantId, actor, action, entityId, JSON.stringify(detail)]);

  // Demo sessions may look at everything and change the demo data, but cannot send mail, invite real people, mint keys or call AI.
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const path = req.url.split('?')[0]!;
    if (!BLOCKED.some((p) => path === p || path.startsWith(`${p}/`))) return;
    let id;
    try { id = await deps.authenticate(req); } catch { return; }
    if (await isDemoTenant(deps, id.ctx.tenantId)) throw forbidden('Not available in the demo');
  });

  // Opening a private link signs the visitor in to the demo tenant as its admin. No Google account is involved.
  app.get('/demo', async (req, reply) => {
    const token = (req.query as { invite?: string }).invite ?? '';
    const bad = () => reply.redirect(`${deps.config.appOrigin}/login?error=demo_invite`, 302);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return bad();
    const { rows } = await deps.authPool.query<{ id: string; tenant_id: string; label: string }>(
      `UPDATE demo_invites i SET uses = i.uses + 1, last_used_at = now()
         FROM tenants t
        WHERE i.token_hash = $1 AND t.id = i.tenant_id AND t.is_demo AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
        RETURNING i.id, i.tenant_id, i.label`,
      [hashToken(token)],
    );
    const inv = rows[0];
    if (!inv) return bad();
    const u = (await deps.authPool.query<{ id: string }>(
      `SELECT u.id FROM app_users u JOIN user_node_roles r ON r.user_id = u.id AND r.role = 'admin'
        WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY u.created_at LIMIT 1`, [inv.tenant_id])).rows[0];
    if (!u) return bad();
    const session = await createSession(deps.authPool, inv.tenant_id, u.id, DEMO_SESSION_MINUTES);
    await audit(inv.tenant_id, u.id, 'demo_link_used', inv.id, { label: inv.label });
    reply.header('set-cookie', cookie(session));
    return reply.redirect(`${deps.config.appOrigin}/?signed_in=1&demo=1`, 302);
  });

  // The people a visitor can become inside the demo.
  app.get('/v1/demo/personas', async (req) => {
    const { ctx } = await deps.authenticate(req);
    if (!(await isDemoTenant(deps, ctx.tenantId))) throw notFound();
    const { rows } = await deps.authPool.query(
      `SELECT u.id, u.display_name AS name, u.locale::text AS locale, r.role::text AS role, n.name AS "nodeName"
         FROM app_users u
         JOIN LATERAL (SELECT role FROM user_node_roles WHERE user_id = u.id ORDER BY role LIMIT 1) r ON true
         JOIN org_nodes n ON n.id = u.home_node_id
        WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY n.type, n.name, u.display_name`, [ctx.tenantId]);
    return { current: ctx.userId, personas: rows };
  });

  app.post('/v1/demo/switch', { schema: { body: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    if (!(await isDemoTenant(deps, ctx.tenantId))) throw notFound();
    const target = (req.body as { userId: string }).userId;
    const ok = (await deps.authPool.query(`SELECT 1 FROM app_users WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [target, ctx.tenantId])).rowCount === 1;
    if (!ok) throw notFound();
    const session = await createSession(deps.authPool, ctx.tenantId, target, DEMO_SESSION_MINUTES);
    reply.header('set-cookie', cookie(session));
    return reply.code(204).send();
  });

  // Head-office administrators manage the links. The demo tenant belongs to this deployment, not to them.
  const requireOperator = async (req: Parameters<typeof deps.authenticate>[0]) => {
    const { ctx, user } = await deps.authenticate(req);
    const ho = (await deps.authPool.query<{ h: boolean }>('SELECT is_head_office AS h FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.h === true;
    if (!ho || !ctx.isTenantAdmin) throw forbidden('Only head-office administrators manage demo access');
    const demo = (await deps.authPool.query<{ id: string }>('SELECT id FROM tenants WHERE is_demo LIMIT 1')).rows[0];
    return { ctx, user, demoTenantId: demo?.id ?? null };
  };

  app.get('/v1/demo/invites', async (req) => {
    const { demoTenantId } = await requireOperator(req);
    if (!demoTenantId) return { available: false, invites: [] };
    const { rows } = await deps.authPool.query(
      `SELECT id, label, created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt", uses, max_uses AS "maxUses", last_used_at AS "lastUsedAt"
         FROM demo_invites WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [demoTenantId]);
    return { available: true, invites: rows };
  });

  app.post('/v1/demo/invites', { schema: { body: { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', minLength: 1, maxLength: 80 }, days: { type: 'integer', minimum: 1, maximum: 30 }, maxUses: { type: 'integer', minimum: 1, maximum: 1000 } } } } }, async (req, reply) => {
    const { ctx, demoTenantId } = await requireOperator(req);
    if (!demoTenantId) throw invalid('This deployment has no demo tenant');
    const b = req.body as { label: string; days?: number; maxUses?: number };
    const token = randomBytes(32).toString('base64url');
    const row = (await deps.authPool.query<{ id: string }>(
      `INSERT INTO demo_invites (tenant_id, token_hash, label, created_by, expires_at, max_uses) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6) RETURNING id`,
      [demoTenantId, hashToken(token), b.label.trim(), ctx.userId, b.days ?? 7, b.maxUses ?? 50])).rows[0]!;
    await audit(demoTenantId, null, 'demo_link_created', row.id, { label: b.label.trim(), by: ctx.userId });
    return reply.code(201).send({ id: row.id, url: `${deps.config.appOrigin}/demo?invite=${token}` });
  });

  app.delete('/v1/demo/invites/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const { demoTenantId } = await requireOperator(req);
    if (!demoTenantId) throw notFound();
    const id = (req.params as { id: string }).id;
    const r = await deps.authPool.query(`UPDATE demo_invites SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [id, demoTenantId]);
    if (r.rowCount !== 1) throw notFound();
    await audit(demoTenantId, null, 'demo_link_revoked', id, {});
    return reply.code(204).send();
  });
}
