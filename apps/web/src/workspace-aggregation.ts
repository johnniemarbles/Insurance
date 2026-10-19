export type Module = 'crm' | 'compliance' | 'training' | 'learning' | 'audit' | 'onboarding' | 'carriers' | 'commercial' | 'notifications';

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
  module: Module;
  title: string;
  description?: string;
  status: 'ready' | 'empty' | 'forbidden' | 'unavailable';
  metrics: DashboardMetric[];
  items?: DashboardItem[];
  drilldown: {
    page: string;
    routeId?: string;
    label: string;
  };
  allowedActions: string[];
}

export interface ExecutiveSummary {
  activeCarrierContracts: number;
  pendingApprovals: number;
  complianceAlerts: number;
  carrierReceipts: number;
  quarantinedReceipts: number;
}

export interface WorkQueueItem {
  id: string;
  category: 'webhook_review' | 'contract_approval' | 'audit_exception' | 'compliance_alert' | 'onboarding_review' | 'task' | 'coursework' | 'statement_reconciliation';
  title: string;
  subtitle?: string;
  role: string;
  priority: 'high' | 'medium' | 'normal';
  date?: string;
  target: { page: string; routeId?: string };
  actionLabel?: string;
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
  summary?: ExecutiveSummary;
  workQueue?: WorkQueueItem[];
  cards: DashboardCard[];
}

export type DashboardFocus = 'all' | 'executive' | 'compliance';

export const COMPLIANCE_QUEUE_CATEGORIES = [
  'compliance_alert',
  'webhook_review',
  'audit_exception',
  'onboarding_review',
] as const;

export const COMPLIANCE_MODULE_CARDS = [
  'compliance',
  'carriers',
  'audit',
  'onboarding',
] as const;

export const EXECUTIVE_EXCLUDED_MODULE_CARDS = [
  'compliance',
  'audit',
  'learning',
  'training',
] as const;

/** Combine server-authorized perspectives without manufacturing any new permissions. */
export function combineWorkspaceDashboards(responses: UnifiedDashboardResponse[]): UnifiedDashboardResponse {
  const primary = responses[0];
  if (!primary) throw new Error('No authorized dashboard responses');
  if (responses.some(r => r.tenantId !== primary.tenantId || r.country !== primary.country)) {
    throw new Error('Workspace context mismatch');
  }
  const cards = new Map<string, DashboardCard>();
  const queue = new Map<string, WorkQueueItem>();
  for (const response of responses) {
    for (const card of response.cards) {
      // Module is the stable dashboard identity; first response is authoritative.
      if (!cards.has(card.module)) cards.set(card.module, card);
    }
    for (const item of response.workQueue ?? []) {
      const identity = item.category + ':' + item.id;
      if (!queue.has(identity)) queue.set(identity, item);
    }
  }
  return {
    ...primary,
    perspective: 'command',
    cards: [...cards.values()],
    workQueue: [...queue.values()],
    // Summary metrics come from one authoritative server response, never summed.
    summary: responses.find(r => r.summary)?.summary,
  };
}

/** Filters and deduplicates work queue items based on the active command center focus. */
export function filterWorkQueueByFocus(
  workQueue: WorkQueueItem[] | undefined,
  focus: DashboardFocus
): WorkQueueItem[] {
  if (!workQueue || workQueue.length === 0) return [];

  return workQueue
    .filter(item => {
      if (focus === 'all') return true;
      if (focus === 'compliance') {
        return (COMPLIANCE_QUEUE_CATEGORIES as readonly string[]).includes(item.category);
      }
      // executive focus excludes compliance alerts, webhook reviews, and audit exceptions
      return !['compliance_alert', 'webhook_review', 'audit_exception'].includes(item.category);
    })
    .filter((item, index, all) => all.findIndex(other => other.category === item.category && other.id === item.id) === index);
}

/** Filters and deduplicates dashboard cards based on the active command center focus. */
export function filterCardsByFocus(
  cards: DashboardCard[],
  focus: DashboardFocus
): DashboardCard[] {
  if (!cards || cards.length === 0) return [];

  return cards
    .filter(card => {
      if (focus === 'all') return true;
      if (focus === 'compliance') {
        return (COMPLIANCE_MODULE_CARDS as readonly string[]).includes(card.module);
      }
      // executive focus excludes internal compliance, audit, and training modules
      return !(EXECUTIVE_EXCLUDED_MODULE_CARDS as readonly string[]).includes(card.module);
    })
    .filter((card, index, all) => all.findIndex(other => other.module === card.module) === index);
}
