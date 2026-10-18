import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { forbidden } from './errors.ts';
import type { AppDeps } from './app.ts';

export type DashboardModule =
  | 'crm'
  | 'compliance'
  | 'onboarding'
  | 'carriers'
  | 'training'
  | 'learning'
  | 'audit'
  | 'notifications';

export type CardStatus = 'ready' | 'empty' | 'forbidden' | 'unavailable';

export interface DashboardMetric {
  id: string;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface DashboardItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  date?: string;
  target?: { page: string; routeId?: string };
}

export interface DashboardCard {
  id: string;
  module: DashboardModule;
  title: string;
  description?: string;
  status: CardStatus;
  metrics: DashboardMetric[];
  items?: DashboardItem[];
  drilldown: {
    page: string;
    routeId?: string;
    label: string;
  };
  allowedActions: string[];
}

export interface UnifiedDashboardResponse {
  version: number;
  tenantId: string;
  country: 'CA' | 'US';
  perspective: string;
  roles: string[];
  activeNodeIds: string[];
  isTenantAdmin: boolean;
  isHeadOffice: boolean;
  cards: DashboardCard[];
}

const PERSPECTIVE_ALIASES: Record<string, string> = {
  executive: 'admin',
  broker: 'partner',
  training: 'trainer',
  audit: 'auditor',
  operations: 'staff',
  learning: 'learner',
  head_office: 'ho',
  headoffice: 'ho',
};

const ROLE_PRIORITIES = ['admin', 'compliance', 'manager', 'partner', 'trainer', 'auditor', 'staff', 'learner'];

const PERSPECTIVE_MODULES: Record<string, DashboardModule[]> = {
  admin: ['crm', 'compliance', 'onboarding', 'carriers', 'training', 'learning', 'audit', 'notifications'],
  ho: ['crm', 'compliance', 'onboarding', 'carriers', 'training', 'audit', 'notifications'],
  compliance: ['compliance', 'onboarding', 'carriers', 'audit', 'notifications'],
  manager: ['crm', 'onboarding', 'training', 'learning', 'notifications'],
  partner: ['crm', 'onboarding', 'carriers', 'learning', 'notifications'],
  auditor: ['audit', 'notifications'],
  trainer: ['training', 'learning', 'notifications'],
  learner: ['learning', 'notifications'],
  staff: ['crm', 'learning', 'notifications'],
};

