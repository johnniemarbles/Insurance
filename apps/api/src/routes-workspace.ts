import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import type { AppDeps } from './app.ts';

/** Server-resolved workspace discovery. Never grants access by itself. */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/workspace/context', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = [...new Set(ctx.roles.map(r => r.role))];
    const isTenantAdmin = Boolean(ctx.isTenantAdmin);
    const compliance = isTenantAdmin || roles.includes('compliance');
    const training = isTenantAdmin || roles.includes('trainer') || roles.includes('manager');

    // Node names and audit engagement links are resolved strictly through RLS.
    const { scopes, hasAuditEngagement } = await withRequestTx(deps.appPool, ctx, async tx => {
      const s = (await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM org_nodes WHERE id = ANY($1::uuid[]) ORDER BY name',
        [ctx.nodeIds],
      )).rows;
      const a = (await tx.query(
        'SELECT 1 FROM audit_engagements WHERE auditor_user_id = app_user_id() LIMIT 1'
      )).rowCount! > 0;
      return { scopes: s, hasAuditEngagement: a };
    });

    const isAuditor = roles.includes('auditor') || hasAuditEngagement;
    const audit = isTenantAdmin || compliance || isAuditor;
    const crm = Boolean(ctx.canUseCrm) && (isTenantAdmin || roles.some(r => r === 'admin' || r === 'manager' || r === 'partner' || r === 'staff'));

    const modules = {
      crm, compliance, training, learning: true, audit,
      onboarding: compliance || crm,
      carriers: compliance,
      notifications: true,
    };

    // A user with no roles who is not linked to an engagement does NOT get the auditor role.
    const resolvedRoles = roles.length ? roles : isAuditor ? ['auditor'] : [];

    return {
      version: 1,
      tenantId: ctx.tenantId,
      country: deps.config.region === 'us' ? 'US' : 'CA',
      roles: resolvedRoles,
      activeNodeIds: ctx.nodeIds,
      isTenantAdmin: Boolean(ctx.isTenantAdmin),
      modules,
      scopes,
      // The dashboard never accepts arbitrary node IDs as an authority.
      scopeMode: 'server-authorized',
    };
  });
}
