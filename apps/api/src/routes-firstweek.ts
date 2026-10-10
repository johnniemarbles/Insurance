import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { computeFirstWeek, type RequestContext } from '@pii/domain';
import { uuid } from './crm-helpers.ts';
import { notFound } from './errors.ts';
import { buildFile, countryOf } from './routes-compliance.ts';
import { loadPacks } from './routes-ce.ts';
import type { AppDeps } from './app.ts';

/** The first-week checklist for one partner company. Row-level security decides whether the caller may see the partner. */
export async function firstWeekFor(tx: Tx, ctx: RequestContext, nodeId: string, country: 'CA' | 'US') {
  const node = (await tx.query<{ id: string; name: string; created: number }>(
    `SELECT id, name, (current_date - created_at::date)::int AS created FROM org_nodes WHERE id = $1 AND type = 'partner' AND is_active AND org_node_at_or_below(tenant_id, id)`, [nodeId])).rows[0];
  if (!node) throw notFound('Unknown partner');
  const f = await buildFile(tx, ctx, node, country);
  const n = async (sql: string) => Number((await tx.query<{ n: number }>(sql, [nodeId])).rows[0]!.n);
  const active = `u.status::text <> 'disabled'`;
  const people = await n(`SELECT count(*)::int AS n FROM app_users u WHERE u.home_node_id = $1 AND ${active}`);
  const ceLicensees = await n(`SELECT count(DISTINCT l.user_id)::int AS n FROM learner_licences l JOIN app_users u ON u.id = l.user_id WHERE l.node_id = $1 AND ${active}`);
  const assigned = await n(`SELECT count(*)::int AS n FROM enrollments e JOIN app_users u ON u.id = e.user_id WHERE e.learner_node_id = $1 AND ${active}`);
  const completed = await n(`SELECT count(*)::int AS n FROM enrollments e JOIN app_users u ON u.id = e.user_id WHERE e.learner_node_id = $1 AND e.status = 'completed' AND ${active}`);
  const clients = await n(`SELECT count(*)::int AS n FROM boxes b WHERE b.owner_node_id = $1`);
  const appointed = (f.appointments as { status: string }[]).filter((a) => a.status === 'appointed').length;
  const status = (f.profile as { status?: string } | null)?.status ?? null;
  const week = computeFirstWeek({
    file: { profile: f.profile as never, licences: (f.items as { kind: string }[]).filter((i) => i.kind === 'licence').length, eoCount: (f.items as { kind: string }[]).filter((i) => i.kind === 'eo').length,
            eoMaxLimit: (f.items as { kind: string; limitAmount: number | null; daysLeft: number | null }[]).filter((i) => i.kind === 'eo' && (i.daysLeft === null || i.daysLeft >= 0)).reduce<number | null>((m, i) => (i.limitAmount !== null && (m === null || i.limitAmount > m) ? i.limitAmount : m), null),
            eoMin: f.eoMin },
    status, appointments: { total: f.appointments.length, appointed }, people, cePacks: (await loadPacks(tx)).length > 0, ceLicensees,
    training: { assigned, completed }, clients, daysSince: node.created,
  });
  return { applicable: true as const, node: { id: node.id, name: node.name }, ...week, counts: { people, ceLicensees, assigned, completed, clients } };
}

export function registerFirstWeekRoutes(app: FastifyInstance, deps: AppDeps): void {
  const country = countryOf(deps.config.region);
  const guideUrl = `${deps.config.appOrigin}/guide`;
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.get('/v1/first-week/:nodeId', { schema: { params: { type: 'object', properties: { nodeId: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { nodeId } = req.params as { nodeId: string };
    return { ...(await run(ctx, (tx) => firstWeekFor(tx, ctx, nodeId, country))), guideUrl };
  });

  // The signed-in person's own partner company, for the Home card. Head office and people who sit above partners get nothing.
  app.get('/v1/first-week', async (req) => {
    const { ctx, user } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const home = (await tx.query<{ id: string; type: string }>('SELECT n.id, n.type::text AS type FROM app_users u JOIN org_nodes n ON n.id = u.home_node_id WHERE u.id = $1', [user.userId])).rows[0];
      if (!home || home.type !== 'partner' || !ctx.canUseCrm) return { applicable: false as const, guideUrl };
      const w = await firstWeekFor(tx, ctx, home.id, country);
      return { ...w, guideUrl };
    });
  });
}
