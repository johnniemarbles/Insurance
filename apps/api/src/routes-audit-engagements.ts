// External auditor engagements (annual-review plan, section C). The President & CEO or a Compliance Manager invites an auditor to one
// named engagement. The auditor gets a login with no role; it sees only its own engagements, only while they are open, and every
// opening is recorded. Access ends on the end date by itself, or when the inviter ends the engagement early.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { newToken } from '@pii/platform';
import {
  AUDIT_SCOPE_AREAS, defaultEndsOn, engagementDateProblem, engagementStatus, type EngagementStatus, type RequestContext,
} from '@pii/domain';
import { audit } from './audit.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const ENGAGEMENT_INVITE_DAYS = 7;
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const today = (): string => new Date().toISOString().slice(0, 10);

interface EngagementRow {
  id: string; title: string; deputedBy: string; deputedByName: string | null; auditorEmail: string; linked: boolean; scope: string[];
  masked: boolean; startsOn: string; endsOn: string; endedAt: Date | null;
}

const COLS = `e.id, e.title, e.deputed_by AS "deputedBy", e.deputed_by_name AS "deputedByName", e.auditor_email::text AS "auditorEmail",
  (e.auditor_user_id IS NOT NULL) AS linked, e.scope, e.masked, e.starts_on::text AS "startsOn", e.ends_on::text AS "endsOn", e.ended_at AS "endedAt"`;

const withStatus = (r: EngagementRow) => ({
  ...r, endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  status: engagementStatus({ startsOn: r.startsOn, endsOn: r.endsOn, endedAt: r.endedAt ? r.endedAt.toISOString() : null, linked: r.linked }, today()),
});

/** Only the President & CEO or a Compliance Manager may invite an auditor or end an engagement. */
function requireInviter(ctx: RequestContext): void {
  if (!ctx.isTenantAdmin && !ctx.roles.some((r) => r.role === 'compliance')) {
    throw forbidden('Only the President & CEO or a Compliance Manager can manage auditor engagements');
  }
}

/**
 * The gate every auditor read goes through: the engagement must be the caller's own and open today. Returns the scope or refuses.
 * A refusal is never written to the trail as a view; an opening is.
 */
export async function openEngagement(tx: Tx, ctx: RequestContext, id: string): Promise<EngagementRow & { status: EngagementStatus }> {
  const row = (await tx.query<EngagementRow>(`SELECT ${COLS} FROM audit_engagements e WHERE e.id = $1`, [id])).rows[0];
  if (!row || !(await tx.query('SELECT 1 FROM audit_engagements WHERE id = $1 AND auditor_user_id = app_user_id()', [id])).rowCount) {
    throw notFound('Unknown engagement');
  }
  const status = engagementStatus({ startsOn: row.startsOn, endsOn: row.endsOn, endedAt: row.endedAt ? row.endedAt.toISOString() : null, linked: true }, today());
  if (status !== 'active') throw forbidden('This engagement is not open to you today');
  await audit(tx, ctx, 'audit_engagement_viewed', 'audit_engagement', id, { scope: row.scope, masked: row.masked });
  return { ...row, status };
}

