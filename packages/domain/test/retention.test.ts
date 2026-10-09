import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifecycleState, retentionYears, retentionKindForDoc, consentStates } from '../src/index.ts';

test('retention years: defaults, lengthening allowed, never below the minimum', () => {
  assert.equal(retentionYears('advice', null), 15); assert.equal(retentionYears('advice', 20), 20);
  assert.equal(retentionYears('advice', 3), 7); assert.equal(retentionYears('aml', 2), 5); assert.equal(retentionYears('aml', 99), 30);
});
test('lifecycle: active until closed, retained until the period ends, then due; a hold wins', () => {
  const closed = new Date('2020-01-01T00:00:00Z');
  assert.equal(lifecycleState(null, 5, false).state, 'active');
  assert.equal(lifecycleState(closed, 5, false, new Date('2024-12-31T00:00:00Z')).state, 'retained');
  assert.equal(lifecycleState(closed, 5, false, new Date('2025-01-01T00:00:00Z')).state, 'due');
  assert.equal(lifecycleState(closed, 5, true, new Date('2030-01-01T00:00:00Z')).state, 'held');
});
test('documents follow the right clock', () => {
  assert.equal(retentionKindForDoc('id_record'), 'aml'); assert.equal(retentionKindForDoc('privacy_consent'), 'consent'); assert.equal(retentionKindForDoc(null), 'advice');
});
test('the latest consent row of a kind decides', () => {
  const s = consentStates([{ kind: 'electronic_comms', createdAt: 1000, withdrawnAt: '2026-01-01' }, { kind: 'collection_use', createdAt: 1000, withdrawnAt: null }, { kind: 'electronic_comms', createdAt: 2000, withdrawnAt: null }]);
  assert.deepEqual(s.active.sort(), ['collection_use', 'electronic_comms']); assert.deepEqual(s.withdrawn, []);
});

test('the US server names FinCEN for money records and leaves the other labels alone', async () => {
  const { retentionLabels, RETENTION_LABELS } = await import('../src/index.ts');
  assert.match(retentionLabels('US').aml.en, /FinCEN/);
  assert.match(retentionLabels('CA').aml.en, /FINTRAC/);
  assert.equal(retentionLabels('US').advice.en, RETENTION_LABELS.advice.en);
});
