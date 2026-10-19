import { createHash } from 'node:crypto';

export interface PayoutSplitRecipient {
  splitId: string;
  producerNodeId: string;
  producerName: string;
  amountCents: number;
  routingTransit: string; // Canada: 0XXX-YYYYY (3-digit inst, 5-digit transit) or US: 9-digit ABA
  accountNumber: string;
}

export interface PayoutBatchInput {
  importId: string;
  statementReference: string;
  currency: 'CAD' | 'USD';
  originatorName: string;
  originatorId: string;
  recipients: PayoutSplitRecipient[];
  effectiveDate?: string; // YYYY-MM-DD
}

export interface GeneratedPayoutBatch {
  format: 'CPA_005' | 'NACHA';
  currency: 'CAD' | 'USD';
  totalAmountCents: number;
  splitCount: number;
  fileContent: string;
  fileSha256: string;
  splits: Array<{
    splitId: string;
    producerNodeId: string;
    amountCents: number;
    routingTransit: string;
    accountNumberMasked: string;
    recipientName: string;
  }>;
}

/**
 * Validates a 9-digit US ABA routing number with standard checksum algorithm:
 * (3*(d1 + d4 + d7) + 7*(d2 + d5 + d8) + 1*(d3 + d6 + d9)) % 10 === 0
 */
export function validateAbaRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const checksum =
    3 * ((d[0] ?? 0) + (d[3] ?? 0) + (d[6] ?? 0)) +
    7 * ((d[1] ?? 0) + (d[4] ?? 0) + (d[7] ?? 0)) +
    1 * ((d[2] ?? 0) + (d[5] ?? 0) + (d[8] ?? 0));
  return checksum % 10 === 0;
}

/**
 * Validates Canadian CPA routing format:
 * Either formatted '0XXX-YYYYY' or 8-9 digits 'XXXYYYYY' / '0XXXYYYYY'
 */
export function validateCpaRouting(routing: string): boolean {
  const clean = routing.replace(/[-\s]/g, '');
  return /^\d{8,9}$/.test(clean);
}

export function maskAccountNumber(acc: string): string {
  const trimmed = acc.trim();
  if (trimmed.length <= 4) return '****' + trimmed;
  return '*'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}

/**
 * Generates Canadian Payments Association (CPA) Standard 005 Direct Deposit file.
 * Record Type A: File Header
 * Record Type C: Direct Deposit transaction (Code 200)
 * Record Type Z: File Trailer
 */
export function generateCpa005File(input: PayoutBatchInput): GeneratedPayoutBatch {
  if (input.recipients.length === 0) {
    throw new Error('Payout batch requires at least one recipient split');
  }

  const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  const totalAmountCents = input.recipients.reduce((sum, r) => {
    if (!Number.isInteger(r.amountCents) || r.amountCents < 0) {
      throw new Error(`Invalid non-integer or negative amount for split ${r.splitId}`);
    }
    return sum + r.amountCents;
  }, 0);

  const lines: string[] = [];

  // 1. Header Record (A)
  // Format: A + Client# (10) + FCN (4) + CreationDate (YYMMDD) + Originator (15) + Currency (3)
  const clientNo = input.originatorId.padEnd(10, ' ').slice(0, 10);
  const fcn = '0001';
  const creationDate = effectiveDate.replace(/-/g, '').slice(2); // YYMMDD
  const origName = input.originatorName.padEnd(15, ' ').slice(0, 15);
  lines.push(`A${clientNo}${fcn}${creationDate}${origName}CAD`.padEnd(80, ' '));

  // 2. Transaction Records (C)
  // Format: C + Code 200 + Amount (10) + Routing (9) + Account (12) + Payee (30) + Ref (19)
  const splits = input.recipients.map((r) => {
    const cleanRouting = r.routingTransit.replace(/[-\s]/g, '').padStart(9, '0').slice(-9);
    const amountStr = String(r.amountCents).padStart(10, '0');
    const accStr = r.accountNumber.trim().padEnd(12, ' ').slice(0, 12);
    const payeeStr = r.producerName.trim().padEnd(30, ' ').slice(0, 30);
    const refStr = r.splitId.replace(/-/g, '').padEnd(19, ' ').slice(0, 19);

    lines.push(`C200${amountStr}${cleanRouting}${accStr}${payeeStr}${refStr}`.padEnd(80, ' '));

    return {
      splitId: r.splitId,
      producerNodeId: r.producerNodeId,
      amountCents: r.amountCents,
      routingTransit: r.routingTransit,
      accountNumberMasked: maskAccountNumber(r.accountNumber),
      recipientName: r.producerName,
    };
  });

  // 3. Trailer Record (Z)
  // Format: Z + TotalCreditAmount (14) + TotalCreditCount (8) + TotalDebitAmount (14) + TotalDebitCount (8)
  const totalAmtStr = String(totalAmountCents).padStart(14, '0');
  const countStr = String(input.recipients.length).padStart(8, '0');
  lines.push(`Z${totalAmtStr}${countStr}${'0'.repeat(14)}${'0'.repeat(8)}`.padEnd(80, ' '));

  const fileContent = lines.join('\r\n') + '\r\n';
  const fileSha256 = createHash('sha256').update(fileContent, 'utf8').digest('hex');

  return {
    format: 'CPA_005',
    currency: 'CAD',
    totalAmountCents,
    splitCount: input.recipients.length,
    fileContent,
    fileSha256,
    splits,
  };
}