/** Server-resolved workspace discovery and unified role dashboard cards. */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/workspace/context', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const roles = [...new Set(ctx.roles.map(r => r.role))];
    const isTenantAdmin = Boolean(ctx.isTenantAdmin);
    const admin = isTenantAdmin || roles.includes('admin');
    const compliance = isTenantAdmin || roles.includes('compliance');
    const training = admin || roles.includes('trainer') || roles.includes('manager');

    // Node names and audit engagement links are resolved strictly through RLS.
    const { scopes, hasAuditEngagement } = await withRequestTx(deps.appPool, ctx, async tx => {
      const s = (await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM org_nodes WHERE id = ANY($1::uuid[]) ORDER BY name',
        [ctx.nodeIds],
      )).rows;
      const a = (await tx.query(
        'SELECT 1 FROM audit_engagements WHERE auditor_user_id = app_user_id() LIMIT 1'
      )).rowCount! > 0;
      return { scopes: s, hasAuditEngagement: a };
    });

    const isAuditor = roles.includes('auditor') || hasAuditEngagement;
    const audit = admin || compliance || isAuditor;
    const crm = Boolean(ctx.canUseCrm) && (admin || roles.some(r => ['partner', 'manager', 'staff'].includes(r)));

    const modules = {
      crm, compliance, training, learning: true, audit,
      onboarding: compliance || crm,
      carriers: compliance,
      notifications: true,
    };

    // A user with no roles who is not linked to an engagement does NOT get the auditor role.
    const resolvedRoles = isTenantAdmin
      ? (roles.includes('admin') ? roles : ['admin', ...roles])
      : (roles.length ? roles : (isAuditor ? ['auditor'] : []));

    return {
      version: 1,
      tenantId: ctx.tenantId,
      country: deps.config.region === 'us' ? 'US' : 'CA',
      roles: resolvedRoles,
      activeNodeIds: ctx.nodeIds,
      isTenantAdmin,
      modules,
      scopes,
      // The dashboard never accepts arbitrary node IDs as an authority.
      scopeMode: 'server-authorized',
    };
  });

  app.get('/v1/workspace/dashboard', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const q = (req.query ?? {}) as { perspective?: string; days?: string | number };
    const rawPerspective = typeof q.perspective === 'string' ? q.perspective.trim().toLowerCase() : '';
    const requestedPerspective = PERSPECTIVE_ALIASES[rawPerspective] ?? rawPerspective;
    const days = Math.max(7, Math.min(365, Number(q.days) || 30));

    const roles = [...new Set(ctx.roles.map(r => r.role))];
    const isTenantAdmin = Boolean(ctx.isTenantAdmin);
    const admin = isTenantAdmin || roles.includes('admin');
    const compliance = isTenantAdmin || roles.includes('compliance');
    const crmAllowed = Boolean(ctx.canUseCrm) && (admin || roles.some(r => ['partner', 'manager', 'staff'].includes(r)));

    return await withRequestTx(deps.appPool, ctx, async (tx) => {
      const isHeadOffice = (await tx.query<{ h: boolean }>('SELECT app_is_head_office() AS h')).rows[0]?.h ?? false;
      const hasAuditEngagement = (await tx.query(
        'SELECT 1 FROM audit_engagements WHERE auditor_user_id = app_user_id() LIMIT 1'
      )).rowCount! > 0;
      const isAuditor = roles.includes('auditor') || hasAuditEngagement;

      // Determine all authorized perspectives
      const authorizedPerspectives = new Set<string>();
      if (admin) authorizedPerspectives.add('admin');
      if (isHeadOffice || admin) authorizedPerspectives.add('ho');
      if (compliance) authorizedPerspectives.add('compliance');
      if (roles.includes('manager') || admin) authorizedPerspectives.add('manager');
      if (roles.includes('partner') || admin) authorizedPerspectives.add('partner');
      if (roles.includes('trainer') || admin) authorizedPerspectives.add('trainer');
      if (isAuditor || admin || compliance) authorizedPerspectives.add('auditor');
      if (roles.includes('staff') || admin || roles.includes('manager')) authorizedPerspectives.add('staff');
      authorizedPerspectives.add('learner'); // every authenticated user can see personal learning

      let activePerspective = requestedPerspective;
      if (activePerspective) {
        if (!authorizedPerspectives.has(activePerspective)) {
          throw forbidden(`Not authorized for requested perspective: ${rawPerspective}`);
        }
      } else {
        activePerspective = ROLE_PRIORITIES.find(r => authorizedPerspectives.has(r)) ?? 'learner';
      }

      const activeModules = PERSPECTIVE_MODULES[activePerspective] ?? ['learning', 'notifications'];
      const cards: DashboardCard[] = [];

      for (const mod of activeModules) {
        if (mod === 'crm') {
          if (!crmAllowed) continue;
          const k = (
            await tx.query<{
              openCount: number;
              openValue: number;
              won: number;
              wonValue: number;
              lost: number;
            }>(
              `SELECT count(*) FILTER (WHERE NOT s.is_won AND NOT s.is_lost)::int AS "openCount",
                      coalesce(sum(b.value_amount) FILTER (WHERE NOT s.is_won AND NOT s.is_lost), 0)::float8 AS "openValue",
                      count(*) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1))::int AS won,
                      coalesce(sum(b.value_amount) FILTER (WHERE s.is_won AND b.stage_entered_at >= now() - make_interval(days => $1)), 0)::float8 AS "wonValue",
                      count(*) FILTER (WHERE s.is_lost AND b.stage_entered_at >= now() - make_interval(days => $1))::int AS lost
                 FROM boxes b JOIN stages s ON s.id = b.stage_id`,
              [days],
            )
          ).rows[0] ?? { openCount: 0, openValue: 0, won: 0, wonValue: 0, lost: 0 };

          const dueTasks = (
            await tx.query<{ count: number }>(
              `SELECT count(*)::int AS count
                 FROM tasks t JOIN boxes b ON b.id = t.box_id
                WHERE t.done_at IS NULL AND t.due_at <= now()`,
            )
          ).rows[0]?.count ?? 0;

          const recentBoxes = (
            await tx.query<{ id: string; name: string; pipeline_id: string; stage_name: string }>(
              `SELECT b.id, b.name, b.pipeline_id, s.name AS stage_name
                 FROM boxes b JOIN stages s ON s.id = b.stage_id
                WHERE NOT s.is_won AND NOT s.is_lost
                ORDER BY b.updated_at DESC LIMIT 5`,
            )
          ).rows;

          const winRate = k.won + k.lost > 0 ? Math.round((k.won / (k.won + k.lost)) * 100) : null;

          cards.push({
            id: 'card-crm',
            module: 'crm',
            title: 'Pipeline performance',
            description: `Performance metrics for the last ${days} days across authorized records.`,
            status: k.openCount === 0 && k.won === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'open', label: 'Open records', value: k.openCount, sub: k.openValue > 0 ? `$${Math.round(k.openValue).toLocaleString()}` : undefined, tone: 'neutral' },
              { id: 'won', label: `Won (${days}d)`, value: k.won, sub: k.wonValue > 0 ? `$${Math.round(k.wonValue).toLocaleString()}` : undefined, tone: 'good' },
              { id: 'winRate', label: 'Win rate', value: winRate != null ? `${winRate}%` : '—', tone: 'neutral' },
              { id: 'due', label: 'Due tasks', value: dueTasks, tone: dueTasks > 0 ? 'warn' : 'neutral' },
            ],
            items: recentBoxes.map(b => ({
              id: b.id,
              title: b.name,
              subtitle: b.stage_name,
              target: { page: 'pipelines', routeId: `${b.pipeline_id}::open=${b.id}` },
            })),
            drilldown: { page: 'pipelines', label: 'Open pipelines' },
            allowedActions: ['view_pipeline', 'create_record'],
          });
        } else if (mod === 'compliance') {
          const expiries = (
            await tx.query<{ id: string; label: string; expiresOn: string; partnerName: string; status: string }>(
              `SELECT i.id, i.label, i.expires_on::text AS "expiresOn", n.name AS "partnerName",
                      CASE WHEN i.expires_on < current_date THEN 'expired' ELSE 'expiring' END AS status
                 FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id
                WHERE i.expires_on IS NOT NULL AND i.expires_on <= current_date + interval '30 days'
                ORDER BY i.expires_on LIMIT 10`,
            )
          ).rows;

          const overdueReports = (
            await tx.query<{ n: number }>(
              `SELECT count(*)::int AS n
                 FROM broker_self_reports
                WHERE acknowledged_at IS NULL AND due_on < current_date`,
            )
          ).rows[0]?.n ?? 0;

          const frozenNodes = (
            await tx.query<{ n: number }>(
              `SELECT count(DISTINCT node_id)::int AS n
                 FROM compliance_items
                WHERE expires_on < current_date`,
            )
          ).rows[0]?.n ?? 0;

          const expiredCount = expiries.filter(e => e.status === 'expired').length;
          const expiringSoon = expiries.filter(e => e.status === 'expiring').length;

          cards.push({
            id: 'card-compliance',
            module: 'compliance',
            title: 'Compliance alerts',
            description: 'Credential expiries, self-reports, and operational compliance holds.',
            status: expiries.length === 0 && overdueReports === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'expired', label: 'Expired items', value: expiredCount, tone: expiredCount > 0 ? 'bad' : 'good' },
              { id: 'expiring', label: 'Expiring in 30d', value: expiringSoon, tone: expiringSoon > 0 ? 'warn' : 'good' },
              { id: 'overdueReports', label: 'Overdue reports', value: overdueReports, tone: overdueReports > 0 ? 'warn' : 'good' },
              { id: 'frozen', label: 'Frozen nodes', value: frozenNodes, tone: frozenNodes > 0 ? 'bad' : 'good' },
            ],
            items: expiries.slice(0, 5).map(e => ({
              id: e.id,
              title: `${e.partnerName} · ${e.label}`,
              subtitle: e.status === 'expired' ? `Expired on ${e.expiresOn}` : `Expires ${e.expiresOn}`,
              status: e.status,
              date: e.expiresOn,
            })),
            drilldown: { page: 'compliance', label: 'Open compliance command center' },
            allowedActions: ['review_compliance', 'manage_holds'],
          });
        } else if (mod === 'carriers') {
          const cases = (
            await tx.query<{
              id: string;
              carrierName: string;
              jurisdiction: string;
              state: string;
              effectiveState: string;
            }>(
              `SELECT cc.id, cc.carrier_name AS "carrierName", cc.jurisdiction, cc.state,
                      CASE WHEN cc.state IN ('active','appointment_verified')
                                 AND (cc.appointment_expires_on IS NULL OR cc.appointment_expires_on < CURRENT_DATE) THEN 'expired'
                           ELSE cc.state END AS "effectiveState"
                 FROM carrier_contract_cases cc
                WHERE app_is_compliance_at_or_above(cc.tenant_id, cc.node_id)
                   OR EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = cc.node_id AND user_id = app_user_id())
                ORDER BY cc.updated_at DESC LIMIT 50`,
            )
          ).rows;

          const inReview = cases.filter(c => ['submitted', 'carrier_review'].includes(c.state)).length;
          const verified = cases.filter(c => c.state === 'appointment_verified').length;
          const active = cases.filter(c => c.state === 'active').length;
          const expired = cases.filter(c => c.effectiveState === 'expired').length;

          cards.push({
            id: 'card-carriers',
            module: 'carriers',
            title: 'Carrier contracting cases',
            description: 'Direct insurer contracting workflows, submissions, and appointments.',
            status: cases.length === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'total', label: 'Contract cases', value: cases.length },
              { id: 'inReview', label: 'In carrier review', value: inReview, tone: 'neutral' },
              { id: 'verified', label: 'Verified appointments', value: verified, tone: 'good' },
              { id: 'active', label: 'Active authorized', value: active, tone: 'good' },
              { id: 'expired', label: 'Expired', value: expired, tone: expired > 0 ? 'warn' : 'neutral' },
            ],
            items: cases.slice(0, 5).map(c => ({
              id: c.id,
              title: `${c.carrierName} (${c.jurisdiction})`,
              subtitle: `State: ${c.effectiveState}`,
              status: c.effectiveState,
            })),
            drilldown: { page: 'compliance', routeId: 'carriers', label: 'Open carrier contracting' },
            allowedActions: ['view_cases', 'prepare_packet'],
          });
        } else if (mod === 'onboarding') {
          const cases = (
            await tx.query<{ id: string; stage: string; standing: string; partnerName: string }>(
              `SELECT oc.id, oc.stage, oc.standing, n.name AS "partnerName"
                 FROM onboarding_cases oc JOIN org_nodes n ON n.id = oc.node_id
                ORDER BY oc.updated_at DESC LIMIT 50`,
            )
          ).rows;

          const goodStanding = cases.filter(c => c.stage === 'active' && c.standing === 'good_standing').length;
          const inOnboarding = cases.filter(c => c.stage !== 'active').length;
          const reviewRequired = cases.filter(c => c.standing === 'review_required').length;

          cards.push({
            id: 'card-onboarding',
            module: 'onboarding',
            title: 'Partner onboarding',
            description: 'Broker registration, agreements, background screening, and standing.',
            status: cases.length === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'goodStanding', label: 'Good standing', value: goodStanding, tone: 'good' },
              { id: 'inOnboarding', label: 'In onboarding', value: inOnboarding, tone: 'neutral' },
              { id: 'reviewRequired', label: 'Needs review', value: reviewRequired, tone: reviewRequired > 0 ? 'warn' : 'good' },
            ],
            items: cases.slice(0, 5).map(c => ({
              id: c.id,
              title: c.partnerName,
              subtitle: `Stage: ${c.stage} · Standing: ${c.standing}`,
              status: c.standing,
            })),
            drilldown: { page: 'partners', label: 'Partner directory' },
            allowedActions: ['view_directory', 'invite_partner'],
          });
        } else if (mod === 'training') {
          const totals = (
            await tx.query<{ assigned: number; inProgress: number; completed: number; overdue: number }>(
              `SELECT count(*)::int AS assigned,
                      count(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
                      count(*) FILTER (WHERE status = 'completed')::int AS completed,
                      count(*) FILTER (WHERE status <> 'completed' AND due_at < now())::int AS overdue
                 FROM enrollments`,
            )
          ).rows[0] ?? { assigned: 0, inProgress: 0, completed: 0, overdue: 0 };

          cards.push({
            id: 'card-training',
            module: 'training',
            title: 'Training and CE',
            description: 'Course assignments, continuing education, and branch completion rates.',
            status: totals.assigned === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'assigned', label: 'Assigned', value: totals.assigned },
              { id: 'completed', label: 'Completed', value: totals.completed, tone: 'good' },
              { id: 'inProgress', label: 'In progress', value: totals.inProgress, tone: 'neutral' },
              { id: 'overdue', label: 'Overdue', value: totals.overdue, tone: totals.overdue > 0 ? 'bad' : 'good' },
            ],
            drilldown: { page: 'training', label: 'Training dashboard' },
            allowedActions: ['assign_course', 'view_reports'],
          });
        } else if (mod === 'learning') {
          const enrollments = (
            await tx.query<{ id: string; title: string; status: string; dueAt: string | null }>(
              `SELECT e.id, coalesce(l.title, 'Untitled course') AS title, e.status, e.due_at::text AS "dueAt"
                 FROM enrollments e
            LEFT JOIN course_locales l ON l.course_id = e.course_id AND l.locale = 'en'
                WHERE e.user_id = app_user_id()
                ORDER BY e.due_at NULLS LAST LIMIT 10`,
            )
          ).rows;

          const toWork = enrollments.filter(e => e.status !== 'completed').length;
          const completed = enrollments.filter(e => e.status === 'completed').length;

          cards.push({
            id: 'card-learning',
            module: 'learning',
            title: 'My coursework',
            description: 'Personal continuing education and regulatory training progress.',
            status: enrollments.length === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'enrolled', label: 'Enrolled courses', value: enrollments.length },
              { id: 'todo', label: 'To do', value: toWork, tone: toWork > 0 ? 'warn' : 'good' },
              { id: 'completed', label: 'Completed', value: completed, tone: 'good' },
            ],
            items: enrollments.slice(0, 5).map(e => ({
              id: e.id,
              title: e.title,
              subtitle: e.dueAt ? `Due by ${e.dueAt.slice(0, 10)}` : 'No fixed deadline',
              status: e.status,
            })),
            drilldown: { page: 'training', label: 'My learning' },
            allowedActions: ['launch_course'],
          });
        } else if (mod === 'audit') {
          const engagements = (
            await tx.query<{ id: string; title: string; status: string; startsOn: string; endsOn: string }>(
              `SELECT a.id, a.title,
                      CASE WHEN a.ended_at IS NOT NULL THEN 'closed'
                           WHEN a.ends_on < CURRENT_DATE THEN 'expired'
                           WHEN a.starts_on <= CURRENT_DATE THEN 'active'
                           ELSE 'pending' END AS status,
                      a.starts_on::text AS "startsOn", a.ends_on::text AS "endsOn"
                 FROM audit_engagements a
                WHERE app_is_tenant_admin()
                   OR EXISTS (SELECT 1 FROM user_node_roles WHERE user_id = app_user_id() AND role = 'compliance')
                   OR a.auditor_user_id = app_user_id()
                ORDER BY a.starts_on DESC, a.created_at DESC LIMIT 10`,
            )
          ).rows;

          cards.push({
            id: 'card-audit',
            module: 'audit',
            title: 'Audit engagements',
            description: 'Statutory compliance reviews and authorized sampling engagements.',
            status: engagements.length === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'active', label: 'Active engagements', value: engagements.filter(a => a.status === 'active').length, tone: 'good' },
              { id: 'total', label: 'Total visible', value: engagements.length },
            ],
            items: engagements.slice(0, 5).map(e => ({
              id: e.id,
              title: e.title,
              subtitle: `Status: ${e.status} (${e.startsOn} to ${e.endsOn})`,
              status: e.status,
            })),
            drilldown: { page: 'home', label: 'View engagements' },
            allowedActions: ['view_sampling'],
          });
        } else if (mod === 'notifications') {
          const notifications = (
            await tx.query<{ id: string; kind: string; data: Record<string, unknown>; createdAt: string; readAt: string | null }>(
              `SELECT id, kind, data, created_at::text AS "createdAt", read_at AS "readAt"
                 FROM notifications
                WHERE user_id = app_user_id()
                ORDER BY created_at DESC LIMIT 10`,
            )
          ).rows;

          const unread = notifications.filter(n => !n.readAt).length;

          cards.push({
            id: 'card-notifications',
            module: 'notifications',
            title: 'Notifications',
            description: 'Operational alerts, workflow tasks, and compliance communications.',
            status: notifications.length === 0 ? 'empty' : 'ready',
            metrics: [
              { id: 'unread', label: 'Unread', value: unread, tone: unread > 0 ? 'warn' : 'neutral' },
              { id: 'recent', label: 'Recent', value: notifications.length },
            ],
            items: notifications.slice(0, 5).map(n => ({
              id: n.id,
              title: typeof n.data?.title === 'string' && n.data.title ? n.data.title : n.kind.replace(/_/g, ' '),
              subtitle: new Date(n.createdAt).toLocaleDateString(),
              status: n.readAt ? 'read' : 'unread',
            })),
            drilldown: { page: 'notifications', label: 'Open notifications' },
            allowedActions: ['mark_all_read'],
          });
        }
      }

      const response: UnifiedDashboardResponse = {
        version: 1,
        tenantId: ctx.tenantId,
        country: deps.config.region === 'us' ? 'US' : 'CA',
        perspective: activePerspective,
        roles,
        activeNodeIds: ctx.nodeIds,
        isTenantAdmin,
        isHeadOffice,
        cards,
      };

      return response;
    });
  });
}
