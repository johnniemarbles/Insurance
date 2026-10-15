import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { canAddBroker, canChangeStructure, linkKindFor, type OrgNodeType, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const uuidSchema = { type: 'string', format: 'uuid' } as const;
const nameSchema = { type: 'string', minLength: 1, maxLength: 200 } as const;

/** True when the actor holds an admin role on this partner node or on any partner above it. */
async function isAdminOnPartnerChain(tx: Tx, ctx: RequestContext, nodeId: string): Promise<boolean> {
  if (ctx.adminNodeIds.length === 0) return false;
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM org_partner_closure WHERE descendant_id = $1 AND ancestor_id = ANY($2::uuid[])) AS ok`,
    [nodeId, ctx.adminNodeIds],
  );
  return rows[0]?.ok === true;
}

async function nodeType(tx: Tx, id: string): Promise<OrgNodeType> {
  const { rows } = await tx.query<{ type: OrgNodeType }>('SELECT type FROM org_nodes WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Unknown organization node');
  return rows[0].type;
}

export function registerOrgRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.get('/v1/org/nodes', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const { rows } = await tx.query(`SELECT id, type, name, is_active AS "isActive" FROM org_nodes ORDER BY type, name`);
      return { nodes: rows };
    });
  });

  app.get('/v1/org/links', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      // Only links where the caller can see both ends.
      const { rows } = await tx.query(
        `SELECT parent_id AS "parentId", child_id AS "childId", kind FROM org_links
          WHERE parent_id IN (SELECT id FROM org_nodes) AND child_id IN (SELECT id FROM org_nodes)`,
      );
      return { links: rows };
    });
  });

  app.post('/v1/org/locations', { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: nameSchema } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin) throw forbidden('Only a tenant admin can create a location');
    const { name } = req.body as { name: string };
    const out = await run(ctx, async (tx) => {
      const id = randomUUID();
      await tx.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'location', $3)`, [id, ctx.tenantId, name.trim()]);
      await audit(tx, ctx, 'node_created', 'org_node', id, { type: 'location', name }, id);
      return { id };
    });
    return reply.code(201).send(out);
  });

  // Create a partner (or sub-partner) and link it under a parent in one step.
  app.post(
    '/v1/org/partners',
    { schema: { body: { type: 'object', required: ['name', 'parentId'], additionalProperties: false, properties: { name: nameSchema, parentId: uuidSchema } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { name, parentId } = req.body as { name: string; parentId: string };
      const out = await run(ctx, async (tx) => {
        const parentType = await nodeType(tx, parentId);
        const kind = linkKindFor(parentType, 'partner');
        if (!kind) throw invalid('A partner can only be created under a location or another partner');
        // A broker under a branch is added with Add broker, which creates its file in the same step (plan v7, section 5).
        if (parentType === 'location') throw forbidden('Brokers under a branch are added with Add broker, which starts their file at once');
        const adminOnChain = parentType === 'partner' ? await isAdminOnPartnerChain(tx, ctx, parentId) : false;
        if (!canAddBroker({ isTenantAdmin: ctx.isTenantAdmin, isComplianceForBranch: false }, parentType, adminOnChain)) throw forbidden();
        // No RETURNING: a brand-new, not-yet-linked node is invisible to a partner admin until the link exists.
        const id = randomUUID();
        await tx.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'partner', $3)`, [id, ctx.tenantId, name.trim()]);
        await tx.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind, created_by) VALUES ($1, $2, $3, $4, $5)`, [ctx.tenantId, parentId, id, kind, ctx.userId]);
        await audit(tx, ctx, 'node_created', 'org_node', id, { type: 'partner', name, parentId, kind }, id);
        return { id, kind };
      });
      return reply.code(201).send(out);
    },
  );

  // Link two existing nodes (e.g. a partner that serves a second location). Tenant admins only.
  app.post(
    '/v1/org/links',
    { schema: { body: { type: 'object', required: ['parentId', 'childId'], additionalProperties: false, properties: { parentId: uuidSchema, childId: uuidSchema } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { parentId, childId } = req.body as { parentId: string; childId: string };
      if (!ctx.isTenantAdmin) throw forbidden('Only a tenant admin can link existing nodes');
      const out = await run(ctx, async (tx) => {
        const kind = linkKindFor(await nodeType(tx, parentId), await nodeType(tx, childId));
        if (!kind) throw invalid('Those two kinds of node cannot be linked');
        await tx.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind, created_by) VALUES ($1, $2, $3, $4, $5)`, [ctx.tenantId, parentId, childId, kind, ctx.userId]);
        await audit(tx, ctx, 'link_changed', 'org_node', childId, { op: 'add', parentId, kind });
        return { parentId, childId, kind };
      });
      return reply.code(201).send(out);
    },
  );

  app.delete(
    '/v1/org/links',
    { schema: { querystring: { type: 'object', required: ['parentId', 'childId'], properties: { parentId: uuidSchema, childId: uuidSchema } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { parentId, childId } = req.query as { parentId: string; childId: string };
      await run(ctx, async (tx) => {
        const { rows } = await tx.query<{ kind: 'location_link' | 'partner_link' }>(
          `SELECT kind FROM org_links WHERE parent_id = $1 AND child_id = $2
              AND parent_id IN (SELECT id FROM org_nodes) AND child_id IN (SELECT id FROM org_nodes)`,
          [parentId, childId],
        );
        const link = rows[0];
        if (!link) throw notFound('No such link');
        const adminOnChain = link.kind === 'partner_link' ? await isAdminOnPartnerChain(tx, ctx, parentId) : false;
        if (!canChangeStructure(ctx, link.kind, adminOnChain)) throw forbidden();
        await tx.query('DELETE FROM org_links WHERE parent_id = $1 AND child_id = $2', [parentId, childId]);
        await audit(tx, ctx, 'link_changed', 'org_node', childId, { op: 'remove', parentId, kind: link.kind });
      });
      return reply.code(204).send();
    },
  );

  // Rename or switch off a company, branch or partner. Nothing is ever deleted (history).
  app.patch(
    '/v1/org/nodes/:id',
    { schema: { params: { type: 'object', properties: { id: uuidSchema } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: nameSchema, isActive: { type: 'boolean' } } } } },
    async (req, reply) => {
      const { ctx } = await deps.authenticate(req);
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; isActive?: boolean };
      await run(ctx, async (tx) => {
        const type = await nodeType(tx, id);
        const ok = ctx.isTenantAdmin || (type === 'partner' && (await isAdminOnPartnerChain(tx, ctx, id)));
        if (!ok) throw forbidden(type === 'partner' ? undefined : 'Only a company administrator can change this');
        if (type === 'tenant' && b.isActive === false) throw invalid('The company itself cannot be switched off');
        if (b.name !== undefined) {
          await tx.query('UPDATE org_nodes SET name = $2 WHERE id = $1', [id, b.name.trim()]);
          if (type === 'tenant') await tx.query('UPDATE tenants SET name = $1 WHERE id = $2', [b.name.trim(), ctx.tenantId]);
        }
        if (b.isActive !== undefined) await tx.query('UPDATE org_nodes SET is_active = $2 WHERE id = $1', [id, b.isActive]);
        await audit(tx, ctx, 'node_updated', 'org_node', id, b, id);
      });
      return reply.code(204).send();
    },
  );
}
