import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, HttpError, invalid, notFound } from './errors.ts';
import { managerNodeIds, requireCrm, uuid } from './crm-helpers.ts';
import { actingAs } from './effects.ts';
import { BASE_TOKENS, escapeHtml, renderBody, renderSubject, tokensIn } from './merge-render.ts';
import { notify } from './notify.ts';
import { effectiveSetting } from './settings.ts';
import type { AppDeps } from './app.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Gmail allows 500 messages a day for free accounts and 2,000 for Workspace; stay well inside. */
const MAX_DAILY = 400;

interface Me { displayName: string | null; email: string; tenantName: string; locale: 'en' | 'fr-CA' }

/** Snippets (saved replies), mail merge, and the public unsubscribe page. */
export function registerMergeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const baseUrl = (req: FastifyRequest) => `${(req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol}://${req.headers.host}`;

  /** The values a message can use for one record. */
  async function varsFor(tx: Tx, boxId: string | null, email: string, contactId: string | null, me: Me): Promise<Record<string, string>> {
    const v: Record<string, string> = { email, myName: me.displayName ?? me.email, myEmail: me.email, company: me.tenantName };
    if (contactId) {
      const c = (await tx.query<{ full_name: string | null }>('SELECT full_name FROM contacts WHERE id = $1', [contactId])).rows[0];
      if (c?.full_name) v.name = c.full_name;
    }
    if (boxId) {
      const b = (await tx.query<{ name: string; stage: string | null; value_amount: string | null; currency: string; owner: string | null; custom: Record<string, unknown> }>(
        `SELECT b.name, s.name AS stage, b.value_amount, b.currency, coalesce(u.display_name, u.email::text) AS owner, b.custom
           FROM boxes b LEFT JOIN stages s ON s.id = b.stage_id LEFT JOIN app_users u ON u.id = b.owner_user_id WHERE b.id = $1`, [boxId],
      )).rows[0];
      if (b) {
        v.box = b.name; v.stage = b.stage ?? ''; v.owner = b.owner ?? '';
        if (b.value_amount != null) v.value = new Intl.NumberFormat(me.locale, { style: 'currency', currency: b.currency, maximumFractionDigits: 0 }).format(Number(b.value_amount));
        for (const [k, x] of Object.entries(b.custom ?? {})) if (x != null && typeof x !== 'object' && !(k in v)) v[k] = String(x);
        if (!v.name) v.name = b.name;
      }
    }
    const parts = (v.name ?? '').trim().split(/\s+/);
    v.firstName = parts[0] ?? ''; v.lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    return v;
  }
  const unsubHtml = (url: string, locale: 'en' | 'fr-CA') => `<a href="${url}">${locale === 'fr-CA' ? 'Se désabonner' : 'Unsubscribe'}</a>`;
  const meOf = (identity: { user: { displayName: string | null; email: string; tenantName: string; locale: 'en' | 'fr-CA' } }): Me => identity.user;

  // =================== snippets ===================
  const SNIP = `s.id, s.name, s.body, s.locale, s.shared, (s.user_id = app_user_id()) AS mine`;
  app.get('/v1/snippets', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => ({ snippets: (await tx.query(`SELECT ${SNIP} FROM snippets s ORDER BY lower(s.name)`)).rows }));
  });
  const snipBody = { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, body: { type: 'string', minLength: 1, maxLength: 20000 }, locale: { enum: ['en', 'fr-CA'] }, shared: { type: 'boolean' } } } as const;
  const canShare = (ctx: RequestContext) => ctx.isTenantAdmin || managerNodeIds(ctx).length > 0;
  app.post('/v1/snippets', { schema: { body: { ...snipBody, required: ['name', 'body'] } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const b = req.body as { name: string; body: string; locale?: 'en' | 'fr-CA'; shared?: boolean };
    if (b.shared && !canShare(ctx)) throw forbidden('Only managers can share a snippet with their team');
    const id = randomUUID();
    await run(ctx, (tx) => tx.query('INSERT INTO snippets (id, tenant_id, user_id, owner_node_id, name, body, locale, shared) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, ctx.tenantId, ctx.userId, ctx.nodeIds[0], b.name.trim(), b.body, b.locale ?? 'en', b.shared ?? false]));
    return reply.code(201).send({ id });
  });
  app.patch('/v1/snippets/:id', { schema: { params: idp, body: snipBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; body?: string; locale?: 'en' | 'fr-CA'; shared?: boolean };
    if (b.shared && !canShare(ctx)) throw forbidden('Only managers can share a snippet with their team');
    await run(ctx, async (tx) => {
      const r = await tx.query('UPDATE snippets SET name = coalesce($3, name), body = coalesce($4, body), locale = coalesce($5::locale_code, locale), shared = coalesce($6, shared) WHERE id = $1 AND user_id = $2', [id, ctx.userId, b.name?.trim() ?? null, b.body ?? null, b.locale ?? null, b.shared ?? null]);
      if (r.rowCount === 0) throw notFound('Snippet not found');
    });
    return reply.code(204).send();
  });
  app.delete('/v1/snippets/:id', { schema: { params: idp } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => { if ((await tx.query('DELETE FROM snippets WHERE id = $1 AND user_id = $2', [id, ctx.userId])).rowCount === 0) throw notFound('Snippet not found'); });
    return reply.code(204).send();
  });
  // Fill in a snippet for the person being written to, ready to drop into the compose window.
  app.post('/v1/snippets/:id/render', { schema: { params: idp, body: { type: 'object', additionalProperties: false, properties: { toName: { type: 'string', maxLength: 200 }, toEmail: { type: 'string', maxLength: 320 } } } } }, async (req) => {
    const identity = await deps.authenticate(req);
    requireCrm(identity.ctx);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { toName?: string; toEmail?: string };
    const row = await run(identity.ctx, async (tx) => (await tx.query<{ body: string }>('SELECT body FROM snippets WHERE id = $1', [id])).rows[0]);
    if (!row) throw notFound('Snippet not found');
    const me = meOf(identity);
    const name = (b.toName ?? '').trim();
    const vars: Record<string, string> = { name, firstName: name.split(/\s+/)[0] ?? '', lastName: name.split(/\s+/).slice(1).join(' '), email: b.toEmail ?? '', myName: me.displayName ?? me.email, myEmail: me.email, company: me.tenantName };
    return { html: renderBody(row.body, vars, '').html.replace(/^<p>|<\/p>$/g, '') };
  });

  // =================== mail merge ===================
  const MCOLS = `m.id, m.name, m.subject, m.body, m.locale, m.status, m.created_at AS "createdAt", m.started_at AS "startedAt", m.finished_at AS "finishedAt",
    (SELECT count(*)::int FROM mail_merge_recipients r WHERE r.merge_id = m.id) AS total,
    (SELECT count(*)::int FROM mail_merge_recipients r WHERE r.merge_id = m.id AND r.status = 'sent') AS sent,
    (SELECT count(*)::int FROM mail_merge_recipients r WHERE r.merge_id = m.id AND r.status = 'failed') AS failed,
    (SELECT count(*)::int FROM mail_merge_recipients r WHERE r.merge_id = m.id AND r.status = 'skipped') AS skipped,
    (SELECT count(*)::int FROM mail_merge_recipients r WHERE r.merge_id = m.id AND r.unsubscribed_at IS NOT NULL) AS unsubscribed`;

  const mergeBody = { name: { type: 'string', minLength: 1, maxLength: 120 }, subject: { type: 'string', minLength: 1, maxLength: 300 }, body: { type: 'string', minLength: 1, maxLength: 20000 } } as const;
  function checkTemplate(subject: string, body: string): void {
    if (!tokensIn(body).some((t) => t.toLowerCase() === 'unsubscribe')) throw invalid('Add {{unsubscribe}} to the message. Canadian anti-spam law requires a way to opt out in every marketing email.');
    if (tokensIn(subject).some((t) => t.toLowerCase() === 'unsubscribe')) throw invalid('{{unsubscribe}} belongs in the message, not the subject');
  }

  app.get('/v1/merges', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => ({ merges: (await tx.query(`SELECT ${MCOLS} FROM mail_merges m WHERE m.status <> 'cancelled' ORDER BY m.created_at DESC LIMIT 100`)).rows }));
  });

  app.post('/v1/merges', { schema: { body: { type: 'object', required: ['name', 'subject', 'body'], additionalProperties: false, properties: { ...mergeBody, boxIds: { type: 'array', items: uuid, maxItems: 2000 } } } } }, async (req, reply) => {
    const identity = await deps.authenticate(req);
    const { ctx } = identity;
    requireCrm(ctx);
    const b = req.body as { name: string; subject: string; body: string; boxIds?: string[] };
    checkTemplate(b.subject, b.body);
    const id = randomUUID();
    const skipped = { noEmail: 0, optedOut: 0, duplicate: 0, notFound: 0 };
    const total = await run(ctx, async (tx) => {
      await tx.query('INSERT INTO mail_merges (id, tenant_id, user_id, name, subject, body, locale) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, ctx.tenantId, ctx.userId, b.name.trim(), b.subject.trim(), b.body, identity.user.locale]);
      let n = 0;
      for (const boxId of b.boxIds ?? []) {
        const box = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [boxId])).rows[0];
        if (!box) { skipped.notFound++; continue; }
        const c = (await tx.query<{ id: string; email: string | null; opted: boolean }>(
          `SELECT c.id, c.email::text AS email, (c.email_opt_out_at IS NOT NULL) AS opted FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id
            WHERE bc.box_id = $1 AND c.email IS NOT NULL ORDER BY (c.email_opt_out_at IS NULL) DESC, c.created_at LIMIT 1`, [boxId],
        )).rows[0];
        if (!c) { skipped.noEmail++; continue; }
        if (c.opted) { skipped.optedOut++; continue; }
        const r = await tx.query(
          `INSERT INTO mail_merge_recipients (id, tenant_id, merge_id, user_id, owner_node_id, box_id, contact_id, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,lower($8)) ON CONFLICT (merge_id, email) DO NOTHING`, [randomUUID(), ctx.tenantId, id, ctx.userId, box.owner_node_id, boxId, c.id, c.email],
        );
        if (r.rowCount) n++; else skipped.duplicate++;
      }
      await audit(tx, ctx, 'merge_created', 'mail_merge', id, { recipients: n });
      return n;
    });
    return reply.code(201).send({ id, recipients: total, skipped });
  });

  app.get('/v1/merges/:id', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const m = (await tx.query(`SELECT ${MCOLS} FROM mail_merges m WHERE m.id = $1`, [id])).rows[0];
      if (!m) throw notFound('Mail merge not found');
      const recipients = (await tx.query(
        `SELECT r.id, r.email, r.status, r.error, r.sent_at AS "sentAt", r.unsubscribed_at AS "unsubscribedAt", r.box_id AS "boxId", (SELECT b.name FROM boxes b WHERE b.id = r.box_id) AS "boxName"
           FROM mail_merge_recipients r WHERE r.merge_id = $1 ORDER BY r.created_at LIMIT 500`, [id],
      )).rows;
      return { ...m, recipients };
    });
  });

  app.patch('/v1/merges/:id', { schema: { params: idp, body: { type: 'object', additionalProperties: false, properties: { ...mergeBody, status: { enum: ['running', 'paused', 'cancelled'] } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; subject?: string; body?: string; status?: 'running' | 'paused' | 'cancelled' };
    await run(ctx, async (tx) => {
      const m = (await tx.query<{ status: string; subject: string; body: string }>('SELECT status, subject, body FROM mail_merges WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound('Mail merge not found');
      if ((b.subject != null || b.body != null) && m.status === 'running') throw invalid('Pause the merge before changing the message');
      if (m.status === 'cancelled') throw invalid('This merge was cancelled');
      checkTemplate(b.subject ?? m.subject, b.body ?? m.body);
      if (b.status === 'running' && !['draft', 'paused', 'done'].includes(m.status)) throw invalid('This merge is already running');
      if (b.status === 'paused' && m.status !== 'running') throw invalid('Only a running merge can be paused');
      await tx.query(
        `UPDATE mail_merges SET name = coalesce($2, name), subject = coalesce($3, subject), body = coalesce($4, body), status = coalesce($5, status),
           started_at = CASE WHEN $5 = 'running' AND started_at IS NULL THEN now() ELSE started_at END, finished_at = CASE WHEN $5 = 'running' THEN NULL ELSE finished_at END WHERE id = $1`,
        [id, b.name?.trim() ?? null, b.subject?.trim() ?? null, b.body ?? null, b.status ?? null],
      );
      await audit(tx, ctx, 'merge_updated', 'mail_merge', id, { status: b.status });
    });
    return reply.code(204).send();
  });

  app.post('/v1/merges/:id/retry-failed', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if ((await tx.query('SELECT 1 FROM mail_merges WHERE id = $1', [id])).rowCount === 0) throw notFound('Mail merge not found');
      const r = await tx.query(`UPDATE mail_merge_recipients SET status = 'pending', error = NULL WHERE merge_id = $1 AND status = 'failed'`, [id]);
      await tx.query(`UPDATE mail_merges SET status = 'paused', finished_at = NULL WHERE id = $1 AND status = 'done'`, [id]);
      return { retried: r.rowCount ?? 0 };
    });
  });

  // What the first recipient would receive, so the sender can check before anything goes out.
  app.post('/v1/merges/preview', { schema: { body: { type: 'object', required: ['subject', 'body'], additionalProperties: false, properties: { subject: mergeBody.subject, body: mergeBody.body, boxId: uuid, mergeId: uuid, recipientId: uuid } } } }, async (req) => {
    const identity = await deps.authenticate(req);
    requireCrm(identity.ctx);
    const b = req.body as { subject: string; body: string; boxId?: string; recipientId?: string };
    return run(identity.ctx, async (tx) => {
      let boxId = b.boxId ?? null, contactId: string | null = null, email = 'name@example.com';
      if (b.recipientId) {
        const r = (await tx.query<{ box_id: string | null; contact_id: string | null; email: string }>('SELECT box_id, contact_id, email FROM mail_merge_recipients WHERE id = $1', [b.recipientId])).rows[0];
        if (r) { boxId = r.box_id; contactId = r.contact_id; email = r.email; }
      } else if (boxId) {
        const c = (await tx.query<{ id: string; email: string }>('SELECT c.id, c.email::text AS email FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id WHERE bc.box_id = $1 AND c.email IS NOT NULL ORDER BY c.created_at LIMIT 1', [boxId])).rows[0];
        if (c) { contactId = c.id; email = c.email; }
      }
      const vars = await varsFor(tx, boxId, email, contactId, meOf(identity));
      const body = renderBody(b.body, vars, unsubHtml('#', identity.user.locale));
      const known = new Set([...BASE_TOKENS, ...Object.keys(vars)].map((k) => k.toLowerCase()));
      return { to: email, subject: renderSubject(b.subject, vars), html: body.html, empty: [...new Set(body.empty)], unknown: tokensIn(`${b.subject} ${b.body}`).filter((t) => !known.has(t.toLowerCase())) };
    });
  });

  // The sender's browser asks for the next message, sends it through Gmail, then reports back.
  app.post('/v1/merges/:id/next', { schema: { params: idp } }, async (req) => {
    const identity = await deps.authenticate(req);
    const { ctx } = identity;
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const me = meOf(identity);
    return run(ctx, async (tx) => {
      const m = (await tx.query<{ status: string; subject: string; body: string; name: string; locale: 'en' | 'fr-CA' }>('SELECT status, subject, body, name, locale FROM mail_merges WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound('Mail merge not found');
      if (m.status !== 'running') return { idle: true, status: m.status };
      const today = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM mail_merge_recipients WHERE user_id = $1 AND sent_at > now() - interval '24 hours'`, [ctx.userId])).rows[0]!.n;
      const DAILY_CAP = Math.min(MAX_DAILY, await effectiveSetting<number>(tx, ctx.userId, 'merge.dailyCap'));
      if (today >= DAILY_CAP) throw new HttpError(429, 'daily_limit', `Daily limit of ${DAILY_CAP} messages reached. The merge continues tomorrow.`);
      for (let i = 0; i < 25; i++) {
        const r = (await tx.query<{ id: string; email: string; box_id: string | null; contact_id: string | null; opted: boolean }>(
          `UPDATE mail_merge_recipients r SET status = 'sending', claimed_at = now()
            WHERE r.id = (SELECT x.id FROM mail_merge_recipients x WHERE x.merge_id = $1 AND (x.status = 'pending' OR (x.status = 'sending' AND x.claimed_at < now() - interval '5 minutes'))
                           ORDER BY x.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING r.id, r.email, r.box_id, r.contact_id, (SELECT c.email_opt_out_at IS NOT NULL FROM contacts c WHERE c.id = r.contact_id) AS opted`, [id],
        )).rows[0];
        if (!r) {
          const left = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM mail_merge_recipients WHERE merge_id = $1 AND status = 'sending'`, [id])).rows[0]!.n;
          if (left === 0) {
            await tx.query(`UPDATE mail_merges SET status = 'done', finished_at = now() WHERE id = $1`, [id]);
            await notify(tx, { tenantId: ctx.tenantId, userId: ctx.userId, kind: 'merge_done', data: { name: m.name, mergeId: id } });
            return { done: true };
          }
          return { wait: true };
        }
        if (r.opted) { await tx.query(`UPDATE mail_merge_recipients SET status = 'skipped', error = 'unsubscribed' WHERE id = $1`, [r.id]); continue; }
        const token = `unsub_${randomBytes(24).toString('base64url')}`;
        await tx.query('UPDATE mail_merge_recipients SET unsub_hash = $2 WHERE id = $1', [r.id, sha(token)]);
        const vars = await varsFor(tx, r.box_id, r.email, r.contact_id, me);
        const subject = renderSubject(m.subject, vars);
        await tx.query('UPDATE mail_merge_recipients SET subject = $2 WHERE id = $1', [r.id, subject]);
        return {
          recipientId: r.id, to: r.email, toName: vars.name ?? '',
          subject,
          html: renderBody(m.body, vars, unsubHtml(`${baseUrl(req)}/u/${token}`, m.locale)).html,
          remainingToday: DAILY_CAP - today - 1,
        };
      }
      return { wait: true };
    });
  });

  app.post('/v1/merges/:id/recipients/:rid/result', {
    schema: { params: { type: 'object', properties: { id: uuid, rid: uuid } }, body: { type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' }, threadId: { type: 'string', maxLength: 100 }, error: { type: 'string', maxLength: 300 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, rid } = req.params as { id: string; rid: string };
    const b = req.body as { ok: boolean; threadId?: string; error?: string };
    await run(ctx, async (tx) => {
      const m = (await tx.query<{ name: string; subject: string }>('SELECT name, subject FROM mail_merges WHERE id = $1', [id])).rows[0];
      const r = (await tx.query<{ box_id: string | null; status: string; subject: string | null }>('SELECT box_id, status, subject FROM mail_merge_recipients WHERE id = $1 AND merge_id = $2 FOR UPDATE', [rid, id])).rows[0];
      if (!m || !r) throw notFound('Recipient not found');
      if (r.status !== 'sending') throw invalid('That message was not waiting to be sent');
      if (!b.ok) { await tx.query(`UPDATE mail_merge_recipients SET status = 'failed', error = $2 WHERE id = $1`, [rid, (b.error ?? 'Could not send').slice(0, 300)]); return; }
      await tx.query(`UPDATE mail_merge_recipients SET status = 'sent', sent_at = now(), gmail_thread_id = $2, error = NULL WHERE id = $1`, [rid, b.threadId ?? null]);
      if (r.box_id) {
        const bx = (await tx.query<{ owner_node_id: string; context_node_id: string | null }>('SELECT owner_node_id, context_node_id FROM boxes WHERE id = $1', [r.box_id])).rows[0];
        if (bx) await tx.query('INSERT INTO notes (id, tenant_id, box_id, owner_node_id, context_node_id, author_id, body) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), ctx.tenantId, r.box_id, bx.owner_node_id, bx.context_node_id, ctx.userId, `Mail merge “${m.name}”: sent “${(r.subject ?? m.subject).slice(0, 120)}”`]);
      }
    });
    return reply.code(204).send();
  });

  // =================== public unsubscribe ===================
  const hits = new Map<string, number[]>();
  const limited = (ip: string) => { const now = Date.now(); const l = (hits.get(ip) ?? []).filter((t) => now - t < 600_000); l.push(now); hits.set(ip, l); if (hits.size > 5000) hits.clear(); return l.length > 40; };
  async function recipientFor(token: string) {
    const r = (await deps.authPool.query<{ id: string; tenant_id: string; user_id: string; owner_node_id: string; contact_id: string | null; box_id: string | null; email: string; unsubscribed_at: string | null }>(
      'SELECT id, tenant_id, user_id, owner_node_id, contact_id, box_id, email, unsubscribed_at FROM mail_merge_recipients WHERE unsub_hash = $1', [sha(token)],
    )).rows[0];
    if (!r) throw notFound('This link is not valid');
    return r;
  }
  const page = (title: string, bodyHtml: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827}main{max-width:480px;margin:40px auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}button{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer}</style></head><body><main>${bodyHtml}</main></body></html>`;
  const send = (reply: import('fastify').FastifyReply, html: string) => reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY').send(html);

  app.get('/u/:token', async (req, reply) => {
    if (limited(req.ip)) throw new HttpError(429, 'rate_limited', 'Too many requests');
    const r = await recipientFor((req.params as { token: string }).token);
    const org = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [r.tenant_id])).rows[0]?.name ?? '';
    return send(reply, page('Unsubscribe', r.unsubscribed_at
      ? `<h1>You are unsubscribed</h1><p>${escapeHtml(r.email)} will not receive these emails from ${escapeHtml(org)}.</p>`
      : `<h1>Unsubscribe</h1><p>Stop emails from ${escapeHtml(org)} to <b>${escapeHtml(r.email)}</b>?</p><form method="post"><button>Yes, unsubscribe me</button></form>`));
  });
  app.post('/u/:token', async (req, reply) => {
    if (limited(req.ip)) throw new HttpError(429, 'rate_limited', 'Too many requests');
    const r = await recipientFor((req.params as { token: string }).token);
    // act as the sender at the recipient's own branch, through normal row-level security
    await withRequestTx(deps.appPool, actingAs(r.tenant_id, r.user_id, r.owner_node_id), async (tx) => {
      await tx.query(`UPDATE contacts SET email_opt_out_at = coalesce(email_opt_out_at, now()) WHERE lower(email::text) = lower($1)`, [r.email]);
      await tx.query(`UPDATE mail_merge_recipients SET unsubscribed_at = coalesce(unsubscribed_at, now()) WHERE id = $1`, [r.id]);
      await tx.query(`UPDATE mail_merge_recipients SET status = 'skipped', error = 'unsubscribed' WHERE lower(email) = lower($1) AND status IN ('pending', 'sending')`, [r.email]);
      await notify(tx, { tenantId: r.tenant_id, userId: r.user_id, kind: 'unsubscribed', boxId: r.box_id, data: { email: r.email } });
    });
    return send(reply, page('Unsubscribed', `<h1>You are unsubscribed</h1><p>${escapeHtml(r.email)} will not receive these emails again.</p>`));
  });
}
