import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { NAV_ITEMS, type NavLayout } from '@pii/domain';
import { requireCrm } from './crm-helpers.ts';
import { listRisks } from './risk.ts';
import { unreadCount } from './routes-notifications.ts';
import { resolveSettings } from './settings.ts';
import type { AppDeps } from './app.ts';

const NAMES: Record<string, Record<'en' | 'fr-CA', string>> = {
  home: { en: 'Home', 'fr-CA': 'Accueil' },
  notifications: { en: 'Notifications', 'fr-CA': 'Notifications' },
  pipelines: { en: 'Pipelines', 'fr-CA': 'Pipelines' },
  contacts: { en: 'Contacts', 'fr-CA': 'Contacts' },
  merges: { en: 'Mail merges', 'fr-CA': 'Publipostages' },
  training: { en: 'Training', 'fr-CA': 'Formation' },
  settings: { en: 'Settings', 'fr-CA': 'Paramètres' },
};

/** What Gmail's left panel shows for this person: their layout, limited to what their role can use, with live counts. */
export function registerNavRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/nav', async (req) => {
    const identity = await deps.authenticate(req);
    const { ctx } = identity;
    const loc = identity.user.locale === 'fr-CA' ? 'fr-CA' : 'en';
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const layout = (await resolveSettings(tx, ctx.userId, ['nav.layout']))['nav.layout']!.value as NavLayout;
      const hidden = new Set(layout.hidden);
      const order = layout.order.filter((id) => (NAV_ITEMS as readonly string[]).includes(id));
      for (const id of NAV_ITEMS) if (!order.includes(id)) order.push(id); // items added since the layout was saved
      const lms = process.env.LMS_ENABLED === '1';
      const ids = order.filter((id) => !hidden.has(id) && (id !== 'training' || (lms && ctx.roles.some((r) => r.role !== 'partner')))); // Training: switched on, and only for people who are more than a plain Partner
      if (!ids.includes('settings')) ids.push('settings'); // there is always a way back to Settings
      let tasksDue = 0;
      let pipelines: { id: string; name: string; count: number; views: { id: string; name: string }[] }[] = [];
      const unread = await unreadCount(tx, ctx.userId);
      if (ctx.canUseCrm) {
        tasksDue = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1 AND done_at IS NULL AND due_at < (date_trunc('day', now()) + interval '1 day')`, [ctx.userId])).rows[0]!.n;
        if (ids.includes('pipelines')) {
          const risks = await listRisks(tx, null);
          const list = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM pipelines ORDER BY name')).rows;
          const vs = (await tx.query<{ id: string; name: string; pipeline_id: string }>(
            'SELECT id, name, pipeline_id FROM saved_views WHERE is_shared OR user_id = $1 ORDER BY name', [ctx.userId])).rows;
          pipelines = list.map((p) => ({ id: p.id, name: p.name, count: risks.filter((r) => r.pipelineId === p.id).length, views: vs.filter((v) => v.pipeline_id === p.id).slice(0, 12).map((v) => ({ id: v.id, name: v.name })) }));
        }
      }
      return {
        items: ids.map((id) => ({ id, name: NAMES[id]![loc], count: id === 'home' ? tasksDue : id === 'notifications' ? unread : 0 })),
        pipelines,
      };
    });
  });

  app.get('/v1/home', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const tasks = (await tx.query(
        `SELECT t.id, t.title, t.due_at AS "dueAt", t.box_id AS "boxId", b.name AS "boxName", b.pipeline_id AS "pipelineId"
           FROM tasks t LEFT JOIN boxes b ON b.id = t.box_id
          WHERE t.assignee_id = $1 AND t.done_at IS NULL AND t.due_at < (date_trunc('day', now()) + interval '1 day') ORDER BY t.due_at LIMIT 12`, [ctx.userId])).rows;
      const upcoming = (await tx.query(
        `SELECT t.id, t.title, t.due_at AS "dueAt", t.box_id AS "boxId", b.name AS "boxName", b.pipeline_id AS "pipelineId"
           FROM tasks t LEFT JOIN boxes b ON b.id = t.box_id
          WHERE t.assignee_id = $1 AND t.done_at IS NULL AND (t.due_at IS NULL OR t.due_at >= (date_trunc('day', now()) + interval '1 day'))
          ORDER BY t.due_at NULLS LAST, t.created_at DESC LIMIT 12`, [ctx.userId])).rows;
      const risks = (await listRisks(tx, null)).slice(0, 8);
      const merges = (await tx.query(
        `SELECT m.id, m.name, m.status,
                count(r.id)::int AS total, count(r.id) FILTER (WHERE r.status = 'sent')::int AS sent, count(r.id) FILTER (WHERE r.status = 'failed')::int AS failed
           FROM mail_merges m LEFT JOIN mail_merge_recipients r ON r.merge_id = m.id
          WHERE m.status IN ('running', 'paused') GROUP BY m.id ORDER BY m.created_at DESC LIMIT 5`)).rows;
      const recent = (await tx.query(
        `SELECT b.id, b.name, b.pipeline_id AS "pipelineId", p.name AS pipeline, s.name AS stage, b.updated_at AS "updatedAt"
           FROM boxes b JOIN pipelines p ON p.id = b.pipeline_id JOIN stages s ON s.id = b.stage_id ORDER BY b.updated_at DESC LIMIT 8`)).rows;
      // Trending: records with the most activity (notes, tasks, stage moves) in the last 7 days.
      const trending = (await tx.query(
        `SELECT b.id, b.name, b.pipeline_id AS "pipelineId", p.name AS pipeline, s.name AS stage, b.updated_at AS "updatedAt", a.n::int AS activity
           FROM (SELECT box_id, count(*) AS n FROM (
                   SELECT box_id, created_at FROM notes UNION ALL SELECT box_id, created_at FROM tasks WHERE box_id IS NOT NULL UNION ALL SELECT box_id, created_at FROM box_events
                 ) x WHERE created_at > now() - interval '7 days' GROUP BY box_id) a
           JOIN boxes b ON b.id = a.box_id JOIN pipelines p ON p.id = b.pipeline_id JOIN stages s ON s.id = b.stage_id
          ORDER BY a.n DESC, b.updated_at DESC LIMIT 8`)).rows;
      const pins = (await tx.query(
        `SELECT v.id, v.name, v.pipeline_id AS "pipelineId", p.name AS pipeline
           FROM home_pins h JOIN saved_views v ON v.id = h.view_id JOIN pipelines p ON p.id = v.pipeline_id
          WHERE h.user_id = $1 AND (v.is_shared OR v.user_id = $1) ORDER BY h.position, v.name LIMIT 12`, [ctx.userId])).rows;
      const views = (await tx.query(
        `SELECT v.id, v.name, v.pipeline_id AS "pipelineId", p.name AS pipeline, (h.view_id IS NOT NULL) AS pinned
           FROM saved_views v JOIN pipelines p ON p.id = v.pipeline_id LEFT JOIN home_pins h ON h.view_id = v.id AND h.user_id = $1
          WHERE v.is_shared OR v.user_id = $1 ORDER BY p.name, v.name`, [ctx.userId])).rows;
      const defaultPipeline = String((await resolveSettings(tx, ctx.userId, ['ui.defaultPipeline']))['ui.defaultPipeline']?.value ?? '');
      const st = await resolveSettings(tx, ctx.userId, ['ui.goalRing', 'ui.weeklyGoal']);
      const done = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1 AND done_at >= date_trunc('week', now())`, [ctx.userId])).rows[0]!.n;
      const week = { ring: st['ui.goalRing']?.value !== false, goal: Number(st['ui.weeklyGoal']?.value ?? 10), done };
      return { week, tasks, upcoming, risks, merges, recent, trending, pins, views, defaultPipeline };
    });
  });

  // Which saved views are pinned to Home, in order. Replaces the whole list.
  app.put('/v1/home/pins', { schema: { body: { type: 'object', required: ['viewIds'], additionalProperties: false, properties: { viewIds: { type: 'array', maxItems: 12, items: { type: 'string', format: 'uuid' } } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { viewIds } = req.body as { viewIds: string[] };
    await withRequestTx(deps.appPool, ctx, async (tx) => {
      await tx.query('DELETE FROM home_pins WHERE user_id = $1', [ctx.userId]);
      for (const [i, id] of viewIds.entries()) {
        await tx.query(
          `INSERT INTO home_pins (tenant_id, user_id, view_id, position)
           SELECT $1, $2, v.id, $4 FROM saved_views v WHERE v.id = $3 AND (v.is_shared OR v.user_id = $2) ON CONFLICT DO NOTHING`, [ctx.tenantId, ctx.userId, id, i]);
      }
    });
    return reply.code(204).send();
  });
}
