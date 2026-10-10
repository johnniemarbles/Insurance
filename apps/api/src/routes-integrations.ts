import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateCustomValues, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { seal } from '@pii/platform';
import { audit } from './audit.ts';
import { forbidden, HttpError, invalid, notFound } from './errors.ts';
import { fieldDefsFor, managerNodeIds, requireCrm, resolveOwnerAndContext, uuid } from './crm-helpers.ts';
import { emitEvent, emitEventNow, safeTarget } from './webhooks.ts';
import { normalizeInbound } from './inbound.ts';
import { buildDigest } from './digest.ts';
import { fireAutomations } from './automation-engine.ts';
import { flushEffects, type Effect } from './effects.ts';
import { notify } from './notify.ts';
import type { AppDeps } from './app.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Endpoint {
  id: string; tenant_id: string; pipeline_id: string; stage_id: string; kind: 'form' | 'webhook'; name: string; title: string | null; intro: string | null;
  owner_node_id: string; context_node_id: string | null; owner_user_id: string | null; created_by: string; active: boolean;
}

/** Hosted forms, the inbound webhook, and outbound webhooks. */
export function registerIntegrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const pid = { type: 'object', properties: { id: uuid } } as const;
  const baseUrl = (req: FastifyRequest) => `${(req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol}://${req.headers.host}`;

  async function manage(tx: Tx, ctx: RequestContext, pipelineId: string) {
    const p = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM pipelines WHERE id = $1', [pipelineId])).rows[0];
    if (!p) throw notFound('Pipeline not found');
    if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(p.owner_node_id)) throw forbidden('Only a manager of the owning branch can change this pipeline');
  }

  // ---------- managing endpoints ----------
  app.get('/v1/pipelines/:id/intakes', { schema: { params: pid } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => ({
      intakes: (await tx.query(
        `SELECT i.id, i.kind, i.name, i.title, i.intro, i.stage_id AS "stageId", i.active, i.uses, i.last_used_at AS "lastUsedAt", i.token_prefix AS "tokenPrefix"
           FROM intake_endpoints i WHERE i.pipeline_id = $1 ORDER BY i.created_at`, [id])).rows,
    }));
  });

  app.post(
    '/v1/pipelines/:id/intakes',
    {
      schema: {
        params: pid,
        body: {
          type: 'object', required: ['kind', 'name'], additionalProperties: false,
          properties: { kind: { enum: ['form', 'webhook'] }, name: { type: 'string', minLength: 1, maxLength: 120 }, stageId: uuid, contextNodeId: uuid, title: { type: 'string', maxLength: 200 }, intro: { type: 'string', maxLength: 1000 }, ownerUserId: uuid },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { kind: 'form' | 'webhook'; name: string; stageId?: string; contextNodeId?: string; title?: string; intro?: string; ownerUserId?: string };
      const token = `pii_${randomBytes(24).toString('base64url')}`;
      const out = await run(ctx, async (tx) => {
        await manage(tx, ctx, id);
        const { ownerNodeId, contextNodeId } = await resolveOwnerAndContext(tx, ctx, { contextNodeId: b.contextNodeId });
        const stage = b.stageId
          ? (await tx.query<{ id: string }>('SELECT id FROM stages WHERE id = $1 AND pipeline_id = $2', [b.stageId, id])).rows[0]
          : (await tx.query<{ id: string }>('SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1', [id])).rows[0];
        if (!stage) throw invalid('That stage is not in this pipeline');
        if (b.ownerUserId && (await tx.query('SELECT 1 FROM user_node_roles WHERE user_id = $1 AND node_id = $2', [b.ownerUserId, ownerNodeId])).rowCount === 0) throw invalid('That person does not belong to the owning branch');
        const r = await tx.query<{ id: string }>(
          `INSERT INTO intake_endpoints (tenant_id, pipeline_id, stage_id, kind, name, title, intro, owner_node_id, context_node_id, owner_user_id, token_hash, token_prefix, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [ctx.tenantId, id, stage.id, b.kind, b.name.trim(), b.title?.trim() || null, b.intro?.trim() || null, ownerNodeId, contextNodeId, b.ownerUserId ?? null, sha(token), token.slice(0, 8), ctx.userId],
        );
        await audit(tx, ctx, 'intake_created', 'pipeline', id, { intakeId: r.rows[0]!.id, kind: b.kind });
        return { id: r.rows[0]!.id };
      });
      // the token is shown once; only its hash is kept
      const url = b.kind === 'form' ? `${baseUrl(req)}/f/${token}` : `${baseUrl(req)}/v1/hooks/${token}`;
      return reply.code(201).send({ ...out, url });
    },
  );

  const iid = { type: 'object', properties: { id: uuid, itemId: uuid } } as const;
  app.patch('/v1/pipelines/:id/intakes/:itemId', { schema: { params: iid, body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, itemId } = req.params as { id: string; itemId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      if ((await tx.query('UPDATE intake_endpoints SET active = $3 WHERE id = $1 AND pipeline_id = $2', [itemId, id, (req.body as { active: boolean }).active])).rowCount === 0) throw notFound('Not found');
    });
    return reply.code(204).send();
  });
  app.delete('/v1/pipelines/:id/intakes/:itemId', { schema: { params: iid } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, itemId } = req.params as { id: string; itemId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      if ((await tx.query('DELETE FROM intake_endpoints WHERE id = $1 AND pipeline_id = $2', [itemId, id])).rowCount === 0) throw notFound('Not found');
      await audit(tx, ctx, 'intake_deleted', 'pipeline', id, { intakeId: itemId });
    });
    return reply.code(204).send();
  });

  // ---------- public entry points ----------
  const hits = new Map<string, number[]>();
  const limited = (key: string, max = 30): boolean => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
    list.push(now); hits.set(key, list);
    // Evict stale keys only — never wipe active counters under load (that would reset limits for attackers).
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.length === 0 || now - v[v.length - 1]! > 600_000) hits.delete(k);
      }
      if (hits.size > 5000) {
        let n = 0;
        const drop = hits.size - 3750;
        for (const k of hits.keys()) {
          hits.delete(k);
          if (++n >= drop) break;
        }
      }
    }
    return list.length > max;
  };
  async function endpointFor(token: string, kind: 'form' | 'webhook'): Promise<Endpoint> {
    const e = (await deps.authPool.query<Endpoint>('SELECT * FROM intake_endpoints WHERE token_hash = $1 AND kind = $2', [sha(token), kind])).rows[0];
    if (!e || !e.active) throw notFound('This link is not active');
    return e;
  }

  async function receive(e: Endpoint, body: Record<string, unknown>, source: string | null = null): Promise<{ boxId: string } | null> {
    if (e.kind === 'form' && typeof body.website === 'string' && body.website.trim() !== '') return null; // hidden field only bots fill in
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const email = str(body.email, 200).toLowerCase();
    const name = str(body.name, 200) || (e.kind === 'webhook' ? email.split('@')[0]! : '');
    if (!name) throw invalid(e.kind === 'webhook' ? 'Could not find a name or an email address in that message' : 'Please enter a name');
    if (email && !EMAIL.test(email)) throw invalid('That email address does not look right');
    const phone = str(body.phone, 40);
    const note = str(body.note ?? body.message, 2000);
    const value = body.value == null || body.value === '' ? null : Number(body.value);
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 999_999_999)) throw invalid('Value must be a positive number');
    const ctx: RequestContext = { tenantId: e.tenant_id, userId: e.created_by, nodeIds: [e.owner_node_id], adminNodeIds: [], isTenantAdmin: false, canWrite: true, canUseCrm: true, roles: [] };
    const boxId = randomUUID();
    const effects: Effect[] = [];
    const info = await withRequestTx(deps.appPool, ctx, async (tx) => {
      let custom: Record<string, unknown> = {};
      if (e.kind === 'webhook' && body.custom && typeof body.custom === 'object') {
        const v = validateCustomValues(await fieldDefsFor(tx, e.pipeline_id), body.custom as Record<string, unknown>, { partial: true });
        if (!v.ok) throw invalid(v.errors.join('; '));
        custom = v.value;
      }
      const currency = deps.config.region === 'us' ? 'USD' : 'CAD';
      await tx.query(
        `INSERT INTO boxes (id, tenant_id, pipeline_id, stage_id, owner_node_id, context_node_id, owner_user_id, name, value_amount, currency, custom, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [boxId, e.tenant_id, e.pipeline_id, e.stage_id, e.owner_node_id, e.context_node_id, e.owner_user_id, name, value, currency, JSON.stringify(custom), e.created_by],
      );
      await tx.query(`INSERT INTO box_events (tenant_id, box_id, kind, to_stage_id, actor_id) VALUES ($1,$2,'created',$3,$4)`, [e.tenant_id, boxId, e.stage_id, e.created_by]);
      if (email || phone) {
        const existing = email ? (await tx.query<{ id: string }>('SELECT id FROM contacts WHERE lower(email::text) = $1 AND owner_node_id = $2 LIMIT 1', [email, e.owner_node_id])).rows[0] : undefined;
        const cid = existing?.id ?? randomUUID();
        if (!existing) await tx.query('INSERT INTO contacts (id, tenant_id, owner_node_id, context_node_id, email, full_name, phone, custom) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [cid, e.tenant_id, e.owner_node_id, e.context_node_id, email || null, name, phone || null, '{}']);
        await tx.query('INSERT INTO box_contacts (box_id, contact_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [boxId, cid, e.tenant_id]);
      }
      if (note) await tx.query('INSERT INTO notes (id, tenant_id, box_id, owner_node_id, context_node_id, author_id, body) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), e.tenant_id, boxId, e.owner_node_id, e.context_node_id, e.created_by, `${source ?? (e.kind === 'form' ? 'Web form' : 'Webhook')} “${e.name}”: ${note}`]);
      await fireAutomations(tx, ctx, boxId, e.stage_id, 'enter', effects);
      await notify(tx, { tenantId: e.tenant_id, userId: e.owner_user_id ?? e.created_by, kind: 'capture', boxId, data: { boxName: name, source: source ?? (e.kind === 'form' ? 'Web form' : 'Webhook'), via: e.name } });
      await audit(tx, ctx, 'intake_received', 'box', boxId, { intakeId: e.id, kind: e.kind });
      return (await tx.query<{ stage: string }>('SELECT name AS stage FROM stages WHERE id = $1', [e.stage_id])).rows[0]!;
    });
    await deps.authPool.query('UPDATE intake_endpoints SET uses = uses + 1, last_used_at = now() WHERE id = $1', [e.id]).catch(() => undefined);
    emitEvent(deps, e.tenant_id, e.pipeline_id, 'box.created', { box: { id: boxId, name, stageId: e.stage_id, stageName: info.stage, valueAmount: value }, source: e.kind });
    void flushEffects(deps, e.tenant_id, effects);
    return { boxId };
  }

  const rateKey = (req: FastifyRequest, token: string) => `${token.slice(0, 12)}:${req.ip}`;

  app.post('/v1/hooks/:token', { bodyLimit: 20_000 }, async (req, reply) => {
    const { token } = req.params as { token: string };
    if (limited(rateKey(req, token), 300)) throw new HttpError(429, 'rate_limited', 'Too many requests');
    const e = await endpointFor(token, 'webhook');
    const n = normalizeInbound((req.body ?? {}) as Record<string, unknown>);
    if (n.ignore) return reply.code(200).send({ ok: true, ignored: true });
    const r = await receive(e, { name: n.name, email: n.email, phone: n.phone, note: n.note, value: n.value, custom: n.custom }, n.source);
    return reply.code(201).send({ ok: true, id: r?.boxId ?? null });
  });

  app.get('/f/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const e = await endpointFor(token, 'form');
    const tenant = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [e.tenant_id])).rows[0]?.name ?? '';
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.title ?? e.name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827}main{max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
label{display:block;margin:14px 0 4px;font-size:14px;color:#374151}input,textarea{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font:inherit;box-sizing:border-box}button{margin-top:18px;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer}
small{display:block;margin-top:16px;color:#6b7280}.hp{position:absolute;left:-9999px}#msg{margin-top:14px}</style></head><body><main>
<h1>${esc(e.title ?? e.name)}</h1>${e.intro ? `<p>${esc(e.intro)}</p>` : ''}
<form id="f"><label for="n">Name *</label><input id="n" name="name" required maxlength="200" autocomplete="name">
<label for="e">Email</label><input id="e" name="email" type="email" maxlength="200" autocomplete="email">
<label for="p">Phone</label><input id="p" name="phone" maxlength="40" autocomplete="tel">
<label for="m">Message</label><textarea id="m" name="message" rows="4" maxlength="2000"></textarea>
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button>Send</button><div id="msg" role="status"></div>
<small>What you enter here is sent to ${esc(tenant)} so they can reply to you. Do not include health or payment card details.</small></form>
<script>document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();var f=ev.target,d={};new FormData(f).forEach(function(v,k){d[k]=v});
var m=document.getElementById('msg');m.textContent='';try{var r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
if(r.ok){f.reset();m.textContent='Thank you. We received your details.';}else{var j=await r.json().catch(function(){return{}});m.textContent=(j.error&&j.error.message)||'Something went wrong. Please try again.';}}catch(x){m.textContent='Could not send. Please try again.';}});</script>
</main></body></html>`;
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-frame-options', 'SAMEORIGIN').header('referrer-policy', 'no-referrer').send(page);
  });
  app.post('/f/:token', { bodyLimit: 20_000 }, async (req, reply) => {
    const { token } = req.params as { token: string };
    if (limited(rateKey(req, token))) throw new HttpError(429, 'rate_limited', 'Too many requests. Please try again later.');
    const e = await endpointFor(token, 'form');
    await receive(e, (req.body ?? {}) as Record<string, unknown>);
    return reply.code(201).send({ ok: true });
  });

  // ---------- outbound webhooks ----------
  app.get('/v1/pipelines/:id/webhooks', { schema: { params: pid } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => ({
      webhooks: (await tx.query(`SELECT id, url, events, active, last_status AS "lastStatus", last_at AS "lastAt", failures FROM webhook_subscriptions WHERE pipeline_id = $1 ORDER BY created_at`, [id])).rows,
    }));
  });
  app.post(
    '/v1/pipelines/:id/webhooks',
    { schema: { params: pid, body: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string', maxLength: 500 }, events: { type: 'array', minItems: 1, items: { enum: ['box.created', 'box.stage_changed', 'digest.weekly'] } } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      if (!deps.keys) throw new HttpError(503, 'unavailable', 'Webhooks are not available on this server');
      const { id } = req.params as { id: string };
      const b = req.body as { url: string; events?: string[] };
      try { await safeTarget(b.url, deps.config.appEnv === 'test'); } catch (x) { throw invalid((x as Error).message); }
      const secret = `whsec_${randomBytes(24).toString('base64url')}`;
      const whId = randomUUID();
      await run(ctx, async (tx) => {
        await manage(tx, ctx, id);
        const sealed = seal(deps.keys!, secret, `${ctx.tenantId}:${whId}`);
        await tx.query(
          'INSERT INTO webhook_subscriptions (id, tenant_id, pipeline_id, url, events, secret_enc, key_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [whId, ctx.tenantId, id, b.url, b.events ?? ['box.created', 'box.stage_changed'], sealed.data, sealed.keyId, ctx.userId],
        );
        await audit(tx, ctx, 'webhook_created', 'pipeline', id, { webhookId: whId });
      });
      return reply.code(201).send({ id: whId, secret });
    },
  );
  app.delete('/v1/pipelines/:id/webhooks/:itemId', { schema: { params: iid } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, itemId } = req.params as { id: string; itemId: string };
    await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      if ((await tx.query('DELETE FROM webhook_subscriptions WHERE id = $1 AND pipeline_id = $2', [itemId, id])).rowCount === 0) throw notFound('Not found');
    });
    return reply.code(204).send();
  });
  app.post('/v1/pipelines/:id/webhooks/:itemId/test', { schema: { params: iid, body: { type: 'object', additionalProperties: false, properties: { event: { enum: ['box.created', 'box.stage_changed', 'digest.weekly'] } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, itemId } = req.params as { id: string; itemId: string };
    const event = ((req.body ?? {}) as { event?: 'box.created' | 'box.stage_changed' | 'digest.weekly' }).event ?? 'box.created';
    const data = await run(ctx, async (tx) => {
      await manage(tx, ctx, id);
      if ((await tx.query('SELECT 1 FROM webhook_subscriptions WHERE id = $1 AND pipeline_id = $2', [itemId, id])).rowCount === 0) throw notFound('Not found');
      if (event === 'digest.weekly') return { digest: await buildDigest(tx, id, 7, null), test: true };
      const st = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM stages WHERE pipeline_id = $1 ORDER BY position LIMIT 2', [id])).rows;
      const box = { id: randomUUID(), name: 'Sample record', stageId: st[st.length - 1]?.id ?? null, stageName: st[st.length - 1]?.name ?? null, valueAmount: 1000 };
      return event === 'box.created' ? { box, source: 'test', test: true } : { box, from: { stageId: st[0]?.id ?? null, stageName: st[0]?.name ?? null }, source: 'test', test: true };
    });
    const [status] = await emitEventNow(deps, ctx.tenantId, id, event, data, [itemId]);
    return { status: status ?? 0 };
  });

  app.get('/v1/pipelines/:id/digest', { schema: { params: pid, querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 }, tasks: { enum: ['mine', 'all'] } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const q = req.query as { days?: number; tasks?: 'mine' | 'all' };
    return run(ctx, async (tx) => {
      if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id])).rowCount === 0) throw notFound('Pipeline not found');
      return buildDigest(tx, id, q.days ?? 7, q.tasks === 'all' ? null : ctx.userId);
    });
  });
}
