// Phase 11: Commercial Operations Domain
// Policy inventory, idempotent statement imports, reconciliation matching, and monetary invariants.

export const POLICY_STATUSES = ['pending', 'active', 'lapsed', 'cancelled', 'surrendered', 'reinstated'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const PREMIUM_FREQUENCIES = ['annual', 'semi-annual', 'quarterly', 'monthly'] as const;
export type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number];

export const COMMISSION_IMPORT_STATUSES = ['registered', 'reconciled', 'exceptions_flagged', 'approved', 'posted'] as const;
export type CommissionImportStatus = (typeof COMMISSION_IMPORT_STATUSES)[number];

export const COMMISSION_TRANSACTION_TYPES = ['first_year', 'renewal', 'override', 'bonus', 'chargeback', 'fee'] as const;
export type CommissionTransactionType = (typeof COMMISSION_TRANSACTION_TYPES)[number];

export const RECONCILIATION_STATUSES = ['matched', 'unmatched', 'variance_flagged', 'chargeback_linked'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface PolicyRecord {
  id: string;
  tenantId: string;
  branchNodeId: string;
  producerNodeId: string;
  carrierId: string;
  policyNumber: string;
  planName: string;
  jurisdiction: string;
  annualPremiumCents: number;
  modalPremiumCents: number;
  premiumFrequency: PremiumFrequency;
  status: PolicyStatus;
  effectiveDate: string;
  expiryDate?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePolicyInput {
  carrierId: string;
  branchNodeId: string;
  producerNodeId: string;
  policyNumber: string;
  planName: string;
  jurisdiction: string;
  annualPremiumCents: number;
  modalPremiumCents: number;
  premiumFrequency: PremiumFrequency;
  status?: PolicyStatus;
  effectiveDate: string;
  expiryDate?: string | null;
}

export interface CreateCommissionLineInput {
  policyNumber: string;
  grossAmountCents: number;
  netAmountCents: number;
  transactionType: CommissionTransactionType;
  carrierProducerCode?: string | null;
}

export interface CreateCommissionImportInput {
  carrierId: string;
  statementReference: string;
  statementDate: string;
  fileHashSha256: string;
  lines: CreateCommissionLineInput[];
}

export interface CommissionImport {
  id: string;
  tenantId: string;
  carrierId: string;
  statementReference: string;
  statementDate: string;
  fileHashSha256: string;
  totalGrossCents: number;
  totalNetCents: number;
  lineCount: number;
  status: CommissionImportStatus;
  payoutsDisabled: boolean;
  importedBy?: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface CommissionLineItem {
  id: string;
  tenantId: string;
  importId: string;
  policyNumber: string;
  policyId?: string | null;
  carrierProducerCode?: string | null;
  producerNodeId?: string | null;
  transactionType: CommissionTransactionType;
  grossAmountCents: number;
  netAmountCents: number;
  reconciliationStatus: ReconciliationStatus;
  exceptionReason?: string | null;
  createdAt: string;
}

export interface ReconciliationPreview {
  importId: string;
  statementReference: string;
  carrierId: string;
  statementDate: string;
  totalGrossCents: number;
  totalNetCents: number;
  lineCount: number;
  matchedCount: number;
  unmatchedCount: number;
  varianceCount: number;
  chargebackCount: number;
  payoutsDisabled: boolean;
  lines: CommissionLineItem[];
}

/** Validate non-negative integer cents for premiums */
export function validatePremiumCents(val: unknown, fieldName: string): number {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
    throw new Error(`${fieldName} must be a non-negative integer in cents`);
  }
  return val;
}

/** Validate integer cents for commission amounts (can be negative for chargebacks) */
export function validateAmountCents(val: unknown, fieldName: string): number {
  if (typeof val !== 'number' || !Number.isInteger(val)) {
    throw new Error(`${fieldName} must be an integer in cents`);
  }
  return val;
}

/** Validate 64-char lowercase SHA-256 hex string */
export function validateSha256Hash(hash: unknown): string {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash.trim().toLowerCase())) {
    throw new Error('fileHashSha256 must be a valid 64-character lowercase SHA-256 hex string');
  }
  return hash.trim().toLowerCase();
}

