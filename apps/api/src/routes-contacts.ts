import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { invalid, notFound } from './errors.ts';
import { page, pageQuery, requireCrm, requireEdit, resolveOwnerAndContext, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const idParams = { type: 'object', properties: { id: uuid } } as const;
const CONTACT_COLS = `c.id, c.owner_node_id AS "ownerNodeId", c.context_node_id AS "contextNodeId", c.account_id AS "accountId",
  c.email, c.full_name AS "fullName", c.phone, c.custom, c.created_at AS "createdAt"`;
const ACCOUNT_COLS = `a.id, a.owner_node_id AS "ownerNodeId", a.context_node_id AS "contextNodeId", a.name, a.domain, a.created_at AS "createdAt"`;

// Contacts carry a small free-form bag of values (no pipeline here); keep it flat and bounded.
const customSchema = { type: 'object', maxProperties: 20, additionalProperties: { type: ['string', 'number', 'boolean'] } } as const;

export function registerContactRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  async function accountVisible(tx: Tx, id: string) {
    const r = await tx.query('SELECT 1 FROM accounts WHERE id = $1', [id]);
    if (r.rowCount === 0) throw invalid('That account does not exist');
  }
  async function loadOwner(tx: Tx, table: 'contacts' | 'accounts', id: string): Promise<string> {
    const r = await tx.query<{ owner_node_id: string }>(`SELECT owner_node_id FROM ${table} WHERE id = $1`, [id]);
    if (!r.rows[0]) throw notFound(table === 'contacts' ? 'Contact not found' : 'Account not found');
    return r.rows[0].owner_node_id;
  }

  // ---- accounts ----
  app.post(
    '/v1/accounts',
    { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, domain: { type: 'string', maxLength: 253 }, ownerNodeId: uuid, contextNodeId: uuid } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const b = req.body as { name: string; domain?: string; ownerNodeId?: string; contextNodeId?: string };
      const out = await run(ctx, async (tx) => {
        const o = await resolveOwnerAndContext(tx, ctx, b);
        const id = randomUUID();
        await tx.query('INSERT INTO accounts (id, tenant_id, owner_node_id, context_node_id, name, domain) VALUES ($1,$2,$3,$4,$5,$6)', [id, ctx.tenantId, o.ownerNodeId, o.contextNodeId, b.name.trim(), b.domain?.trim().toLowerCase() ?? null]);
        await audit(tx, ctx, 'account_created', 'account', id);
        return { id, ...o };
      });
      return reply.code(201).send(out);
    },
  );
  app.get('/v1/accounts', { schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, ...pageQuery } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const q = req.query as { q?: string; limit?: number; offset?: number };
    const { limit, offset } = page(q);
    return run(ctx, async (tx) => ({
      accounts: (await tx.query(`SELECT ${ACCOUNT_COLS} FROM accounts a WHERE ($1::text IS NULL OR a.name ILIKE '%' || $1 || '%' OR a.domain ILIKE '%' || $1 || '%') ORDER BY a.name, a.id LIMIT $2 OFFSET $3`, [q.q ?? null, limit, offset])).rows,
      limit, offset,
    }));
  });
  app.get('/v1/accounts/:id', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const a = (await tx.query(`SELECT ${ACCOUNT_COLS} FROM accounts a WHERE a.id = $1`, [id])).rows[0];
      if (!a) throw notFound('Account not found');
      const contacts = (await tx.query(`SELECT ${CONTACT_COLS} FROM contacts c WHERE c.account_id = $1 ORDER BY c.full_name`, [id])).rows;
      return { ...a, contacts };
    });
  });
  app.patch(
    '/v1/accounts/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, domain: { type: ['string', 'null'], maxLength: 253 } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; domain?: string | null };
      await run(ctx, async (tx) => {
        requireEdit(ctx, await loadOwner(tx, 'accounts', id));
        await tx.query('UPDATE accounts SET name = coalesce($2, name), domain = CASE WHEN $3 THEN $4 ELSE domain END WHERE id = $1', [id, b.name?.trim() ?? null, 'domain' in b, b.domain?.trim().toLowerCase() ?? null]);
        await audit(tx, ctx, 'account_updated', 'account', id, { fields: Object.keys(b) });
      });
      return reply.code(204).send();
    },
  );
  app.delete('/v1/accounts/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      requireEdit(ctx, await loadOwner(tx, 'accounts', id));
      await tx.query('UPDATE contacts SET account_id = NULL WHERE account_id = $1', [id]);
      await tx.query('DELETE FROM accounts WHERE id = $1', [id]);
      await audit(tx, ctx, 'account_deleted', 'account', id);
    });
    return reply.code(204).send();
  });

  // ---- contacts ----
  app.post(
    '/v1/contacts',
    {
      schema: {
        body: {
          type: 'object', additionalProperties: false, anyOf: [{ required: ['email'] }, { required: ['fullName'] }],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 }, fullName: { type: 'string', minLength: 1, maxLength: 200 },
            phone: { type: 'string', maxLength: 40 }, accountId: uuid, ownerNodeId: uuid, contextNodeId: uuid, custom: customSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const b = req.body as { email?: string; fullName?: string; phone?: string; accountId?: string; ownerNodeId?: string; contextNodeId?: string; custom?: Record<string, unknown> };
      const out = await run(ctx, async (tx) => {
        const o = await resolveOwnerAndContext(tx, ctx, b);
        if (b.accountId) await accountVisible(tx, b.accountId);
        const id = randomUUID();
        await tx.query(
          'INSERT INTO contacts (id, tenant_id, owner_node_id, context_node_id, account_id, email, full_name, phone, custom) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [id, ctx.tenantId, o.ownerNodeId, o.contextNodeId, b.accountId ?? null, b.email ?? null, b.fullName?.trim() ?? null, b.phone ?? null, JSON.stringify(b.custom ?? {})],
        );
        await audit(tx, ctx, 'contact_created', 'contact', id);
        return { id, ...o };
      });
      return reply.code(201).send(out);
    },
  );
  app.get('/v1/contacts', { schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, accountId: uuid, ...pageQuery } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const q = req.query as { q?: string; accountId?: string; limit?: number; offset?: number };
    const { limit, offset } = page(q);
    return run(ctx, async (tx) => ({
      contacts: (
        await tx.query(
          `SELECT ${CONTACT_COLS} FROM contacts c
            WHERE ($1::text IS NULL OR c.full_name ILIKE '%' || $1 || '%' OR c.email::text ILIKE '%' || $1 || '%')
              AND ($2::uuid IS NULL OR c.account_id = $2)
            ORDER BY c.full_name, c.id LIMIT $3 OFFSET $4`,
          [q.q ?? null, q.accountId ?? null, limit, offset],
        )
      ).rows,
      limit, offset,
    }));
  });
  app.get('/v1/contacts/:id', { schema: { params: idParams } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const c = (await tx.query(`SELECT ${CONTACT_COLS} FROM contacts c WHERE c.id = $1`, [id])).rows[0];
      if (!c) throw notFound('Contact not found');
      const boxes = (await tx.query(`SELECT b.id, b.name, b.stage_id AS "stageId", b.pipeline_id AS "pipelineId" FROM box_contacts bc JOIN boxes b ON b.id = bc.box_id WHERE bc.contact_id = $1 ORDER BY b.name`, [id])).rows;
      return { ...c, boxes };
    });
  });
  app.patch(
    '/v1/contacts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: {
            email: { type: ['string', 'null'], maxLength: 320 }, fullName: { type: ['string', 'null'], maxLength: 200 }, phone: { type: ['string', 'null'], maxLength: 40 },
            accountId: { anyOf: [uuid, { type: 'null' }] }, custom: customSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const b = req.body as { email?: string | null; fullName?: string | null; phone?: string | null; accountId?: string | null; custom?: Record<string, unknown> };
      if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw invalid('Invalid email address');
      await run(ctx, async (tx) => {
        requireEdit(ctx, await loadOwner(tx, 'contacts', id));
        if (b.accountId) await accountVisible(tx, b.accountId);
        await tx.query(
          `UPDATE contacts SET email = CASE WHEN $2 THEN $3::citext ELSE email END, full_name = CASE WHEN $4 THEN $5 ELSE full_name END,
             phone = CASE WHEN $6 THEN $7 ELSE phone END, account_id = CASE WHEN $8 THEN $9::uuid ELSE account_id END,
             custom = coalesce($10::jsonb, custom) WHERE id = $1`,
          [id, 'email' in b, b.email ?? null, 'fullName' in b, b.fullName?.trim() ?? null, 'phone' in b, b.phone ?? null, 'accountId' in b, b.accountId ?? null, b.custom ? JSON.stringify(b.custom) : null],
        );
        await audit(tx, ctx, 'contact_updated', 'contact', id, { fields: Object.keys(b) });
      });
      return reply.code(204).send();
    },
  );
  app.delete('/v1/contacts/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      requireEdit(ctx, await loadOwner(tx, 'contacts', id));
      await tx.query('DELETE FROM contacts WHERE id = $1', [id]);
      await audit(tx, ctx, 'contact_deleted', 'contact', id);
    });
    return reply.code(204).send();
  });
}
