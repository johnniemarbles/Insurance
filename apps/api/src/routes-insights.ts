import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { notFound } from './errors.ts';
import { requireCrm, scopeSql, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

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
}
