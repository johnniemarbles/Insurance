import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineWorkspaceDashboards,
  filterWorkQueueByFocus,
  filterCardsByFocus,
  type UnifiedDashboardResponse,
  type DashboardCard,
  type WorkQueueItem,
} from '../../web/src/workspace-aggregation.ts';

const SAMPLE_EXEC_RESPONSE: UnifiedDashboardResponse = {
  version: 1,
  tenantId: 'tenant-100',
  country: 'CA',
  perspective: 'executive',
  roles: ['tenant_admin', 'executive'],
  activeNodeIds: ['node-1'],
  isTenantAdmin: true,
  isHeadOffice: true,
  summary: {
    activeCarrierContracts: 12,
    pendingApprovals: 4,
    complianceAlerts: 1,
    carrierReceipts: 88,
    quarantinedReceipts: 0,
  },
  cards: [
    {
      id: 'card-crm',
      module: 'crm',
      title: 'CRM & Pipeline',
      status: 'ready',
      metrics: [{ id: 'm1', label: 'Active Leads', value: 45 }],
      drilldown: { page: 'crm', label: 'View CRM' },
      allowedActions: ['view'],
    },
    {
      id: 'card-commercial',
      module: 'commercial',
      title: 'Commercial Operations',
      status: 'ready',
      metrics: [{ id: 'm2', label: 'Reconciled Statements', value: 15 }],
      drilldown: { page: 'commercial', label: 'View Commercial' },
      allowedActions: ['view', 'reconcile'],
    },
    {
      id: 'card-carriers-exec',
      module: 'carriers',
      title: 'Carrier Integrations (Exec)',
      status: 'ready',
      metrics: [{ id: 'm3', label: 'Active Feeds', value: 8 }],
      drilldown: { page: 'carriers', label: 'Manage Feeds' },
      allowedActions: ['view'],
    },
  ],
  workQueue: [
    {
      id: 'stmt-001',
      category: 'statement_reconciliation',
      title: 'Sun Life July Statement Ready for Review',
      role: 'executive',
      priority: 'high',
      target: { page: 'commercial', routeId: 'stmt-001' },
      actionLabel: 'Review Statement',
    },
    {
      id: 'dup-001',
      category: 'task',
      title: 'Monthly Review Task',
      role: 'executive',
      priority: 'normal',
      target: { page: 'crm' },
    },
  ],
};

const SAMPLE_COMPLIANCE_RESPONSE: UnifiedDashboardResponse = {
  version: 1,
  tenantId: 'tenant-100',
  country: 'CA',
  perspective: 'compliance',
  roles: ['compliance_officer'],
  activeNodeIds: ['node-1'],
  isTenantAdmin: false,
  isHeadOffice: false,
  summary: undefined,
  cards: [
    {
      id: 'card-compliance',
      module: 'compliance',
      title: 'Compliance Surveillance',
      status: 'ready',
      metrics: [{ id: 'm4', label: 'Open Alerts', value: 2 }],
      drilldown: { page: 'compliance', label: 'Review Alerts' },
      allowedActions: ['view', 'resolve'],
    },
    {
      id: 'card-carriers-comp',
      module: 'carriers',
      title: 'Carrier Webhook Verification (Compliance)',
      status: 'ready',
      metrics: [{ id: 'm5', label: 'Active Feeds', value: 8 }],
      drilldown: { page: 'carriers', label: 'Audit Feeds' },
      allowedActions: ['audit'],
    },
    {
      id: 'card-audit',
      module: 'audit',
      title: 'Audit Logging & Exceptions',
      status: 'ready',
      metrics: [{ id: 'm6', label: 'Unresolved Exceptions', value: 0 }],
      drilldown: { page: 'audit', label: 'View Logs' },
      allowedActions: ['view'],
    },
  ],
  workQueue: [
    {
      id: 'alert-88',
      category: 'compliance_alert',
      title: 'CE Expiry Warning: Broker 441',
      role: 'compliance_officer',
      priority: 'high',
      target: { page: 'compliance', routeId: 'alert-88' },
      actionLabel: 'Resolve Alert',
    },
    {
      id: 'dup-001',
      category: 'task',
      title: 'Monthly Review Task (Compliance Duplicate)',
      role: 'compliance_officer',
      priority: 'normal',
      target: { page: 'crm' },
    },
  ],
};

test('combineWorkspaceDashboards - rejects empty responses', () => {
  assert.throws(
    () => combineWorkspaceDashboards([]),
    /No authorized dashboard responses/
  );
});

test('combineWorkspaceDashboards - enforces tenant boundary isolation', () => {
  const mismatchedTenantResponse: UnifiedDashboardResponse = {
    ...SAMPLE_COMPLIANCE_RESPONSE,
    tenantId: 'different-tenant-999',
  };
  assert.throws(
    () => combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE, mismatchedTenantResponse]),
    /Workspace context mismatch/
  );
});

test('combineWorkspaceDashboards - enforces country jurisdiction isolation', () => {
  const mismatchedCountryResponse: UnifiedDashboardResponse = {
    ...SAMPLE_COMPLIANCE_RESPONSE,
    country: 'US',
  };
  assert.throws(
    () => combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE, mismatchedCountryResponse]),
    /Workspace context mismatch/
  );
});

