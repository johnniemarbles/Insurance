// Sub-brokers (plan v6 section 2; plan v7 sections 2 and 3). An active broker's administrator requests a sub-broker; the branch's
// Compliance Manager starts its file, which creates the node, the file and the invitation together. Depth is three levels of
// brokers from the branch (broker, sub-broker, sub-sub-broker). Sub-brokers open only once the parent broker is Active.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { BROKER_TYPES, type BrokerType, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import { createPartnerInvitation, sendPartnerInvitation } from './partner-invite.ts';
import type { AppDeps } from './app.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEPTH = 3;
const body = (req: FastifyRequest): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;
const str = (v: unknown, label: string, max: number): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw invalid(`${label} is required (up to ${max} characters)`);
  return v.trim();
};
const id = (raw: string, what: string): string => {
  if (!UUID.test(raw)) throw notFound(`Unknown ${what}`);
  return raw;
};

async function holdsComplianceAbove(tx: Tx, nodeId: string): Promise<boolean> {
  return (await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_node_roles r JOIN org_reach o ON o.ancestor_id = r.node_id
                     WHERE r.user_id = app_user_id() AND r.role::text = 'compliance' AND o.descendant_id = $1) AS ok`, [nodeId])).rows[0]?.ok === true;
}

/** Broker levels from the branch down to this node, the node itself included (1 for a top-level broker). */
async function brokerDepth(tx: Tx, nodeId: string): Promise<number> {
  return (await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM org_partner_closure WHERE descendant_id = $1', [nodeId])).rows[0]?.n ?? 0;
}

async function nameTaken(tx: Tx, name: string): Promise<boolean> {
  return (await tx.query<{ id: string }>(`SELECT id FROM org_nodes WHERE type = 'partner' AND lower(name) = lower($1) LIMIT 1`, [name])).rowCount! > 0;
}

export function registerSubBrokerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  /** The administrator of an active broker (by its onboarding case) asks for a sub-broker. Nothing is created until the Compliance Manager starts it. */
  app.post('/v1/onboarding/cases/:caseId/sub-brokers', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const caseId = id((req.params as { caseId: string }).caseId, 'onboarding case');
    const b = body(req);
    const name = str(b.name, 'name', 200);
    if (name.includes('@')) throw invalid('Enter the business name, not an email address');
    if (!BROKER_TYPES.includes(b.type as never)) throw invalid('type must be individual or corporate');
    const adminEmail = str(b.adminEmail, 'adminEmail', 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw invalid('Enter a valid email address for the sub-broker administrator');
    const out = await run(ctx, async (tx) => {
      const parent = (await tx.query<{ tenantId: string; parentId: string; isActive: boolean; stage: string }>(
        `SELECT c.tenant_id AS "tenantId", c.node_id AS "parentId", n.is_active AS "isActive", c.stage
           FROM onboarding_cases c JOIN org_nodes n ON n.id = c.node_id WHERE c.id = $1`, [caseId])).rows[0];
      if (!parent || !parent.isActive) throw notFound('Unknown broker');
      const parentId = parent.parentId;
      const admin = (await tx.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = $1 AND user_id = app_user_id() AND role::text = 'admin') AS ok`, [parentId])).rows[0]?.ok === true;
      if (!admin) throw forbidden('Only the administrator of this broker can request a sub-broker');
      if (parent.stage !== 'active') throw conflict('Sub-brokers open once this broker is Active');
      if ((await brokerDepth(tx, parentId)) >= MAX_DEPTH) throw conflict('Sub-brokers stop at three levels of brokers');
      if (await nameTaken(tx, name)) throw conflict('A broker with this name is already in the company');
      const r = (await tx.query<{ id: string }>(
        `INSERT INTO sub_broker_requests (tenant_id, parent_node_id, name, broker_type, admin_email, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [parent.tenantId, parentId, name, b.type, adminEmail, ctx.userId])).rows[0]!;
      await audit(tx, ctx, 'onboarding.sub_broker_requested', 'sub_broker_request', r.id, { name, type: b.type }, parentId);
      return { id: r.id, parentId };
    });
    reply.code(201);
    return { id: out.id, status: 'requested' as const, parentId: out.parentId };
  });

  /** The requests this person may see: the branch's Compliance Manager, and the parent broker's own people. */
  app.get('/v1/onboarding/sub-broker-requests', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT r.id, r.name, r.broker_type AS "brokerType", r.status, r.requested_at AS "requestedAt",
                r.started_node_id AS "startedNodeId", r.parent_node_id AS "parentId", p.name AS "parentName"
           FROM sub_broker_requests r JOIN org_nodes p ON p.id = r.parent_node_id
          ORDER BY r.requested_at DESC`)).rows;
      return { requests: rows };
    });
  });

  /** The branch's Compliance Manager starts the file: the sub-broker node, its link, its file and its invitation, together. */
  app.post('/v1/onboarding/sub-broker-requests/:rid/start', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const rid = id((req.params as { rid: string }).rid, 'request');
    const locale: 'en' | 'fr-CA' = body(req).locale === 'fr-CA' ? 'fr-CA' : 'en';
    const out = await run(ctx, async (tx) => {
      const r = (await tx.query<{ tenantId: string; parentId: string; name: string; brokerType: BrokerType; adminEmail: string; status: string; country: string }>(
        `SELECT r.tenant_id AS "tenantId", r.parent_node_id AS "parentId", r.name, r.broker_type AS "brokerType", r.admin_email AS "adminEmail",
                r.status, t.country_code::text AS country
           FROM sub_broker_requests r JOIN tenants t ON t.id = r.tenant_id WHERE r.id = $1`, [rid])).rows[0];
      if (!r) throw notFound('Unknown sub-broker request');
      if (!(await holdsComplianceAbove(tx, r.parentId))) throw forbidden('Only the Compliance Manager for this branch can start a sub-broker\'s file');
      if (r.status !== 'requested') throw conflict('This request is already started');
      if ((await brokerDepth(tx, r.parentId)) >= MAX_DEPTH) throw conflict('Sub-brokers stop at three levels of brokers');
      if (await nameTaken(tx, r.name)) throw conflict('A broker with this name is already in the company. Search for it and start its file instead.');
      const nodeId = randomUUID();
      await tx.query(`INSERT INTO org_nodes (id, tenant_id, type, name) VALUES ($1, $2, 'partner', $3)`, [nodeId, r.tenantId, r.name]);
      await tx.query(`INSERT INTO org_links (tenant_id, parent_id, child_id, kind, created_by) VALUES ($1, $2, $3, 'partner_link', $4)`,
        [r.tenantId, r.parentId, nodeId, ctx.userId]);
      await audit(tx, ctx, 'node_created', 'org_node', nodeId, { type: 'partner', name: r.name, parentId: r.parentId, kind: 'partner_link' }, nodeId);
      const caseRow = (await tx.query<{ id: string }>(
        `INSERT INTO onboarding_cases (tenant_id, node_id, country, broker_type) VALUES ($1, $2, $3, $4) RETURNING id`,
        [r.tenantId, nodeId, r.country, r.brokerType])).rows[0]!;
      await audit(tx, ctx, 'onboarding.invited', 'onboarding_case', caseRow.id, { partner: r.name, country: r.country, type: r.brokerType, subBrokerOf: r.parentId });
      await tx.query(`UPDATE sub_broker_requests SET status = 'started', started_node_id = $2, started_by = $3, started_at = now() WHERE id = $1`,
        [rid, nodeId, ctx.userId]);
      const inv = await createPartnerInvitation(tx, ctx, { caseId: caseRow.id, nodeId, email: r.adminEmail, locale });
      return {
        id: caseRow.id, nodeId, stage: 'invited' as const,
        invitation: { ...inv, email: r.adminEmail, locale, tenantId: r.tenantId },
      };
    });
    const { invitation, ...view } = out;
    const sent = await sendPartnerInvitation(deps, ctx, invitation);
    reply.code(201);
    return { ...view, invitation: { id: invitation.id, email: invitation.email, status: sent.status, error: sent.error ?? null, mailConfigured: Boolean(deps.mailer) } };
  });
}
