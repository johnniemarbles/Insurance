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