export interface CommissionAgreement {
  id: string;
  tenantId: string;
  producerNodeId: string;
  carrierId: string;
  version: string;
  brokerSplitBps: number;
  branchOverrideBps: number;
  mgaSpreadBps: number;
  holdbackBps: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: 'draft' | 'active' | 'superseded' | 'terminated';
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionSplit {
  id: string;
  tenantId: string;
  importId: string;
  lineItemId: string;
  agreementId?: string | null;
  producerNodeId: string;
  grossAmountCents: number;
  brokerNetCents: number;
  branchOverrideCents: number;
  mgaSpreadCents: number;
  holdbackCents: number;
  status: 'calculated' | 'approved' | 'held';
  createdAt: string;
}

/**
 * Deterministic MGA & Broker commission split engine.
 * Splits are computed strictly using integer cents from contractual basis points.
 */
export function calculateDeterministicSplit(
  grossAmountCents: number,
  agreement: {
    brokerSplitBps: number;
    branchOverrideBps: number;
    mgaSpreadBps: number;
    holdbackBps: number;
  }
): {
  brokerGrossCents: number;
  brokerNetCents: number;
  branchOverrideCents: number;
  mgaSpreadCents: number;
  holdbackCents: number;
} {
  const totalBps = agreement.brokerSplitBps + agreement.branchOverrideBps + agreement.mgaSpreadBps;
  if (totalBps !== 10000) {
    throw new Error(`Split basis points must equal exactly 10,000 (100.00%), received: ${totalBps}`);
  }
  if (agreement.holdbackBps < 0 || agreement.holdbackBps > agreement.brokerSplitBps) {
    throw new Error(`Holdback (${agreement.holdbackBps} BPS) cannot exceed broker split (${agreement.brokerSplitBps} BPS) or be negative`);
  }

  const brokerGrossCents = Math.round((grossAmountCents * agreement.brokerSplitBps) / 10000);
  const holdbackCents = Math.round((brokerGrossCents * agreement.holdbackBps) / 10000);
  const brokerNetCents = brokerGrossCents - holdbackCents;
  const branchOverrideCents = Math.round((grossAmountCents * agreement.branchOverrideBps) / 10000);
  const mgaSpreadCents = grossAmountCents - brokerGrossCents - branchOverrideCents;

  return {
    brokerGrossCents,
    brokerNetCents,
    branchOverrideCents,
    mgaSpreadCents,
    holdbackCents,
  };
}

export interface CsvStatementRow {
  policyNumber: string;
  grossAmountCents: number;
  netAmountCents: number;
  transactionType: CommissionTransactionType;
  carrierProducerCode?: string | null;
}

export interface CarrierProfile {
  id: string;
  displayName: string;
  aliases: string[];
  policyHeaders: string[];
  grossHeaders: string[];
  netHeaders: string[];
  typeHeaders: string[];
  codeHeaders: string[];
  transactionTypeMap: Record<string, CommissionTransactionType>;
}

export const CARRIER_IMPORT_PROFILES: CarrierProfile[] = [
  {
    id: 'standard',
    displayName: 'Standard Statement Profile',
    aliases: ['standard', 'generic', 'default'],
    policyHeaders: ['policynumber', 'policy_number', 'policy no', 'policyno', 'policy', 'policy #', 'contract'],
    grossHeaders: ['grossamount', 'gross_amount', 'gross', 'gross commission', 'gross comm', 'gross amount cents'],
    netHeaders: ['netamount', 'net_amount', 'net', 'net commission', 'net comm', 'net amount cents'],
    typeHeaders: ['transactiontype', 'transaction_type', 'type', 'trans_type', 'activity_type', 'transtype'],
    codeHeaders: ['producercode', 'producer_code', 'agent_code', 'agent_id', 'writingagent', 'agent', 'producer'],
    transactionTypeMap: {
      first_year: 'first_year',
      renewal: 'renewal',
      override: 'override',
      bonus: 'bonus',
      chargeback: 'chargeback',
      fee: 'fee',
    },
  },
  {
    id: 'ia-financial-group',
    displayName: 'iA Financial Group (Industrial Alliance)',
    aliases: ['ia', 'ia-financial-group', 'industrial alliance', 'ia financial group'],
    policyHeaders: ['nopolice', 'no_police', 'police', 'policyno', 'policy_number', 'policy', 'policenum'],
    grossHeaders: ['commissionbrute', 'comm_brute', 'grosscommission', 'gross_amount', 'gross', 'brute'],
    netHeaders: ['commissionnette', 'comm_nette', 'netcommission', 'net_amount', 'net', 'nette'],
    typeHeaders: ['typetransaction', 'type_transaction', 'code_trans', 'transcode', 'type'],
    codeHeaders: ['codeconseiller', 'code_conseiller', 'conseiller', 'advisorcode', 'producercode', 'producer_code'],
    transactionTypeMap: {
      comm1: 'first_year',
      comm2: 'renewal',
      comm_ren: 'renewal',
      renouvellement: 'renewal',
      fyc: 'first_year',
      '1st': 'first_year',
      first_year: 'first_year',
      initial: 'first_year',
      ren: 'renewal',
      renw: 'renewal',
      renewal: 'renewal',
      chgbk: 'chargeback',
      rep: 'chargeback',
      clawback: 'chargeback',
      chargeback: 'chargeback',
      reversal: 'chargeback',
      ovr: 'override',
      override: 'override',
      bon: 'bonus',
      bonus: 'bonus',
      fee: 'fee',
      frais: 'fee',
    },
  },
  {
    id: 'sun-life',
    displayName: 'Sun Life Financial',
    aliases: ['sun-life', 'sun life', 'slf'],
    policyHeaders: ['policy_number', 'policy_no', 'policyno', 'contract_num', 'policy'],
    grossHeaders: ['gross_amt', 'gross_commission', 'gross_amount', 'gross'],
    netHeaders: ['net_amt', 'net_payable', 'net_amount', 'net'],
    typeHeaders: ['trans_code', 'transcode', 'trans', 'activity_type', 'trans_type', 'transaction_type', 'type'],
    codeHeaders: ['advisor_id', 'advisorid', 'advisor', 'agent_id', 'writing_agent', 'producer_code', 'agent'],
    transactionTypeMap: {
      fyc: 'first_year',
      first_year: 'first_year',
      new: 'first_year',
      rnw: 'renewal',
      renewal: 'renewal',
      ren: 'renewal',
      cbk: 'chargeback',
      chargeback: 'chargeback',
      recov: 'chargeback',
      ovr: 'override',
      override: 'override',
      bon: 'bonus',
      bonus: 'bonus',
      fee: 'fee',
      serv: 'fee',
    },
  },
  {
    id: 'manulife',
    displayName: 'Manulife Financial',
    aliases: ['manulife', 'manu', 'manufacturers'],
    policyHeaders: ['policynum', 'policy_num', 'policy_number', 'policy'],
    grossHeaders: ['grosspremcomm', 'gross_comm', 'gross_amount', 'gross'],
    netHeaders: ['netpaid', 'net_comm', 'net_amount', 'net'],
    typeHeaders: ['transtype', 'trans_type', 'type'],
    codeHeaders: ['writingagent', 'agent_num', 'producer_code'],
    transactionTypeMap: {
      fy: 'first_year',
      fyc: 'first_year',
      first_year: 'first_year',
      rn: 'renewal',
      rnw: 'renewal',
      renewal: 'renewal',
      cb: 'chargeback',
      chargeback: 'chargeback',
      claw: 'chargeback',
      ov: 'override',
      override: 'override',
      bn: 'bonus',
      bonus: 'bonus',
      fe: 'fee',
      fee: 'fee',
    },
  },
  {
    id: 'canada-life',
    displayName: 'Canada Life',
    aliases: ['canada-life', 'gwl', 'great-west', 'canadalife'],
    policyHeaders: ['policy_id', 'policy_number', 'plan_number', 'policy'],
    grossHeaders: ['gross_commission', 'gross_payment', 'gross_amount', 'gross'],
    netHeaders: ['net_payment', 'net_commission', 'net_amount', 'net'],
    typeHeaders: ['event_type', 'trans_code', 'transaction_type', 'type'],
    codeHeaders: ['producer_num', 'rep_id', 'agent_code', 'agent'],
    transactionTypeMap: {
      new: 'first_year',
      fyc: 'first_year',
      first_year: 'first_year',
      ren: 'renewal',
      renewal: 'renewal',
      rev: 'chargeback',
      cbk: 'chargeback',
      chargeback: 'chargeback',
      ovr: 'override',
      override: 'override',
      bon: 'bonus',
      bonus: 'bonus',
      adj: 'fee',
      fee: 'fee',
    },
  },
];

export function getCarrierProfile(carrierId?: string): CarrierProfile {
  if (!carrierId) return CARRIER_IMPORT_PROFILES[0]!;
  const needle = carrierId.trim().toLowerCase();
  const found = CARRIER_IMPORT_PROFILES.find(
    p => p.id === needle || p.aliases.some(a => a.toLowerCase() === needle)
  );
  if (!found) {
    throw new Error(`Unknown carrier import profile: '${carrierId}'`);
  }
  return found;
}

/**
 * Parses exact financial decimal strings to integer cents without floating-point arithmetic.
 * Handles currency prefixes ($ / CAD / USD), thousands commas, negative signs, and accounting parentheses.
 */
export function parseDecimalToCents(val: unknown, fieldName = 'Amount', rowIdx?: number): number {
  const prefix = rowIdx !== undefined ? `Row ${rowIdx}: ` : '';
  if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
    throw new Error(`${prefix}${fieldName} cannot be empty`);
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`${prefix}${fieldName} must be a finite number`);
    }
    if (Number.isInteger(val)) {
      return val;
    }
    val = val.toFixed(2);
  }

  if (typeof val !== 'string') {
    throw new Error(`${prefix}${fieldName} must be a string or integer`);
  }

  let s = val.trim();

  // Accounting parentheses check: e.g. (123.45) or ($123.45)
  let isNegative = false;
  if (/^\(.*\)$/.test(s)) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Strip currency prefixes and symbols: $, CAD, USD, EUR, etc.
  s = s.replace(/^(CAD|USD|EUR|GBP|CA\$|US\$)\s*/i, '').trim();
  s = s.replace(/^(\$|€|£)\s*/, '').trim();

  // Handle trailing/embedded negative sign if placed after currency symbol e.g. $-100.00
  if (s.startsWith('-')) {
    if (isNegative) {
      throw new Error(`${prefix}Invalid monetary format '${val}' for ${fieldName}`);
    }
    isNegative = true;
    s = s.slice(1).trim();
  }

  // Thousands separator validation (e.g. 1,234,567.89)
  if (s.includes(',')) {
    const partsWithoutComma = s.split(',');
    for (let i = 1; i < partsWithoutComma.length; i++) {
      const chunk = partsWithoutComma[i]!.split('.')[0]!;
      if (chunk.length !== 3) {
        throw new Error(`${prefix}Invalid monetary format with thousands separator '${val}' for ${fieldName}`);
      }
    }
    s = s.replace(/,/g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`${prefix}Invalid monetary format '${val}' for ${fieldName}. Expected numeric value with at most 2 decimal places`);
  }

  const [dollarsPart, centsPart = ''] = s.split('.');
  const dollars = BigInt(dollarsPart!);
  let cents = 0n;
  if (centsPart.length === 1) {
    cents = BigInt(centsPart) * 10n;
  } else if (centsPart.length === 2) {
    cents = BigInt(centsPart);
  }

  const totalCents = Number(dollars * 100n + cents);
  return isNegative ? -totalCents : totalCents;
}