/**
 * Generates NACHA ACH Direct Deposit file for US distributions (SEC Code PPD).
 * Record 1: File Header
 * Record 5: Batch Header
 * Record 6: Entry Detail (Checking Credit 22)
 * Record 8: Batch Control
 * Record 9: File Control
 */
export function generateNachaFile(input: PayoutBatchInput): GeneratedPayoutBatch {
  if (input.recipients.length === 0) {
    throw new Error('Payout batch requires at least one recipient split');
  }

  const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  const totalAmountCents = input.recipients.reduce((sum, r) => {
    if (!Number.isInteger(r.amountCents) || r.amountCents < 0) {
      throw new Error(`Invalid non-integer or negative amount for split ${r.splitId}`);
    }
    return sum + r.amountCents;
  }, 0);

  const lines: string[] = [];
  const dateYYMMDD = effectiveDate.replace(/-/g, '').slice(2);

  // 1. File Header (Record 1) - 94 chars
  // 1 + Priority(01) + ImmDest(10) + ImmOrigin(10) + Date(6) + Time(4) + FileId(A) + RecSize(094) + Blk(10) + Code(1) + Dest(23) + Orig(23) + Ref(8)
  const immDest = (' ' + '121000358').padEnd(10, ' ').slice(0, 10); // Standard Federal Reserve test routing
  const immOrig = (' ' + input.originatorId.padEnd(9, ' ')).slice(0, 10);
  const destName = 'FEDACH'.padEnd(23, ' ').slice(0, 23);
  const origName = input.originatorName.padEnd(23, ' ').slice(0, 23);
  lines.push(`101${immDest}${immOrig}${dateYYMMDD}1200A094101${destName}${origName}${' '.repeat(8)}`);

  // 2. Company / Batch Header (Record 5) - 94 chars
  // 5 + 220 + CompName(16) + CompDiscData(20) + CompId(10) + PPD + Desc(10) + DescrDate(6) + EffDate(6) + SettlDate(3) + OrigStat(1) + OrigDFI(8) + BatchNo(7)
  const compName = input.originatorName.padEnd(16, ' ').slice(0, 16);
  const compId = input.originatorId.padEnd(10, ' ').slice(0, 10);
  const desc = 'COMMISSION'.padEnd(10, ' ').slice(0, 10);
  lines.push(`5220${compName}${' '.repeat(20)}${compId}PPD${desc}${dateYYMMDD}${dateYYMMDD}   1121000350000001`);

  let entryHash = 0;
  let traceNum = 1;

  // 3. Entry Details (Record 6) - 94 chars each
  const splits = input.recipients.map((r) => {
    const cleanRouting = r.routingTransit.replace(/[-\s]/g, '').padStart(9, '0').slice(-9);
    const dfiRouting = cleanRouting.slice(0, 8);
    const checkDigit = cleanRouting.slice(8, 9);
    entryHash = (entryHash + Number(dfiRouting)) % 10000000000;

    const accStr = r.accountNumber.trim().padEnd(17, ' ').slice(0, 17);
    const amtStr = String(r.amountCents).padStart(10, '0');
    const idStr = r.producerNodeId.replace(/-/g, '').padEnd(15, ' ').slice(0, 15);
    const nameStr = r.producerName.trim().padEnd(22, ' ').slice(0, 22);
    const traceStr = ('12100035' + String(traceNum++).padStart(7, '0')).slice(0, 15);

    lines.push(`622${dfiRouting}${checkDigit}${accStr}${amtStr}${idStr}${nameStr}  0${traceStr}`);

    return {
      splitId: r.splitId,
      producerNodeId: r.producerNodeId,
      amountCents: r.amountCents,
      routingTransit: r.routingTransit,
      accountNumberMasked: maskAccountNumber(r.accountNumber),
      recipientName: r.producerName,
    };
  });

  // 4. Batch Control (Record 8) - 94 chars
  const entryCountStr = String(input.recipients.length).padStart(6, '0');
  const hashStr = String(entryHash).padStart(10, '0');
  const creditAmtStr = String(totalAmountCents).padStart(12, '0');
  lines.push(`8220${entryCountStr}${hashStr}${'0'.repeat(12)}${creditAmtStr}${compId}${' '.repeat(25)}121000350000001`.padEnd(94, ' ').slice(0, 94));

  // 5. File Control (Record 9) - 94 chars
  // 9 + BatchCount(6) + BlockCount(6) + EntryCount(8) + Hash(10) + Debit(12) + Credit(12) + Reserved(39)
  const totalLines = lines.length + 1; // plus this line
  const blockCount = Math.ceil(totalLines / 10);
  const blockCountStr = String(blockCount).padStart(6, '0');
  const entryCount8Str = String(input.recipients.length).padStart(8, '0');
  lines.push(`9000001${blockCountStr}${entryCount8Str}${hashStr}${'0'.repeat(12)}${creditAmtStr}${' '.repeat(39)}`);

  // Pad to multiple of 10 blocks if standard blocking requested
  while (lines.length % 10 !== 0) {
    lines.push('9'.repeat(94));
  }

  const fileContent = lines.join('\r\n') + '\r\n';
  const fileSha256 = createHash('sha256').update(fileContent, 'utf8').digest('hex');

  return {
    format: 'NACHA',
    currency: 'USD',
    totalAmountCents,
    splitCount: input.recipients.length,
    fileContent,
    fileSha256,
    splits,
  };
}
