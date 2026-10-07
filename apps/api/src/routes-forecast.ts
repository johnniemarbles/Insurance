import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { courseNudge, ceNudge, groupDeadlines, deadlineBucket, daysBetween, type Deadline } from '@pii/domain';
import { actingAs } from './effects.ts';
import { tell } from './routes-compliance.ts';
import { loadPacks, hoursIn, evaluateFor } from './routes-ce.ts';
import type { AppDeps } from './app.ts';

const today = () => new Date().toISOString().slice(0, 10);

interface CeRow { userId: string; name: string; packCode: string; packName: string; state: string; termEnd: string; daysLeft: number; remaining: number }

/** Every CE term the caller can see (row-level security decides who), with where each stands today. */
async function ceRows(tx: Tx, day: string): Promise<CeRow[]> {
  const packs = await loadPacks(tx);
  const lic = (await tx.query<{ user_id: string; name: string; pack_code: string; licence_class: string; licensed_since: string | null }>(
    `SELECT l.user_id, coalesce(u.display_name, u.email::text) AS name, l.pack_code, l.licence_class, l.licensed_since::text
       FROM learner_licences l JOIN app_users u ON u.id = l.user_id WHERE u.status::text <> 'disabled' LIMIT 2000`)).rows;
  if (!lic.length) return [];
  const entries = (await tx.query<{ user_id: string; pack_code: string; category: string; hours: string; completed_on: string; status: string }>(
    `SELECT user_id, pack_code, category, hours::text, completed_on::text, status FROM ce_entries WHERE user_id = ANY($1::uuid[])`, [[...new Set(lic.map((l) => l.user_id))]])).rows;
  const out: CeRow[] = [];
  for (const l of lic) {
    const p = packs.find((x) => x.code === l.pack_code); if (!p) continue;
    const ev = evaluateFor(p, l.licence_class, hoursIn(entries.filter((e) => e.user_id === l.user_id), p, day), l.licensed_since, day);
    if (!ev) continue;
    out.push({ userId: l.user_id, name: l.name, packCode: p.code, packName: p.name, state: ev.state, termEnd: ev.termEnd, daysLeft: ev.daysLeft, remaining: ev.remaining });
  }
  return out;
}

export function registerForecastRoutes(app: FastifyInstance, deps: AppDeps): void {
  /** Everything with a date, for the next 90 days and anything already late, in one list. Each person sees what their role already shows them. */
  app.get('/v1/compliance/calendar', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const day = today();
      const items: Deadline[] = [];
      for (const r of (await tx.query<{ id: string; kind: string; label: string; name: string; due: string; days: number; node: string }>(
        `SELECT i.id, i.kind, i.label, n.name, i.expires_on::text AS due, (i.expires_on - current_date)::int AS days, i.node_id AS node
           FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id AND n.is_active
          WHERE i.expires_on IS NOT NULL AND i.expires_on <= current_date + 90 AND i.expires_on >= current_date - 365 LIMIT 1000`)).rows)
        items.push({ kind: r.kind === 'eo' ? 'eo' : 'licence', id: r.id, label: r.label, who: r.name, dueOn: r.due, daysLeft: r.days, nodeId: r.node });
      for (const r of (await tx.query<{ id: string; title: string; name: string; due: string; days: number }>(
        `SELECT e.id, coalesce((SELECT title FROM course_locales WHERE course_id = e.course_id AND locale = 'en'), (SELECT title FROM course_locales WHERE course_id = e.course_id LIMIT 1), '') AS title,
                coalesce(u.display_name, u.email::text) AS name, e.due_at::date::text AS due, (e.due_at::date - current_date)::int AS days
           FROM enrollments e JOIN app_users u ON u.id = e.user_id
          WHERE e.status <> 'completed' AND e.due_at IS NOT NULL AND u.status::text <> 'disabled' AND e.due_at::date <= current_date + 90 LIMIT 1000`)).rows)
        items.push({ kind: 'course', id: r.id, label: r.title, who: r.name, dueOn: r.due, daysLeft: r.days });
      for (const c of await ceRows(tx, day)) {
        if (c.state === 'met' || c.state === 'exempt' || deadlineBucket(c.daysLeft) === null && c.daysLeft >= 0) continue;
        items.push({ kind: 'ce', id: `${c.userId}:${c.packCode}`, label: c.packName, who: c.name, dueOn: c.termEnd, daysLeft: c.daysLeft });
      }
      const groups = groupDeadlines(items.filter((i) => i.daysLeft >= -365));
      return { today: day, groups, counts: { overdue: groups.overdue.length, d30: groups.d30.length, d60: groups.d60.length, d90: groups.d90.length } };
    });
  });
}

