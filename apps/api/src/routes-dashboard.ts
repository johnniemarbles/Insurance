import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { requireCrm, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

/**
 * Dashboard: one call, numbers only. Everything is read through the viewer's own row-level visibility,
 * so a branch sees its branch, a company sees the company, and a person sees what they may already open.
 */
export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/v1/dashboard',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 7, maximum: 730 }, pipelineId: uuid } } } },
    async (req) => {
      const { ctx } = await deps.authenticate(req);
      requireCrm(ctx);
      const q = req.query as { days?: number; pipelineId?: string };
      const days = q.days ?? 30;
      const pid = q.pipelineId ?? null;
      return withRequestTx(deps.appPool, ctx, async (tx) => {
        const base = `FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE ($2::uuid IS NULL OR b.pipeline_id = $2)`;
        const k = (
          await tx.query(
            `SELECT count(*) FILTER (WHERE NOT s.is_won AND NOT s.is_lost)::int AS "openCount",
                    coalesce(sum(b.value_amount) FILTER (WHERE NOT s.is_won AND NOT s.is_lost), 0)::float8 AS "openValue",
                    count(*) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1))::int AS "won",
                    coalesce(sum(b.value_amount) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1)), 0)::float8 AS "wonValue",
                    count(*) FILTER (WHERE s.is_lost AND b.stage_entered_at >= now() - make_interval(days => $1))::int AS "lost",
                    count(*) FILTER (WHERE b.created_at >= now() - make_interval(days => $1))::int AS "created",
                    avg(extract(epoch FROM (b.stage_entered_at - b.created_at)) / 86400) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1))::float8 AS "daysToWin"
               ${base}`, [days, pid],
          )
        ).rows[0] as { openCount: number; openValue: number; won: number; wonValue: number; lost: number; created: number; daysToWin: number | null };

        const months = (
          await tx.query(
            `SELECT to_char(m, 'YYYY-MM') AS month,
                    (SELECT count(*)::int FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE s.is_won AND ($1::uuid IS NULL OR b.pipeline_id = $1) AND b.stage_entered_at >= m AND b.stage_entered_at < m + interval '1 month') AS won,
                    (SELECT coalesce(sum(b.value_amount), 0)::float8 FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE s.is_won AND ($1::uuid IS NULL OR b.pipeline_id = $1) AND b.stage_entered_at >= m AND b.stage_entered_at < m + interval '1 month') AS "wonValue",
                    (SELECT count(*)::int FROM boxes b WHERE ($1::uuid IS NULL OR b.pipeline_id = $1) AND b.created_at >= m AND b.created_at < m + interval '1 month') AS created
               FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`, [pid],
          )
        ).rows;

        const aging = (
          await tx.query(
            `SELECT bucket, count(*)::int AS count, coalesce(sum(v), 0)::float8 AS value FROM (
               SELECT CASE WHEN d <= 7 THEN '0-7' WHEN d <= 30 THEN '8-30' WHEN d <= 90 THEN '31-90' ELSE '90+' END AS bucket, b.value_amount AS v
                 FROM (SELECT b.*, floor(extract(epoch FROM (now() - b.stage_entered_at)) / 86400) AS d ${base} AND NOT s.is_won AND NOT s.is_lost AND $1::int IS NOT NULL) b) x
              GROUP BY bucket`, [days, pid],
          )
        ).rows as { bucket: string; count: number; value: number }[];
        const agingOut = ['0-7', '8-30', '31-90', '90+'].map((b) => aging.find((a) => a.bucket === b) ?? { bucket: b, count: 0, value: 0 });

        const stages = (
          await tx.query(
            `SELECT s.name, min(s.position)::int AS pos, count(b.id)::int AS count, coalesce(sum(b.value_amount), 0)::float8 AS value
               FROM stages s JOIN pipelines p ON p.id = s.pipeline_id LEFT JOIN boxes b ON b.stage_id = s.id
              WHERE NOT s.is_won AND NOT s.is_lost AND ($1::uuid IS NULL OR s.pipeline_id = $1)
              GROUP BY s.name ORDER BY min(s.position), s.name`, [pid],
          )
        ).rows;

        const people = (
          await tx.query(
            `SELECT coalesce(u.display_name, u.email::text) AS name,
                    count(*) FILTER (WHERE NOT s.is_won AND NOT s.is_lost)::int AS "open",
                    coalesce(sum(b.value_amount) FILTER (WHERE NOT s.is_won AND NOT s.is_lost), 0)::float8 AS "openValue",
                    count(*) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1))::int AS "won",
                    coalesce(sum(b.value_amount) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1)), 0)::float8 AS "wonValue",
                    (SELECT count(*)::int FROM box_events e WHERE e.actor_id = b.owner_user_id AND e.created_at >= now() - make_interval(days => $1)) AS "moves"
               ${base} AND b.owner_user_id IS NOT NULL
              GROUP BY u.display_name, u.email, b.owner_user_id
              ORDER BY 5 DESC, 2 DESC LIMIT 10`.replace('FROM boxes b JOIN stages s ON s.id = b.stage_id', 'FROM boxes b JOIN stages s ON s.id = b.stage_id JOIN app_users u ON u.id = b.owner_user_id'), [days, pid],
          )
        ).rows;

        const pipelines = (await tx.query('SELECT id, name FROM pipelines ORDER BY name')).rows;
        return {
          days,
          totals: { ...k, winRate: k.won + k.lost > 0 ? k.won / (k.won + k.lost) : null },
          months, aging: agingOut, stages, people, pipelines,
        };
      });
    },
  );
}