test('combineWorkspaceDashboards - single perspective retains full response shape', () => {
  const combined = combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE]);
  assert.equal(combined.perspective, 'command');
  assert.equal(combined.tenantId, 'tenant-100');
  assert.equal(combined.country, 'CA');
  assert.equal(combined.cards.length, 3);
  assert.equal(combined.workQueue?.length, 2);
  assert.deepEqual(combined.summary, SAMPLE_EXEC_RESPONSE.summary);
});

test('combineWorkspaceDashboards - deduplicates cards by module preserving primary response', () => {
  const combined = combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE, SAMPLE_COMPLIANCE_RESPONSE]);
  
  // Both responses have a 'carriers' module card.
  const carrierCards = combined.cards.filter(c => c.module === 'carriers');
  assert.equal(carrierCards.length, 1, 'Only one card per module should be retained');
  assert.equal(carrierCards[0]?.id, 'card-carriers-exec', 'First (primary) perspective card is authoritative');

  // Verify all unique modules are present
  const modules = combined.cards.map(c => c.module);
  assert.deepEqual(modules, ['crm', 'commercial', 'carriers', 'compliance', 'audit']);
});

test('combineWorkspaceDashboards - deduplicates work queue items by category and id', () => {
  const combined = combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE, SAMPLE_COMPLIANCE_RESPONSE]);
  
  // Both responses have task:dup-001
  const duplicateTasks = combined.workQueue?.filter(i => i.category === 'task' && i.id === 'dup-001');
  assert.equal(duplicateTasks?.length, 1, 'Duplicate task:dup-001 must be deduplicated');
  assert.equal(duplicateTasks?.[0]?.title, 'Monthly Review Task', 'Primary perspective work item title preserved');

  // Total work queue items: stmt-001, dup-001, alert-88 = 3
  assert.equal(combined.workQueue?.length, 3);
});

test('combineWorkspaceDashboards - authoritative summary preserved without summing numbers', () => {
  const combined = combineWorkspaceDashboards([SAMPLE_EXEC_RESPONSE, SAMPLE_COMPLIANCE_RESPONSE]);
  assert.equal(combined.summary?.activeCarrierContracts, 12);
  assert.equal(combined.summary?.pendingApprovals, 4);
  assert.equal(combined.summary?.complianceAlerts, 1);
});

test('filterWorkQueueByFocus - handles empty/undefined safely', () => {
  assert.deepEqual(filterWorkQueueByFocus(undefined, 'all'), []);
  assert.deepEqual(filterWorkQueueByFocus([], 'executive'), []);
});

test('filterWorkQueueByFocus - filters by focus correctly', () => {
  const items: WorkQueueItem[] = [
    { id: '1', category: 'compliance_alert', title: 'Alert', role: 'c', priority: 'high', target: { page: 'c' } },
    { id: '2', category: 'webhook_review', title: 'Webhook', role: 'c', priority: 'high', target: { page: 'c' } },
    { id: '3', category: 'statement_reconciliation', title: 'Reconciliation', role: 'e', priority: 'high', target: { page: 'e' } },
    { id: '4', category: 'contract_approval', title: 'Contract', role: 'e', priority: 'high', target: { page: 'e' } },
  ];

  const allItems = filterWorkQueueByFocus(items, 'all');
  assert.equal(allItems.length, 4);

  const complianceItems = filterWorkQueueByFocus(items, 'compliance');
  assert.equal(complianceItems.length, 2);
  assert.deepEqual(complianceItems.map(i => i.category), ['compliance_alert', 'webhook_review']);

  const execItems = filterWorkQueueByFocus(items, 'executive');
  assert.equal(execItems.length, 2);
  assert.deepEqual(execItems.map(i => i.category), ['statement_reconciliation', 'contract_approval']);
});

test('filterCardsByFocus - filters cards by executive vs compliance', () => {
  const cards: DashboardCard[] = [
    { id: 'c1', module: 'crm', title: 'CRM', status: 'ready', metrics: [], drilldown: { page: 'crm', label: 'View' }, allowedActions: [] },
    { id: 'c2', module: 'compliance', title: 'Compliance', status: 'ready', metrics: [], drilldown: { page: 'comp', label: 'View' }, allowedActions: [] },
    { id: 'c3', module: 'audit', title: 'Audit', status: 'ready', metrics: [], drilldown: { page: 'audit', label: 'View' }, allowedActions: [] },
    { id: 'c4', module: 'commercial', title: 'Commercial', status: 'ready', metrics: [], drilldown: { page: 'comm', label: 'View' }, allowedActions: [] },
    { id: 'c5', module: 'carriers', title: 'Carriers', status: 'ready', metrics: [], drilldown: { page: 'carriers', label: 'View' }, allowedActions: [] },
  ];

  const allCards = filterCardsByFocus(cards, 'all');
  assert.equal(allCards.length, 5);

  const complianceCards = filterCardsByFocus(cards, 'compliance');
  assert.deepEqual(complianceCards.map(c => c.module), ['compliance', 'audit', 'carriers']);

  const execCards = filterCardsByFocus(cards, 'executive');
  assert.deepEqual(execCards.map(c => c.module), ['crm', 'commercial', 'carriers']);
});
