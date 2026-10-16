// The AGA agreement keeps the words from the supplied contract. Marks are filled from the broker; the advisor's name waits until they sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGA_BODY, AGA_TITLE, fillAgreement, signDateParts } from '../src/aga-agreement.ts';

test('the supplied contract is the agreement, with marks where the paper had blanks', () => {
  assert.equal(AGA_TITLE, 'AGA Agreement');
  assert.match(AGA_BODY, /PUNJAB INSURANCE INC\./);
  assert.match(AGA_BODY, /\{\{aga_name\}\}/);
  assert.match(AGA_BODY, /\{\{cm_name\}\}/);
  assert.match(AGA_BODY, /\{\{cm_signed_name\}\}/);
  assert.match(AGA_BODY, /The agent signs first/);
  assert.match(AGA_BODY, /Schedule A/);
  assert.match(AGA_BODY, /production bones/);
});

test('known details replace their marks, and the advisor name stays until the signature', () => {
  const filled = fillAgreement(AGA_BODY, {
    aga_name: 'Aman Singh',
    province: 'ON',
    city: 'Toronto',
    corporation_name: 'N/A',
    officer_name: '____________________',
    effective_date: '16 October 2026',
    advisor_name: '{{advisor_name}}',
  });
  assert.match(filled, /Aman Singh/);
  assert.match(filled, /Toronto/);
  assert.doesNotMatch(filled, /\{\{aga_name\}\}/);
  assert.match(filled, /\{\{advisor_name\}\}/);
  const signed = fillAgreement(filled, { ...signDateParts(new Date('2026-10-16T18:00:00Z')), advisor_name: 'Aman Singh' });
  assert.match(signed, /AGENT\nName: Aman Singh/);
  assert.match(signed, /\{\{cm_signed_name\}\}/);
  assert.doesNotMatch(signed, /\{\{advisor_name\}\}/);
  assert.match(signed, /AUTHORIZED OFFICER\nPUNJAB INSURANCE INC\./);
});
