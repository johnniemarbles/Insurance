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
      const ids = order.filter((id) => !hidden.has(id) && (lms || id !== 'training'));
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
      return { tasks, upcoming, risks, merges, recent };
    });
  });
}