export function registerAuditEngagementRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.post('/v1/audit/engagements', {
    schema: { body: { type: 'object', required: ['email', 'title', 'deputedBy', 'scope'], additionalProperties: false, properties: {
      email: { type: 'string', format: 'email', maxLength: 320 },
      title: { type: 'string', minLength: 3, maxLength: 160 },
      deputedBy: { type: 'string', enum: ['regulator', 'insurer', 'other'] },
      deputedByName: { type: ['string', 'null'], maxLength: 120 },
      scope: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...AUDIT_SCOPE_AREAS] } },
      masked: { type: 'boolean' },
      startsOn: DATE, endsOn: DATE,
    } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireInviter(ctx);
    const b = req.body as { email: string; title: string; deputedBy: string; deputedByName?: string | null; scope: string[]; masked?: boolean; startsOn?: string; endsOn?: string };
    const email = b.email.trim().toLowerCase();
    const startsOn = b.startsOn ?? today();
    const endsOn = b.endsOn ?? defaultEndsOn(startsOn);
    const problem = engagementDateProblem(startsOn, endsOn);
    if (problem) throw invalid(problem);
    // An auditor is not staff. Someone who already holds a role in this company gets the role's access instead, so they are refused here.
    const holdsRole = (await deps.authPool.query(
      `SELECT 1 FROM app_users u JOIN user_node_roles r ON r.user_id = u.id WHERE u.tenant_id = $1 AND u.email = $2 LIMIT 1`, [ctx.tenantId, email])).rowCount;
    if (holdsRole) throw conflict('This person already has a role in this company. An auditor needs a login of its own');
    const out = await run(ctx, async (tx) => {
      const rootId = (await tx.query<{ id: string }>(`SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant'`, [ctx.tenantId])).rows[0]!.id;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO audit_engagements (tenant_id, title, deputed_by, deputed_by_name, auditor_email, scope, masked, starts_on, ends_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [ctx.tenantId, b.title.trim(), b.deputedBy, b.deputedByName?.trim() || null, email, b.scope, b.masked ?? true, startsOn, endsOn, ctx.userId]);
      const id = rows[0]!.id;
      const { token, hash } = newToken();
      const expiresAt = new Date(Date.now() + ENGAGEMENT_INVITE_DAYS * 86_400_000);
      await tx.query(
        `INSERT INTO invitations (tenant_id, email, node_id, role, locale, token_hash, invited_by, expires_at, audit_engagement_id)
         VALUES ($1, $2, $3, 'auditor', 'en', $4, $5, $6, $7)`,
        [ctx.tenantId, email, rootId, hash, ctx.userId, expiresAt, id]);
      await audit(tx, ctx, 'audit_engagement_created', 'audit_engagement', id, { deputedBy: b.deputedBy, scope: b.scope, startsOn, endsOn });
      return { id, status: 'invited', startsOn, endsOn, acceptUrl: `${deps.config.appOrigin}/accept?token=${token}` };
    });
    return reply.code(201).send(out);
  });

  /** The engagements this caller may see: all of them for the President & CEO and Compliance Managers; its own for an auditor. */
  const list = async (req: FastifyRequest) => {
    const { ctx } = await deps.authenticate(req);
    const rows = await run(ctx, (tx) => tx.query<EngagementRow>(`SELECT ${COLS} FROM audit_engagements e ORDER BY e.starts_on DESC, e.created_at DESC`));
    return { engagements: rows.rows.map(withStatus) };
  };
  app.get('/v1/audit/engagements', list);
  app.get('/v1/audit/me', list);

  app.get('/v1/audit/engagements/:id/access', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const id = (req.params as { id: string }).id;
    const row = await run(ctx, (tx) => openEngagement(tx, ctx, id));
    return { id: row.id, title: row.title, scope: row.scope, masked: row.masked, endsOn: row.endsOn, status: row.status };
  });

  app.post('/v1/audit/engagements/:id/end', async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireInviter(ctx);
    const id = (req.params as { id: string }).id;
    await run(ctx, async (tx) => {
      const row = (await tx.query<{ endedAt: Date | null; endsOn: string }>(
        `SELECT ended_at AS "endedAt", ends_on::text AS "endsOn" FROM audit_engagements WHERE id = $1`, [id])).rows[0];
      if (!row) throw notFound('Unknown engagement');
      if (row.endedAt || row.endsOn < today()) throw conflict('This engagement has already ended');
      await tx.query(`UPDATE audit_engagements SET ended_at = now(), ended_by = $2 WHERE id = $1`, [id, ctx.userId]);
      await audit(tx, ctx, 'audit_engagement_ended', 'audit_engagement', id, {});
    });
    return reply.code(204).send();
  });
}
