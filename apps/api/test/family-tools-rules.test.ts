// Families, Gate D: CSV reading, import row checks, the extension version gate and surname matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRow, mapHeader, parseCsv, surnameOf, versionAtLeast } from '../src/family-tools-rules.ts';

test('CSV: quotes, commas and line breaks inside values, CRLF, BOM, blank lines', () => {
  const rows = parseCsv('﻿family,full_name,note\r\n"Singh, Raj family","Raj ""RJ"" Singh","two\nlines"\r\n\r\nKaur,Navjot,\n');
  assert.deepEqual(rows, [['family', 'full_name', 'note'], ['Singh, Raj family', 'Raj "RJ" Singh', 'two\nlines'], ['Kaur', 'Navjot', '']]);
  assert.throws(() => parseCsv('a,"b\n'), /not closed/);
});

test('headers: aliases are understood, unknown columns are reported, required ones checked', () => {
  const h = mapHeader(['Household', 'Name', 'E-mail', 'DOB', 'Role', 'Favourite colour']);
  assert.deepEqual(h.columns, ['family', 'full_name', 'email', 'date_of_birth', 'role', null]);
  assert.deepEqual(h.unknown, ['Favourite colour']);
  assert.deepEqual(h.missing, []);
  assert.deepEqual(mapHeader(['name']).missing, ['role', 'family or family_id']);
});

test('row checks: role words, dates, emails, ids, and who the person is', () => {
  const today = '2026-10-20';
  assert.deepEqual(checkRow({ line: 2, family: 'Singh', role: 'Spouse', full_name: 'Simran Singh' }, today), { errors: [], role: 'spouse_partner' });
  assert.equal(checkRow({ line: 2, family: 'Singh', role: 'dependant', full_name: 'A' }, today).role, 'dependent');
  const bad = checkRow({ line: 3, role: 'cousin', email: 'nope', date_of_birth: '2026-02-30', family_id: 'x' }, today).errors;
  assert.equal(bad.length, 4, JSON.stringify(bad));
  assert.match(checkRow({ line: 4, family: 'S', role: 'head' }, today).errors[0]!, /full_name or email/);
  assert.match(checkRow({ line: 5, family: 'S', role: 'head', full_name: 'A', date_of_birth: '2027-01-01' }, today).errors[0]!, /future/);
  assert.match(checkRow({ line: 6, family: 'S', role: 'head', full_name: 'A', same_name_ok: 'maybe' }, today).errors[0]!, /yes or no/);
});

test('extension versions and surnames', () => {
  assert.equal(versionAtLeast('1.6.0', '1.6.0'), true);
  assert.equal(versionAtLeast('1.10.0', '1.6.0'), true);
  assert.equal(versionAtLeast('1.5.9', '1.6.0'), false);
  assert.equal(versionAtLeast(undefined, '1.6.0'), false);
  assert.equal(versionAtLeast('1.6', '1.6.0'), false);
  assert.equal(surnameOf('Raj Singh'), 'singh');
  assert.equal(surnameOf('  Ana  de la Cruz '), 'cruz');
  assert.equal(surnameOf('X'), null);
});
