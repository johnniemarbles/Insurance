// Trainer dashboard (plan v6, section 9): course assignments, progress and what is due, for the branches the viewer may see.
// Enrolments are read through row-level security, so a trainer sees its assigned branches and nobody else's learners.
import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { forbidden } from './errors.ts';
import type { AppDeps } from './app.ts';

const TRAINING_ROLES = ['trainer', 'manager', 'admin'];

export function registerTrainingDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/training/dashboard', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const trains = ctx.isTenantAdmin || ctx.roles.some((r) => TRAINING_ROLES.includes(r.role));
    if (!trains) throw forbidden('Only trainers and managers see the training dashboard');
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const totals = (await tx.query<{ assigned: number; inProgress: number; completed: number; overdue: number }>(
        `SELECT count(*)::int AS assigned,
                count(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
                count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status <> 'completed' AND due_at < now())::int AS overdue
           FROM enrollments`)).rows[0]!;
      const courses = (await tx.query(
        `SELECT title, count(*)::int AS assigned,
                count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status <> 'completed' AND due_at < now())::int AS overdue
           FROM (SELECT coalesce(l.title, 'Untitled course') AS title, e.status, e.due_at
                   FROM enrollments e LEFT JOIN course_locales l ON l.course_id = e.course_id AND l.locale = 'en') x
          GROUP BY title ORDER BY title`)).rows;
      const branches = (await tx.query(
        `SELECT n.name, count(*)::int AS assigned,
                count(*) FILTER (WHERE e.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE e.status <> 'completed' AND e.due_at < now())::int AS overdue
           FROM enrollments e JOIN org_nodes n ON n.id = e.learner_node_id
          GROUP BY n.id, n.name ORDER BY n.name`)).rows;
      return { totals, courses, branches };
    });
  });
}
