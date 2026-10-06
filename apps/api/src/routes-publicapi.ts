import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createApiKey, findApiKeyUser, listApiKeys, revokeApiKey, withRequestTx } from '@pii/db';
import { candidateToIdentity, type Identity } from './auth.ts';
import { audit } from './audit.ts';
import { forbidden, HttpError, invalid, notFound, unauthorized } from './errors.ts';
import { managerNodeIds, requireCrm, uuid } from './crm-helpers.ts';
import { hasAcceptedFirstLogin } from './routes-consent.ts';
import type { AppDeps } from './app.ts';

const MAX_KEYS = 5;

/**
 * Public API: read-only, for Zapier, spreadsheets and reporting tools.
 * - A key acts as the person who made it and sees exactly what that person sees (same row-level rules as the app).
 * - Keys are accepted ONLY on /v1/public/*. Nothing else in the API honours them, and they can never write.
 * - Writing into PII from other tools already has its own door: the capture webhooks on each pipeline.
 */
export function registerPublicApiRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: Identity['ctx'], fn: Parameters<typeof withRequestTx<T>>[2]) => withRequestTx(deps.appPool, ctx, fn);

  // ---- managing your own keys (signed in with the normal session) ----
  const mayMake = (ctx: Identity['ctx']) => ctx.isTenantAdmin || managerNodeIds(ctx).length > 0;

  app.get('/v1/api-keys', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return { keys: await listApiKeys(deps.authPool, ctx.userId), canCreate: mayMake(ctx), max: MAX_KEYS };
  });

  app.post('/v1/api-keys', { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!mayMake(ctx)) throw forbidden('Only an administrator or manager can create an API key');
    const name = (req.body as { name: string }).name.trim();
    if (!name) throw invalid('Give the key a name');
    const active = (await listApiKeys(deps.authPool, ctx.userId)).filter((k) => !k.revokedAt && new Date(k.expiresAt) > new Date()).length;
    if (active >= MAX_KEYS) throw invalid(`You can have up to ${MAX_KEYS} active keys. Revoke one first.`);
    const k = await createApiKey(deps.authPool, ctx.tenantId, ctx.userId, name);
    await run(ctx, (tx) => audit(tx, ctx, 'api_key_created', 'api_key', k.id, { name }));
    // the key is shown once; only its hash is kept
    return reply.code(201).send({ id: k.id, token: k.token });
  });

  app.delete('/v1/api-keys/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    if (!(await revokeApiKey(deps.authPool, ctx.userId, id))) throw notFound('Key not found');
    await run(ctx, (tx) => audit(tx, ctx, 'api_key_revoked', 'api_key', id));
    return reply.code(204).send();
  });

  // ---- reading with a key ----
  const hits = new Map<string, number[]>();
  const limited = (key: string, max = 120): boolean => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    list.push(now); hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return list.length > max;
  };
  async function keyed(req: FastifyRequest): Promise<Identity> {
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer (pii_k_[A-Za-z0-9_-]{20,80})$/.exec(h) : null;
    if (!m) throw unauthorized();
    if (limited(m[1]!.slice(0, 14))) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
    const user = await findApiKeyUser(deps.authPool, m[1]!);
    if (!user) throw unauthorized();
    const id = candidateToIdentity(user);
    if (!(await withRequestTx(deps.appPool, id.ctx, (tx) => hasAcceptedFirstLogin(tx, id.ctx)))) throw forbidden('The key owner has not accepted the privacy notice yet');
    requireCrm(id.ctx);
    return id;
  }

  const limitQ = { limit: { type: 'integer', minimum: 1, maximum: 100 } } as const;

  app.get('/v1/public/me', async (req) => {
    const { ctx, user } = await keyed(req);
    return { email: user.email, tenantId: ctx.tenantId };
  });

  app.get('/v1/public/pipelines', async (req) => {
    const { ctx } = await keyed(req);
    return run(ctx, async (tx) => ({
      pipelines: (
        await tx.query(
          `SELECT p.id, p.name, coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'isWon', s.is_won, 'isLost', s.is_lost) ORDER BY s.position) FROM stages s WHERE s.pipeline_id = p.id), '[]'::jsonb) AS stages
             FROM pipelines p ORDER BY p.name`,
        )
      ).rows,
    }));
  });

  const REC = `b.id, b.pipeline_id AS "pipelineId", p.name AS "pipeline", b.stage_id AS "stageId", s.name AS "stage", b.name,
    b.value_amount::float8 AS "value", b.currency, b.close_date::text AS "closeDate", b.custom,
    (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = b.owner_user_id) AS "owner",
    b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.stage_entered_at AS "stageEnteredAt"`;
  const FROM = `FROM boxes b JOIN pipelines p ON p.id = b.pipeline_id JOIN stages s ON s.id = b.stage_id`;

  // Newest first. Zapier-style polling: ask for records created since a time, or page back with `before`.
  app.get('/v1/public/records', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { pipelineId: uuid, since: { type: 'string', format: 'date-time' }, before: { type: 'string', format: 'date-time' }, ...limitQ } } } }, async (req) => {
    const { ctx } = await keyed(req);
    const q = req.query as { pipelineId?: string; since?: string; before?: string; limit?: number };
    const limit = q.limit ?? 50;
    return run(ctx, async (tx) => ({
      records: (
        await tx.query(
          `SELECT ${REC} ${FROM}
            WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND ($2::timestamptz IS NULL OR b.created_at > $2) AND ($3::timestamptz IS NULL OR b.created_at < $3)
            ORDER BY b.created_at DESC, b.id LIMIT $4`,
          [q.pipelineId ?? null, q.since ?? null, q.before ?? null, limit],
        )
      ).rows,
      limit,
    }));
  });

  app.get('/v1/public/records/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req) => {
    const { ctx } = await keyed(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query(`SELECT ${REC} ${FROM} WHERE b.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Record not found');
      return r;
    });
  });

  app.get('/v1/public/contacts', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 }, ...limitQ, offset: { type: 'integer', minimum: 0, maximum: 100000 } } } } }, async (req) => {
    const { ctx } = await keyed(req);
    const q = req.query as { q?: string; limit?: number; offset?: number };
    const limit = q.limit ?? 50, offset = q.offset ?? 0;
    return run(ctx, async (tx) => ({
      contacts: (
        await tx.query(
          `SELECT c.id, c.full_name AS "fullName", c.email, c.phone, c.created_at AS "createdAt" FROM contacts c
            WHERE ($1::text IS NULL OR c.full_name ILIKE '%' || $1 || '%' OR c.email::text ILIKE '%' || $1 || '%')
            ORDER BY c.full_name, c.id LIMIT $2 OFFSET $3`,
          [q.q ?? null, limit, offset],
        )
      ).rows,
      limit, offset,
    }));
  });
}
