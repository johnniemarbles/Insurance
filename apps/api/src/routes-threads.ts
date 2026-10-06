import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { linkThreadNotice, type RequestContext } from '@pii/domain';
import { findLoginCandidates, withRequestTx, type Tx } from '@pii/db';
import { candidateToIdentity } from './auth.ts';
import { open, seal } from '@pii/platform';
import { audit } from './audit.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { currentNoticeVersion } from './routes-consent.ts';
import { notify } from './notify.ts';
import { fireAutomations } from './automation-engine.ts';
import { flushEffects, type Effect } from './effects.ts';
import { emitEvent } from './webhooks.ts';
import type { AppDeps } from './app.ts';

const idParams = { type: 'object', properties: { id: uuid } } as const;
const addr = { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', maxLength: 320 }, name: { type: 'string', maxLength: 200 } } } as const;

export function registerThreadRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const keys = () => {
    if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Linking conversations is not available on this server yet');
    return deps.keys;
  };

  async function loadBox(tx: Tx, id: string) {
    const r = await tx.query<{ id: string; name: string; owner_node_id: string; location: string | null }>(
      `SELECT b.id, b.name, b.owner_node_id, (SELECT n.name FROM org_nodes n WHERE n.id = b.context_node_id) AS location FROM boxes b WHERE b.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw notFound('Box not found');
    return r.rows[0];
  }

  // The text the person must accept before a conversation is stored (PRD Appendix A2).
  app.get('/v1/boxes/:id/link-notice', { schema: { params: idParams } }, async (req) => {
    const identity = await deps.authenticate(req);
    requireCrm(identity.ctx);
    const { id } = req.params as { id: string };
    return run(identity.ctx, async (tx) => {
      const box = await loadBox(tx, id);
      return {
        version: await currentNoticeVersion(tx),
        text: linkThreadNotice({ locale: identity.user.locale, region: deps.config.region, stored: deps.config.dataCountry, recordName: box.name, companyName: identity.user.tenantName, locationName: box.location ?? undefined }),
      };
    });
  });

  // Same notice before a box exists (the extension creates the box only after the person accepts).
  app.get('/v1/link-notice', { schema: { querystring: { type: 'object', required: ['recordName'], properties: { recordName: { type: 'string', minLength: 1, maxLength: 200 }, locationName: { type: 'string', maxLength: 200 } } } } }, async (req) => {
    const identity = await deps.authenticate(req);
    requireCrm(identity.ctx);
    const q = req.query as { recordName: string; locationName?: string };
    return run(identity.ctx, async (tx) => ({
      version: await currentNoticeVersion(tx),
      text: linkThreadNotice({ locale: identity.user.locale, region: deps.config.region, stored: deps.config.dataCountry, recordName: q.recordName, companyName: identity.user.tenantName, locationName: q.locationName }),
    }));
  });

  app.post(
    '/v1/boxes/:id/threads',
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        params: idParams,
        body: {
          type: 'object', required: ['gmailThreadId', 'acceptedNotice', 'messages'], additionalProperties: false,
          properties: {
            gmailThreadId: { type: 'string', minLength: 1, maxLength: 100 },
            acceptedNotice: { const: true },
            subject: { type: 'string', maxLength: 500 },
            messages: {
              type: 'array', minItems: 1, maxItems: 200,
              items: {
                type: 'object', required: ['gmailMessageId', 'body'], additionalProperties: false,
                properties: {
                  gmailMessageId: { type: 'string', minLength: 1, maxLength: 100 },
                  sentAt: { type: 'string', format: 'date-time' },
                  from: { type: 'string', maxLength: 500 },
                  to: { type: 'array', items: addr, maxItems: 100 },
                  subject: { type: 'string', maxLength: 500 },
                  body: { type: 'string', maxLength: 200000 },
                  attachments: { type: 'array', maxItems: 50, items: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 300 }, size: { type: 'integer', minimum: 0 } } } },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const identity = await deps.authenticate(req);
      const { ctx } = identity;
      requireCrm(ctx);
      const kp = keys();
      const { id } = req.params as { id: string };
      const b = req.body as {
        gmailThreadId: string; subject?: string;
        messages: { gmailMessageId: string; sentAt?: string; from?: string; to?: { email: string; name?: string }[]; subject?: string; body: string; attachments?: { name: string; size?: number }[] }[];
      };
      const effects: Effect[] = [];
      const out = await run(ctx, async (tx) => {
        const box = await loadBox(tx, id);
        requireEdit(ctx, box.owner_node_id);
        const version = await currentNoticeVersion(tx);
        const consentId = randomUUID();
        await tx.query(
          `INSERT INTO consent_records (id, tenant_id, user_id, kind, notice_version, locale, region) VALUES ($1,$2,$3,'link_thread',$4,$5,$6)`,
          [consentId, ctx.tenantId, ctx.userId, version, identity.user.locale, deps.config.region],
        );
        const existing = await tx.query<{ id: string }>('SELECT id FROM email_threads WHERE linked_by = $1 AND gmail_thread_id = $2', [ctx.userId, b.gmailThreadId]);
        const threadId = existing.rows[0]?.id ?? randomUUID();
        const people = new Map<string, { email: string; name: string }>();
        for (const m of b.messages) for (const p of m.to ?? []) people.set(p.email.toLowerCase(), { email: p.email, name: p.name ?? '' });
        const sorted = [...b.messages].sort((x, y) => (x.sentAt ?? '').localeCompare(y.sentAt ?? ''));
        const snippet = (sorted[sorted.length - 1]!.body || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!existing.rows[0]) {
          await tx.query(
            `INSERT INTO email_threads (id, tenant_id, owner_node_id, linked_by, gmail_thread_id, subject, snippet, participants, last_message_at, message_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [threadId, ctx.tenantId, box.owner_node_id, ctx.userId, b.gmailThreadId, b.subject ?? null, snippet, JSON.stringify([...people.values()].slice(0, 50)), sorted[sorted.length - 1]!.sentAt ?? null, 0],
          );
        }
        // the link must exist first: stored messages are only visible through a linked box
        await tx.query('INSERT INTO box_threads (box_id, thread_id, tenant_id, linked_by, consent_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (box_id, thread_id) DO NOTHING', [id, threadId, ctx.tenantId, ctx.userId, consentId]);
        for (const m of b.messages) {
          const sealed = seal(kp, m.body, `${ctx.tenantId}:${threadId}:${m.gmailMessageId}`);
          await tx.query(
            `INSERT INTO linked_thread_messages (tenant_id, thread_id, gmail_message_id, sent_at, from_addr, to_addrs, subject, body_enc, attachments, key_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (thread_id, gmail_message_id) DO UPDATE SET body_enc = EXCLUDED.body_enc, key_id = EXCLUDED.key_id, attachments = EXCLUDED.attachments, cached_at = now()`,
            [ctx.tenantId, threadId, m.gmailMessageId, m.sentAt ?? null, m.from ?? null, JSON.stringify(m.to ?? []), m.subject ?? null, sealed.data, JSON.stringify(m.attachments ?? []), sealed.keyId],
          );
        }
        await tx.query(
          `UPDATE email_threads SET message_count = (SELECT count(*) FROM linked_thread_messages WHERE thread_id = $1),
             last_message_at = (SELECT max(sent_at) FROM linked_thread_messages WHERE thread_id = $1), snippet = $2,
             participants = $3, subject = coalesce($4, subject) WHERE id = $1`,
          [threadId, snippet, JSON.stringify([...people.values()].slice(0, 50)), b.subject ?? null],
        );
        await audit(tx, ctx, 'thread_linked', 'box', id, { threadId, messages: b.messages.length });
        // "When a record gets its first received email": anything in the conversation that is not from the person linking it
        const me = identity.user.email.toLowerCase();
        if (b.messages.some((m) => m.from && !m.from.toLowerCase().includes(me))) {
          const st = (await tx.query<{ stage_id: string }>('SELECT stage_id FROM boxes WHERE id = $1', [id])).rows[0];
          if (st) await fireAutomations(tx, ctx, id, st.stage_id, 'email', effects);
        }
        return { threadId };
      });
      void flushEffects(deps, ctx.tenantId, effects);
      return reply.code(201).send(out);
    },
  );

  app.get('/v1/boxes/:id/threads', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await loadBox(tx, id);
      const rows = (
        await tx.query(
          `SELECT t.id, t.subject, t.snippet, t.participants, t.last_message_at AS "lastMessageAt", t.message_count AS "messageCount", bt.linked_by AS "linkedBy", bt.linked_at AS "linkedAt"
             FROM box_threads bt JOIN email_threads t ON t.id = bt.thread_id WHERE bt.box_id = $1 ORDER BY t.last_message_at DESC NULLS LAST`,
          [id],
        )
      ).rows;
      return { threads: rows };
    });
  });

  // Which boxes is the conversation I am looking at already linked to?
  app.get('/v1/threads/lookup', { schema: { querystring: { type: 'object', required: ['gmailThreadId'], properties: { gmailThreadId: { type: 'string', minLength: 1, maxLength: 100 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { gmailThreadId } = req.query as { gmailThreadId: string };
    return run(ctx, async (tx) => {
      const rows = (
        await tx.query(
          `SELECT t.id AS "threadId", b.id, b.name, b.pipeline_id AS "pipelineId", b.stage_id AS "stageId", b.owner_node_id AS "ownerNodeId"
             FROM email_threads t JOIN box_threads bt ON bt.thread_id = t.id JOIN boxes b ON b.id = bt.box_id
            WHERE t.linked_by = $1 AND t.gmail_thread_id = $2 ORDER BY b.name`,
          [ctx.userId, gmailThreadId],
        )
      ).rows;
      return { boxes: rows };
    });
  });

  app.get('/v1/threads/:id/messages', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const kp = keys();
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const t = await tx.query('SELECT 1 FROM email_threads WHERE id = $1', [id]);
      if (t.rowCount === 0) throw notFound('Conversation not found');
      const rows = (await tx.query('SELECT gmail_message_id, sent_at, from_addr, to_addrs, subject, body_enc, attachments, key_id FROM linked_thread_messages WHERE thread_id = $1 ORDER BY sent_at NULLS FIRST, gmail_message_id', [id])).rows;
      await audit(tx, ctx, 'thread_read', 'thread', id);
      return {
        messages: rows.map((r) => ({
          gmailMessageId: r.gmail_message_id, sentAt: r.sent_at, from: r.from_addr, to: r.to_addrs, subject: r.subject, attachments: r.attachments,
          body: open(kp, { keyId: r.key_id, data: r.body_enc }, `${ctx.tenantId}:${id}:${r.gmail_message_id}`).toString('utf8'),
        })),
      };
    });
  });

  // Point teammates at a conversation linked to a record. They already see it through the record; this tells them it is worth a look.
  app.post('/v1/threads/:id/share', { schema: { params: idParams, body: { type: 'object', required: ['userIds'], additionalProperties: false, properties: { userIds: { type: 'array', items: uuid, minItems: 1, maxItems: 20 }, boxId: uuid, message: { type: 'string', maxLength: 300 } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { userIds: string[]; boxId?: string; message?: string };
    const who = [...new Set(b.userIds)].filter((u) => u !== ctx.userId);
    if (who.length === 0) throw invalid('Choose a teammate to share with');
    const found = await run(ctx, async (tx) => {
      const t = (await tx.query<{ subject: string | null }>('SELECT subject FROM email_threads WHERE id = $1', [id])).rows[0];
      if (!t) throw notFound('Conversation not found');
      const link = (await tx.query<{ box_id: string; name: string }>(
        `SELECT bt.box_id, b.name FROM box_threads bt JOIN boxes b ON b.id = bt.box_id WHERE bt.thread_id = $1 AND ($2::uuid IS NULL OR bt.box_id = $2) ORDER BY b.name LIMIT 1`, [id, b.boxId ?? null])).rows[0];
      if (!link) throw notFound('That conversation is not linked to a record you can see');
      const people = (await tx.query<{ id: string; email: string }>('SELECT id, email::text AS email FROM app_users WHERE id = ANY($1::uuid[])', [who])).rows;
      if (people.length !== who.length) throw invalid('A person you chose is not visible to you');
      return { subject: t.subject, boxId: link.box_id, boxName: link.name, people };
    });
    // each person must be able to open the record themselves: look at it as them
    for (const p of found.people) {
      const cand = (await findLoginCandidates(deps.authPool, p.email)).find((c) => c.tenantId === ctx.tenantId && c.userId === p.id);
      const sees = cand ? await withRequestTx(deps.appPool, candidateToIdentity(cand).ctx, async (tx) => (await tx.query('SELECT 1 FROM boxes WHERE id = $1', [found.boxId])).rowCount === 1) : false;
      if (!sees) throw invalid('That person cannot see this record, so they cannot open the conversation');
    }
    await run(ctx, async (tx) => {
      for (const u of who) await notify(tx, { tenantId: ctx.tenantId, userId: u, actorId: ctx.userId, kind: 'thread_shared', boxId: found.boxId, data: { boxName: found.boxName, subject: found.subject, message: b.message?.trim() || undefined } });
      await audit(tx, ctx, 'thread_shared', 'box', found.boxId, { threadId: id, with: who.length });
    });
    return reply.code(204).send();
  });

  app.delete('/v1/boxes/:id/threads/:threadId', { schema: { params: { type: 'object', properties: { id: uuid, threadId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id, threadId } = req.params as { id: string; threadId: string };
    await run(ctx, async (tx) => {
      const box = await loadBox(tx, id);
      requireEdit(ctx, box.owner_node_id);
      const r = await tx.query('DELETE FROM box_threads WHERE box_id = $1 AND thread_id = $2', [id, threadId]);
      if (r.rowCount === 0) throw notFound('That conversation is not linked to this box');
      // the stored copy goes with the last link (trigger); drop the thread row too when nothing links to it
      await tx.query('DELETE FROM email_threads t WHERE t.id = $1 AND NOT EXISTS (SELECT 1 FROM box_threads WHERE thread_id = t.id)', [threadId]);
      await audit(tx, ctx, 'thread_unlinked', 'box', id, { threadId });
    });
    return reply.code(204).send();
  });
}
