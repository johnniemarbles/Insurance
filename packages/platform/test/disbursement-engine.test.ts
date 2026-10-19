import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCpa005File,
  generateNachaFile,
  validateAbaRouting,
  validateCpaRouting,
  maskAccountNumber,
  type PayoutBatchInput,
} from '../src/disbursement-engine.ts';

test('Disbursement Engine: routing and account number validators', () => {
  // Canadian CPA routing: 3-digit inst, 5-digit transit
  assert.equal(validateCpaRouting('0001-10293'), true);
  assert.equal(validateCpaRouting('00110293'), true);
  assert.equal(validateCpaRouting('000110293'), true);
  assert.equal(validateCpaRouting('123'), false);

  // US NACHA ABA routing: 9-digit with weighted checksum
  // Valid routing: 121000358 (Federal Reserve San Francisco)
  assert.equal(validateAbaRouting('121000358'), true);
  // Invalid check digit
  assert.equal(validateAbaRouting('121000359'), false);
  assert.equal(validateAbaRouting('12345'), false);

  // Account masking
  assert.equal(maskAccountNumber('1234567890'), '******7890');
  assert.equal(maskAccountNumber('123'), '****123');
});

test('Disbursement Engine: Canadian CPA 005 Direct Deposit generation', () => {
  const input: PayoutBatchInput = {
    importId: '11111111-1111-1111-1111-111111111111',
    statementReference: 'STMT-IA-2026-10',
    currency: 'CAD',
    originatorName: 'PUNJAB INS INC',
    originatorId: '9876543210',
    effectiveDate: '2026-10-25',
    recipients: [
      {
        splitId: '22222222-2222-2222-2222-222222222222',
        producerNodeId: '33333333-3333-3333-3333-333333333333',
        producerName: 'Amandeep Singh',
        amountCents: 145000, // $1,450.00
        routingTransit: '0001-10293',
        accountNumber: '9988776655',
      },
      {
        splitId: '44444444-4444-4444-4444-444444444444',
        producerNodeId: '55555555-5555-5555-5555-555555555555',
        producerName: 'Priya Sharma',
        amountCents: 85050, // $850.50
        routingTransit: '0003-88776',
        accountNumber: '1122334455',
      },
    ],
  };

  const result = generateCpa005File(input);

  assert.equal(result.format, 'CPA_005');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.splitCount, 2);
  assert.equal(result.totalAmountCents, 230050); // $2,300.50
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/);

  // Check structure: Header (A), 2 Transactions (C), Trailer (Z)
  const lines = result.fileContent.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0]!.startsWith('A98765432100001261025PUNJAB INS INC CAD'), true);
  assert.equal(lines[1]!.startsWith('C20000001450000001102939988776655  Amandeep Singh'), true);
  assert.equal(lines[2]!.startsWith('C20000000850500003887761122334455  Priya Sharma'), true);
  assert.equal(lines[3]!.startsWith('Z00000000230050000000020000000000000000000000'), true);

  // Splits summary
  assert.equal(result.splits[0]!.accountNumberMasked, '******6655');
  assert.equal(result.splits[1]!.accountNumberMasked, '******4455');
});

test('Disbursement Engine: US NACHA ACH Direct Deposit generation', () => {
  const input: PayoutBatchInput = {
    importId: '11111111-1111-1111-1111-111111111111',
    statementReference: 'STMT-US-2026-10',
    currency: 'USD',
    originatorName: 'PUNJAB INS US',
    originatorId: '123456789',
    effectiveDate: '2026-10-25',
    recipients: [
      {
        splitId: '22222222-2222-2222-2222-222222222222',
        producerNodeId: '33333333-3333-3333-3333-333333333333',
        producerName: 'John Doe',
        amountCents: 250000, // $2,500.00
        routingTransit: '121000358',
        accountNumber: '1234567890',
      },
    ],
  };

  const result = generateNachaFile(input);

  assert.equal(result.format, 'NACHA');
  assert.equal(result.currency, 'USD');
  assert.equal(result.splitCount, 1);
  assert.equal(result.totalAmountCents, 250000);
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/);

  // NACHA records must be exactly 94 characters wide
  const lines = result.fileContent.trim().split('\r\n');
  assert.ok(lines.length >= 5);
  for (const line of lines) {
    assert.equal(line.length, 94, `NACHA line should be exactly 94 chars: ${line}`);
  }

  assert.equal(lines[0]![0], '1', 'File Header record must start with 1');
  assert.equal(lines[1]![0], '5', 'Batch Header record must start with 5');
  assert.equal(lines[2]![0], '6', 'Entry Detail record must start with 6');
  assert.equal(lines[3]![0], '8', 'Batch Control record must start with 8');
  assert.equal(lines[4]![0], '9', 'File Control record must start with 9');
});
