import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { snapshotBefore } from './snapshots.ts';
import { notFound } from './errors.ts';
import { requireCrm, scopeSql, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';
import { listRisks } from './risk.ts';

const DATE_RE = '^\\d{4}-\\d{2}-\\d{2}$';

/** Reports and the activity feed. Everything is read through the viewer's own row-level visibility. */
export function registerInsightRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/v1/pipelines/:id/report',
    { schema: { params: { type: 'object', properties: { id: uuid } }, querystring: { type: 'object', properties: { scope: { enum: ['mine', 'below', 'all'] } } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const { id } = req.params as { id: string };
      const scope = (req.query as { scope?: string }).scope ?? 'all';
      return withRequestTx(deps.appPool, ctx, async (tx) => {
        if ((await tx.query('SELECT 1 FROM pipelines WHERE id = $1', [id])).rowCount === 0) throw notFound('Pipeline not found');
        const args = [id, scope, ctx.nodeIds];
        const stages = (
          await tx.query(
            `SELECT s.id AS "stageId", s.name, s.is_won AS "isWon", s.is_lost AS "isLost",
                    count(b.id)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value,
                    coalesce(avg(floor(extract(epoch FROM (now() - b.stage_entered_at)) / 86400)), 0)::float8 AS "avgDays",
                    (SELECT count(DISTINCT e.box_id)::int FROM box_events e JOIN boxes bb ON bb.id = e.box_id
                      WHERE e.to_stage_id = s.id AND bb.pipeline_id = $1 AND ${scopeSql(2, 'bb')}) AS reached
               FROM stages s LEFT JOIN boxes b ON b.stage_id = s.id AND ${scopeSql(2)}
              WHERE s.pipeline_id = $1 GROUP BY s.id, s.position, s.name, s.is_won, s.is_lost ORDER BY s.position`,
            args,
          )
        ).rows;
        const weekly = (
          await tx.query(
            `SELECT to_char(w, 'YYYY-MM-DD') AS week,
                    (SELECT count(*)::int FROM boxes b WHERE b.pipeline_id = $1 AND ${scopeSql(2)} AND b.created_at >= w AND b.created_at < w + interval '7 days') AS created
               FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w ORDER BY w`,
            args,
          )
        ).rows;
        const owners = (
          await tx.query(
            `SELECT coalesce(u.display_name, u.email::text) AS name, count(*)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value,
                    count(*) FILTER (WHERE s.is_won)::int AS won
               FROM boxes b JOIN stages s ON s.id = b.stage_id LEFT JOIN app_users u ON u.id = b.owner_user_id
              WHERE b.pipeline_id = $1 AND ${scopeSql(2, 'b')}
              GROUP BY 1 ORDER BY 3 DESC LIMIT 20`,
            args,
          )
        ).rows;
        const forecast = (
          await tx.query(
            `SELECT coalesce(to_char(b.close_date, 'YYYY-MM'), '') AS month, count(*)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value
               FROM boxes b JOIN stages s ON s.id = b.stage_id
              WHERE b.pipeline_id = $1 AND ${scopeSql(2, 'b')} AND NOT s.is_won AND NOT s.is_lost
              GROUP BY 1 ORDER BY 1`,
            args,
          )
        ).rows;
        const win = (
          await tx.query(
            `SELECT coalesce(avg(extract(epoch FROM (w.created_at - c.created_at)) / 86400), 0)::float8 AS "daysToWin", count(*)::int AS wins
               FROM boxes b
               JOIN box_events w ON w.box_id = b.id AND w.to_stage_id IN (SELECT id FROM stages WHERE pipeline_id = $1 AND is_won)
               JOIN box_events c ON c.box_id = b.id AND c.kind = 'created'
              WHERE b.pipeline_id = $1 AND ${scopeSql(2, 'b')}`,
            args,
          )
        ).rows[0] as { daysToWin: number; wins: number };
        const won = stages.filter((s: any) => s.isWon).reduce((n: number, s: any) => n + s.count, 0);
        const lost = stages.filter((s: any) => s.isLost).reduce((n: number, s: any) => n + s.count, 0);
        return {
          stages, weekly, owners, forecast,
          totals: {
            open: stages.filter((s: any) => !s.isWon && !s.isLost).reduce((n: number, s: any) => n + s.count, 0),
            openValue: stages.filter((s: any) => !s.isWon && !s.isLost).reduce((n: number, s: any) => n + s.value, 0),
            won, wonValue: stages.filter((s: any) => s.isWon).reduce((n: number, s: any) => n + s.value, 0), lost,
            winRate: won + lost > 0 ? won / (won + lost) : null,
            daysToWin: win.wins > 0 ? win.daysToWin : null,
          },
        };
      });
    },
  );

  // Who did what, newest first: records created, stages moved, notes written.
  app.get(
    '/v1/newsfeed',
    { schema: { querystring: { type: 'object', properties: { pipelineId: uuid, scope: { enum: ['mine', 'below', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const q = req.query as { pipelineId?: string; scope?: string; limit?: number };
      return withRequestTx(deps.appPool, ctx, async (tx) => {
        const items = (
          await tx.query(
            `SELECT * FROM (
               SELECT e.id::text AS id, e.kind, e.created_at AS "at", b.id AS "boxId", b.name AS "boxName",
                      coalesce(u.display_name, u.email::text) AS actor, fs.name AS "fromStage", ts.name AS "toStage", NULL::text AS body
                 FROM box_events e JOIN boxes b ON b.id = e.box_id
                 LEFT JOIN app_users u ON u.id = e.actor_id LEFT JOIN stages fs ON fs.id = e.from_stage_id LEFT JOIN stages ts ON ts.id = e.to_stage_id
                WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND ${scopeSql(2, 'b')}
               UNION ALL
               SELECT n.id::text, 'note', n.created_at, b.id, b.name, coalesce(u.display_name, u.email::text), NULL, NULL, left(n.body, 200)
                 FROM notes n JOIN boxes b ON b.id = n.box_id LEFT JOIN app_users u ON u.id = n.author_id
                WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND ${scopeSql(2, 'b')}
             ) f ORDER BY "at" DESC LIMIT $4`,
            [q.pipelineId ?? null, q.scope ?? 'all', ctx.nodeIds, q.limit ?? 50],
          )
        ).rows;
        return { items };
      });
    },
  );

  // One call for the Overview page of a company or branch administrator: numbers only, read through the viewer's own visibility,
  // so a branch sees its branch and a company sees the company. Names appear only for the people who did the work this week.
  app.get('/v1/insights/overview', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const now = await overviewNumbers(tx);
      // Only the whole-company view is compared with the past: the saved snapshots are company-wide.
      const prev = ctx.isTenantAdmin ? await snapshotBefore(tx, 'company', 30) : null;
      return { ...now, prev };
    });
  });
}
/** The numbers behind the Overview page, read through whatever the transaction's person may see. */
export async function overviewNumbers(tx: Tx) {
  const stages = (
    await tx.query(
      `SELECT s.name, min(s.position)::int AS pos, bool_or(s.is_won) AS "isWon", bool_or(s.is_lost) AS "isLost",
              count(b.id)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value
         FROM stages s LEFT JOIN boxes b ON b.stage_id = s.id GROUP BY s.name ORDER BY min(s.position), s.name`,
    )
  ).rows as { name: string; pos: number; isWon: boolean; isLost: boolean; count: number; value: number }[];
  const open = stages.filter((s) => !s.isWon && !s.isLost);
  const won = stages.filter((s) => s.isWon).reduce((n, s) => n + s.count, 0);
  const lost = stages.filter((s) => s.isLost).reduce((n, s) => n + s.count, 0);
  const tasks = (
    await tx.query(
      `SELECT count(*) FILTER (WHERE due_at < date_trunc('day', now()))::int AS overdue,
              count(*) FILTER (WHERE due_at >= date_trunc('day', now()) AND due_at < date_trunc('day', now()) + interval '1 day')::int AS today,
              count(*)::int AS open
         FROM tasks WHERE done_at IS NULL`,
    )
  ).rows[0] as { overdue: number; today: number; open: number };
  const ren = (
    await tx.query(
      `SELECT count(*) FILTER (WHERE d < current_date)::int AS expired, count(*) FILTER (WHERE d >= current_date AND d <= current_date + 30)::int AS d30,
              coalesce((SELECT jsonb_agg(coalesce(c.n, 0) ORDER BY g.w) FROM generate_series(0, 12) g(w)
                 LEFT JOIN (SELECT ((d - current_date) / 7) AS w, count(*) AS n FROM (SELECT (b.custom->>'renewal_date')::date AS d FROM boxes b JOIN stages s ON s.id = b.stage_id
                              WHERE b.custom->>'renewal_date' ~ '${DATE_RE}' AND NOT s.is_won AND NOT s.is_lost) y WHERE d >= current_date AND d < current_date + 91 GROUP BY 1) c ON c.w = g.w), '[]'::jsonb) AS weeks
         FROM (SELECT (b.custom->>'renewal_date')::date AS d FROM boxes b JOIN stages s ON s.id = b.stage_id
                WHERE b.custom->>'renewal_date' ~ '${DATE_RE}' AND NOT s.is_won AND NOT s.is_lost AND (b.custom->>'renewal_date')::date BETWEEN current_date - 365 AND current_date + 365) x`,
    )
  ).rows[0] as { expired: number; d30: number; weeks: number[] };
  const people = (
    await tx.query(
      `SELECT name, count(*)::int AS count FROM (
         SELECT coalesce(u.display_name, u.email::text) AS name FROM box_events e JOIN app_users u ON u.id = e.actor_id WHERE e.created_at > now() - interval '7 days'
         UNION ALL
         SELECT coalesce(u.display_name, u.email::text) FROM notes n JOIN app_users u ON u.id = n.author_id WHERE n.created_at > now() - interval '7 days') a
        GROUP BY name ORDER BY 2 DESC, 1 LIMIT 8`,
    )
  ).rows as { name: string; count: number }[];
  const team = (
    await tx.query(
      `SELECT count(DISTINCT r.user_id)::int AS n FROM user_node_roles r JOIN org_nodes n ON n.id = r.node_id WHERE org_node_at_or_below(n.tenant_id, n.id)`,
    )
  ).rows[0] as { n: number };
  const part = (
    await tx.query(
      `SELECT count(*)::int AS partners,
              count(*) FILTER (WHERE p.status = 'approved')::int AS approved,
              count(*) FILTER (WHERE p.status = 'submitted')::int AS submitted,
              count(*) FILTER (WHERE coalesce(p.status, 'incomplete') NOT IN ('approved', 'submitted'))::int AS incomplete,
              (SELECT count(*)::int FROM compliance_items i WHERE i.expires_on < current_date) AS "itemsExpired",
              (SELECT count(*)::int FROM compliance_items i WHERE i.expires_on >= current_date AND i.expires_on <= current_date + 30) AS "itemsSoon"
         FROM org_nodes n LEFT JOIN compliance_profiles p ON p.node_id = n.id
        WHERE n.type = 'partner' AND n.is_active AND org_node_at_or_below(n.tenant_id, n.id)`,
    )
  ).rows[0] as { partners: number; approved: number; submitted: number; incomplete: number; itemsExpired: number; itemsSoon: number };
  const risks = (await listRisks(tx, null)).length;
  return {
    pipeline: {
      stages: open.map((s) => ({ name: s.name, count: s.count, value: s.value })),
      openCount: open.reduce((n, s) => n + s.count, 0), openValue: open.reduce((n, s) => n + s.value, 0),
      won, lost, winRate: won + lost > 0 ? won / (won + lost) : null, stalled: risks,
    },
    tasks, renewals: ren, activity: people, team: team.n, partners: part,
  };
}