/**
 * RFC 4180 compliant CSV line tokenizer.
 * Correctly parses quoted fields, escaped quotes (""), and multiline content.
 */
export function tokenizeCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = csvText.length;

  while (i < len) {
    const char = csvText[i]!;

    if (inQuotes) {
      if (char === '"') {
        // Escaped quote: "" inside quoted field
        if (i + 1 < len && csvText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && csvText[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (inQuotes) {
    throw new Error('Unclosed quote in CSV document');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Remove single trailing empty line at EOF if present (standard in text files)
  if (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 0 || (last.length === 1 && last[0] === '')) {
      rows.pop();
    }
  }

  return rows;
}

/**
 * Production-grade commission statement CSV parser.
 * Features:
 * - RFC 4180 compliant tokenization
 * - Zero floating point math (strict decimal-to-cents)
 * - Zero silent row skipping (rejection of incomplete or malformed lines)
 * - Carrier-specific header and transaction type mapping
 * - Rejection of unknown transaction types
 */
export function parseCommissionCsvStrict(csvText: string, carrierId?: string): CsvStatementRow[] {
  const profile = getCarrierProfile(carrierId);
  const rows = tokenizeCsv(csvText);

  if (rows.length < 2) {
    throw new Error('CSV statement must contain a header row and at least one data row');
  }

  const rawHeaders = rows[0]!;
  const normalizedHeaders = rawHeaders.map(h => h.toLowerCase().replace(/[\s_\-#]+/g, ''));

  const findHeaderIdx = (patterns: string[]) => {
    return normalizedHeaders.findIndex(h =>
      patterns.some(p => {
        const normP = p.toLowerCase().replace(/[\s_\-#]+/g, '');
        return h === normP || h.includes(normP);
      })
    );
  };

  const policyIdx = findHeaderIdx(profile.policyHeaders);
  const grossIdx = findHeaderIdx(profile.grossHeaders);
  const netIdx = findHeaderIdx(profile.netHeaders);
  const typeIdx = findHeaderIdx(profile.typeHeaders);
  const codeIdx = findHeaderIdx(profile.codeHeaders);

  if (policyIdx === -1) {
    throw new Error(`Missing required header column: policyNumber. Found columns: [${rawHeaders.join(', ')}] for profile '${profile.displayName}'`);
  }
  if (grossIdx === -1) {
    throw new Error(`Missing required header column: grossAmount. Found columns: [${rawHeaders.join(', ')}] for profile '${profile.displayName}'`);
  }
  if (netIdx === -1) {
    throw new Error(`Missing required header column: netAmount. Found columns: [${rawHeaders.join(', ')}] for profile '${profile.displayName}'`);
  }

  const parsedRows: CsvStatementRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rowIdx = i + 1;
    const cols = rows[i]!;

    if (cols.length === 0 || (cols.length === 1 && cols[0] === '')) {
      throw new Error(`Row ${rowIdx} is empty; empty rows are not permitted in commission statements`);
    }

    if (cols.length !== rawHeaders.length) {
      throw new Error(`Row ${rowIdx}: expected ${rawHeaders.length} fields, found ${cols.length}`);
    }

    const policyNumber = (cols[policyIdx] ?? '').trim();
    if (!policyNumber) {
      throw new Error(`Row ${rowIdx}: Policy number cannot be empty`);
    }

    const grossAmountCents = parseDecimalToCents(cols[grossIdx], 'GrossAmount', rowIdx);
    const netAmountCents = parseDecimalToCents(cols[netIdx], 'NetAmount', rowIdx);

    let transactionType: CommissionTransactionType;

    if (typeIdx !== -1 && cols[typeIdx] && cols[typeIdx]!.trim() !== '') {
      const rawCode = cols[typeIdx]!.trim().toLowerCase();
      const mapped =
        profile.transactionTypeMap[rawCode] ??
        (COMMISSION_TRANSACTION_TYPES.includes(rawCode as CommissionTransactionType)
          ? (rawCode as CommissionTransactionType)
          : null);

      if (!mapped) {
        throw new Error(`Row ${rowIdx}: Unrecognized transaction type '${cols[typeIdx]}' for carrier profile '${profile.id}'`);
      }
      transactionType = mapped;
    } else if (grossAmountCents < 0) {
      transactionType = 'chargeback';
    } else {
      transactionType = 'first_year';
    }

    const carrierProducerCode =
      codeIdx !== -1 && cols[codeIdx] && cols[codeIdx]!.trim() !== '' ? cols[codeIdx]!.trim() : null;

    parsedRows.push({
      policyNumber,
      grossAmountCents,
      netAmountCents,
      transactionType,
      carrierProducerCode,
    });
  }

  return parsedRows;
}

/** Alias to parseCommissionCsvStrict for backwards compatibility */
export const parseCommissionCsv = parseCommissionCsvStrict;

