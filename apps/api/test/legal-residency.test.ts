import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacy, type LegalInfo } from '../src/legal.ts';

const base: LegalInfo = {
  country: 'CA',
  entity: 'Punjab Insurance Agency Inc',
  product: 'PII',
  privacyEmail: 'privacy@example.com',
  supportEmail: 'support@example.com',
  stored: 'CA',
  updated: '11 October 2026',
};

test('privacy: CA storage says Canada and does not claim US servers', () => {
  const en = privacy({ ...base, stored: 'CA' }, 'en');
  const where = en.sections.find((s) => s.h === 'Where it is stored')!;
  assert.match(where.p[0]!, /in Canada/);
  assert.equal(where.p.some((p) => /servers are in the United States/.test(p)), false);

  const fr = privacy({ ...base, stored: 'CA' }, 'fr-CA');
  const ou = fr.sections.find((s) => s.h === 'Où ils sont conservés')!;
  assert.match(ou.p[0]!, /au Canada/);
  assert.equal(ou.p.some((p) => /serveurs sont situés aux États-Unis/.test(p)), false);
});

test('privacy: US storage mentions US servers and authority access for CA companies', () => {
  const en = privacy({ ...base, stored: 'US' }, 'en');
  const where = en.sections.find((s) => s.h === 'Where it is stored')!;
  assert.match(where.p[0]!, /United States/);
  assert.equal(where.p.some((p) => /servers are in the United States/.test(p)), true);

  const fr = privacy({ ...base, stored: 'US' }, 'fr-CA');
  const ou = fr.sections.find((s) => s.h === 'Où ils sont conservés')!;
  assert.match(ou.p[0]!, /États-Unis/);
  assert.equal(ou.p.some((p) => /serveurs sont situés aux États-Unis/.test(p)), true);
});