/**
 * Daily nudges for learners: a course a week from its due date (and again once it is late), and a CE term that is at risk or overdue.
 * Each person is told each situation once; the mark says so. Returns how many notices were made.
 */
export async function sweepLearnerReminders(deps: AppDeps): Promise<number> {
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  const day = today();
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const admin = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      const mark = (tx: Tx, userId: string, key: string) => tx.query('INSERT INTO reminder_marks (tenant_id, user_id, key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.tenant_id, userId, key]).then((r) => (r.rowCount ?? 0) > 0);
      const todo = await withRequestTx(deps.appPool, admin, async (tx) => {
        const out: { userId: string; kind: 'learning_due' | 'ce_reminder'; data: Record<string, unknown> }[] = [];
        const courses = (await tx.query<{ id: string; user_id: string; title: string; due: string; days: number }>(
          `SELECT e.id, e.user_id, coalesce((SELECT title FROM course_locales WHERE course_id = e.course_id AND locale = 'en'), (SELECT title FROM course_locales WHERE course_id = e.course_id LIMIT 1), '') AS title,
                  e.due_at::date::text AS due, (e.due_at::date - current_date)::int AS days
             FROM enrollments e JOIN app_users u ON u.id = e.user_id
            WHERE e.status <> 'completed' AND e.due_at IS NOT NULL AND e.due_at::date <= current_date + 7 AND u.status::text <> 'disabled' LIMIT 2000`)).rows;
        for (const c of courses) {
          const stage = courseNudge(c.days); if (!stage) continue;
          if (await mark(tx, c.user_id, `course:${c.id}:${stage}:${c.due}`)) out.push({ userId: c.user_id, kind: 'learning_due', data: { title: c.title, daysLeft: c.days, dueOn: c.due, enrollmentId: c.id } });
        }
        for (const c of await ceRows(tx, day)) {
          const s = ceNudge(c.state); if (!s) continue;
          if (await mark(tx, c.userId, `ce:${c.packCode}:${c.termEnd}:${s}`)) out.push({ userId: c.userId, kind: 'ce_reminder', data: { pack: c.packName, state: s, daysLeft: c.daysLeft, remaining: c.remaining, termEnd: c.termEnd } });
        }
        return out;
      });
      for (const n of todo) { await tell(deps, t.tenant_id, [n.userId], n.kind, null, n.data); made++; }
    } catch { /* next company */ }
  }
  return made;
}

/** Applies every assignment rule again, so people who joined a branch after it was assigned are enrolled too. */
export async function sweepAssignments(deps: AppDeps): Promise<number> {
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const admin = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      made += await withRequestTx(deps.appPool, admin, async (tx) => {
        let n = 0;
        for (const a of (await tx.query<{ id: string }>(`SELECT a.id FROM course_assignments a JOIN courses c ON c.id = a.course_id AND c.status = 'published' LIMIT 2000`)).rows)
          n += (await tx.query<{ n: number }>('SELECT sync_enrollments($1) AS n', [a.id])).rows[0]!.n;
        return n;
      });
    } catch { /* next company */ }
  }
  return made;
}
