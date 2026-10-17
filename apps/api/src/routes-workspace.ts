import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import type { AppDeps } from './app.ts';

/** Server-resolved workspace discovery. Never grants access by itself. */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/workspace/context', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = [...new Set(ctx.roles.map(r => r.role))];
    const admin = ctx.isTenantAdmin || roles.includes('admin');
    const training = admin || roles.includes('trainer') || roles.includes('manager');
    const compliance = admin || roles.includes('compliance');
    const audit = admin || roles.includes('auditor') || roles.includes('compliance') || roles.length === 0;
    const crm = Boolean(ctx.canUseCrm);
    const modules = {
      crm, compliance, training, learning: true, audit,
      onboarding: compliance || crm,
      carriers: compliance,
      notifications: true,
    };
    // Node names are returned only if visible through the caller's RLS context.
    const scopes = await withRequestTx(deps.appPool, ctx, async tx =>
      (await tx.query<{id:string;name:string}>(
        'SELECT id, name FROM org_nodes WHERE id = ANY($1::uuid[]) ORDER BY name',
        [ctx.nodeIds],
      )).rows,
    );
    return {
      version: 1,
      tenantId: ctx.tenantId,
      country: deps.config.region === 'us' ? 'US' : 'CA',
      roles: roles.length ? roles : ['auditor'],
      activeNodeIds: ctx.nodeIds,
      isTenantAdmin: Boolean(ctx.isTenantAdmin),
      modules,
      scopes,
      // The dashboard never accepts arbitrary node IDs as an authority.
      scopeMode: 'server-authorized',
    };
  });
}
