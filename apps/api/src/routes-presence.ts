import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import type { AppDeps } from './app.ts';

/** Partners in the caller's branch who are active right now, with their Google photo when they have one. */
export async function branchPartnersOnline(tx: Tx): Promise<{ id: string; name: string; pictureUrl: string | null }[]> {
  const { rows } = await tx.query<{ user_id: string; display_name: string | null; picture_url: string | null }>(
    `SELECT user_id, display_name, picture_url FROM app_branch_partners_online()`,
  );
  return rows.map((r) => ({ id: r.user_id, name: r.display_name ?? '', pictureUrl: r.picture_url }));
}

export function registerPresenceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  // Called by the web app about once a minute while its tab is open: marks the caller as active now.
  app.post('/v1/presence', async (req) => {
    const { ctx } = await deps.authenticate(req);
    await run(ctx, (tx) => tx.query('SELECT app_touch_presence()'));
    return { ok: true };
  });

  app.get('/v1/presence/partners', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return { partners: await run(ctx, branchPartnersOnline) };
  });
}
