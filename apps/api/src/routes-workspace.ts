import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import type { AppDeps } from './app.ts';

/** Server-resolved workspace discovery. Never grants access by itself. */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/workspace/context', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = [...new Set(ctx.roles.map(r => r.role))];
    const isTenantAdmin = Boolean(ctx.isTenantAdmin);
    const admin = isTenantAdmin || roles.includes('admin');
    const compliance = isTenantAdmin || roles.includes('compliance');
    const training = admin || roles.includes('trainer') || roles.includes('manager');

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
    const audit = admin || compliance || isAuditor;
    const crm = Boolean(ctx.canUseCrm) && (admin || roles.some(r => ['partner', 'manager', 'staff'].includes(r)));

    const modules = {
      crm, compliance, training, learning: true, audit,
      onboarding: compliance || crm,
      carriers: compliance,
      notifications: true,
    };

    // A user with no roles who is not linked to an engagement does NOT get the auditor role.
    const resolvedRoles = isTenantAdmin
      ? (roles.includes('admin') ? roles : ['admin', ...roles])
      : (roles.length ? roles : (isAuditor ? ['auditor'] : []));

    return {
      version: 1,
      tenantId: ctx.tenantId,
      country: deps.config.region === 'us' ? 'US' : 'CA',
      roles: resolvedRoles,
      activeNodeIds: ctx.nodeIds,
      isTenantAdmin,
      modules,
      scopes,
      // The dashboard never accepts arbitrary node IDs as an authority.
      scopeMode: 'server-authorized',
    };
  });
}
