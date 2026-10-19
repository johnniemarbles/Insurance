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

/**
 * Parses and validates a standard carrier commission CSV file content.
 * Accepts headers: PolicyNumber, GrossAmount, NetAmount, TransactionType, [ProducerCode]
 */
export function parseCommissionCsv(csvText: string): CsvStatementRow[] {
  const lines = csvText.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV statement must contain a header row and at least one data row');
  }

  const headerLine = lines[0]!.toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  
  const policyIdx = headers.findIndex(h => h.includes('policy'));
  const grossIdx = headers.findIndex(h => h.includes('gross'));
  const netIdx = headers.findIndex(h => h.includes('net'));
  const typeIdx = headers.findIndex(h => h.includes('type') || h.includes('transaction'));
  const codeIdx = headers.findIndex(h => h.includes('producer') || h.includes('agent') || h.includes('code'));

  if (policyIdx === -1 || grossIdx === -1 || netIdx === -1) {
    throw new Error('CSV header missing mandatory columns: PolicyNumber, GrossAmount, NetAmount');
  }

  const rows: CsvStatementRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i]!.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (rawCols.length <= Math.max(policyIdx, grossIdx, netIdx)) continue;

    const policyNumber = rawCols[policyIdx] ?? '';
    if (!policyNumber) throw new Error(`Row ${i}: Policy number cannot be empty`);

    const grossFloat = Number.parseFloat(rawCols[grossIdx] ?? '0');
    const netFloat = Number.parseFloat(rawCols[netIdx] ?? '0');
    if (!Number.isFinite(grossFloat) || !Number.isFinite(netFloat)) {
      throw new Error(`Row ${i}: Invalid numerical dollar amount`);
    }

    const grossAmountCents = Math.round(grossFloat * 100);
    const netAmountCents = Math.round(netFloat * 100);

    let transactionType: CommissionTransactionType = 'first_year';
    if (typeIdx !== -1 && rawCols[typeIdx]) {
      const rawType = rawCols[typeIdx]!.toLowerCase();
      if (COMMISSION_TRANSACTION_TYPES.includes(rawType as CommissionTransactionType)) {
        transactionType = rawType as CommissionTransactionType;
      }
    } else if (grossAmountCents < 0) {
      transactionType = 'chargeback';
    }

    const carrierProducerCode = codeIdx !== -1 && rawCols[codeIdx] ? rawCols[codeIdx] : null;

    rows.push({
      policyNumber,
      grossAmountCents,
      netAmountCents,
      transactionType,
      carrierProducerCode,
    });
  }

  return rows;
}
