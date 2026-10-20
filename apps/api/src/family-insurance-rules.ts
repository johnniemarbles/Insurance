// Families, Gate B: the rules for people on a policy, as plain functions (no database), so they can be tested alone.
//
// Beneficiaries are checked per designation group: one group per insured life and class (primary or contingent).
// Within a group the split is either percentages that total exactly 100%, equal shares, or the estate alone.
// Drafts may be incomplete; these checks run when a policy is checked for submission, never while someone types.

export type PartyRole = 'owner' | 'joint_owner' | 'insured' | 'joint_insured' | 'payor' | 'beneficiary' | 'trustee';
export const PARTY_ROLES: readonly PartyRole[] = ['owner', 'joint_owner', 'insured', 'joint_insured', 'payor', 'beneficiary', 'trustee'];
export type BeneficiaryClass = 'primary' | 'contingent';
export type Allocation = 'percentage' | 'equal' | 'estate';

export interface CarrierProfile {
  requiresOwner: boolean; requiresInsured: boolean; allowsJointOwner: boolean; allowsJointInsured: boolean;
  allowsEstateBeneficiary: boolean; allowsOutsideBeneficiary: boolean; allowsEqualShares: boolean; allowsTrustee: boolean;
  confirmedWithCarrier: boolean;
}
/** Used when neither the carrier nor the tenant has a profile: permissive on options, strict on the basics. */
export const DEFAULT_PROFILE: CarrierProfile = {
  requiresOwner: true, requiresInsured: true, allowsJointOwner: true, allowsJointInsured: true,
  allowsEstateBeneficiary: true, allowsOutsideBeneficiary: true, allowsEqualShares: true, allowsTrustee: true, confirmedWithCarrier: false,
};

export interface PartyLike {
  role: PartyRole; contactId: string | null; outsideName: string | null;
  beneficiaryClass: BeneficiaryClass | null; insuredContactId: string | null; allocationMethod: Allocation | null; shareBasisPoints: number | null;
}
export interface Finding { code: string; message: string }
export interface CheckResult { ready: boolean; errors: Finding[]; warnings: Finding[] }

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

/** Whether a role may be added at all under this carrier's rules (checked when adding, so a draft never holds a forbidden role). */
export function roleAllowed(p: CarrierProfile, party: Pick<PartyLike, 'role' | 'outsideName' | 'allocationMethod'>): Finding | null {
  if (party.role === 'joint_owner' && !p.allowsJointOwner) return { code: 'joint_owner_not_allowed', message: 'This carrier does not accept joint owners' };
  if (party.role === 'joint_insured' && !p.allowsJointInsured) return { code: 'joint_insured_not_allowed', message: 'This carrier does not accept joint insureds' };
  if (party.role === 'trustee' && !p.allowsTrustee) return { code: 'trustee_not_allowed', message: 'This carrier does not accept a trustee here' };
  if (party.role === 'beneficiary' && party.allocationMethod === 'estate' && !p.allowsEstateBeneficiary) return { code: 'estate_not_allowed', message: 'This carrier does not accept the estate as beneficiary' };
  if (party.role === 'beneficiary' && party.allocationMethod === 'equal' && !p.allowsEqualShares) return { code: 'equal_not_allowed', message: 'This carrier needs a percentage for each beneficiary' };
  if (party.outsideName && party.role === 'beneficiary' && !p.allowsOutsideBeneficiary) return { code: 'outside_not_allowed', message: 'This carrier needs beneficiaries to be clients on file' };
  return null;
}

/** The submission check for one policy's open parties. */
export function checkPolicyParties(parties: PartyLike[], p: CarrierProfile): CheckResult {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const has = (...roles: PartyRole[]) => parties.some((x) => roles.includes(x.role));
  if (p.requiresOwner && !has('owner', 'joint_owner')) errors.push({ code: 'missing_owner', message: 'Add the policy owner' });
  if (has('joint_owner') && !has('owner')) errors.push({ code: 'joint_without_owner', message: 'A joint owner needs an owner beside them' });
  if (p.requiresInsured && !has('insured', 'joint_insured')) errors.push({ code: 'missing_insured', message: 'Add the insured person' });
  if (has('joint_insured') && !has('insured')) errors.push({ code: 'joint_insured_without_insured', message: 'A joint insured needs an insured beside them' });
  for (const x of parties) { const f = roleAllowed(p, x); if (f) errors.push(f); }

  const insuredLives = parties.filter((x) => (x.role === 'insured' || x.role === 'joint_insured') && x.contactId).map((x) => x.contactId!);
  const bens = parties.filter((x) => x.role === 'beneficiary');
  if (insuredLives.length > 1) {
    for (const b of bens) if (!b.insuredContactId) { errors.push({ code: 'whose_life', message: 'This policy covers more than one life: say whose life each beneficiary is named on' }); break; }
  }
  // Group by insured life and class.
  const groups = new Map<string, PartyLike[]>();
  for (const b of bens) {
    const key = `${b.insuredContactId ?? '*'}|${b.beneficiaryClass}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  for (const [key, rows] of groups) {
    const cls = key.split('|')[1] === 'primary' ? 'primary' : 'contingent';
    const methods = new Set(rows.map((r) => r.allocationMethod));
    if (methods.has('estate')) {
      if (rows.length > 1) errors.push({ code: 'estate_alone', message: `The estate must be the only ${cls} beneficiary in its group` });
      continue;
    }
    if (methods.size > 1) { errors.push({ code: 'mixed_split', message: `Use either percentages or equal shares for the ${cls} beneficiaries, not both` }); continue; }
    if (methods.has('percentage')) {
      const total = rows.reduce((a, r) => a + (r.shareBasisPoints ?? 0), 0);
      if (total !== 10000) errors.push({ code: 'shares_total', message: `The ${cls} beneficiaries' shares total ${pct(total)}; they must total 100%` });
    }
  }
  // A contingent group with no primary group for the same life is unusual: say so, do not block.
  for (const key of groups.keys()) {
    const [life, cls] = key.split('|');
    if (cls === 'contingent' && !groups.has(`${life}|primary`)) warnings.push({ code: 'contingent_without_primary', message: 'There are contingent beneficiaries but no primary beneficiary' });
  }
  if (bens.length === 0) warnings.push({ code: 'no_beneficiary', message: 'No beneficiary is recorded (the estate applies unless the carrier holds one)' });
  if (!p.confirmedWithCarrier) warnings.push({ code: 'rules_unconfirmed', message: 'This carrier\'s rules have not been confirmed with the carrier yet' });
  return { ready: errors.length === 0, errors, warnings };
}

/** Currency of a policy, from its jurisdiction ("CA-ON" → CAD, "US-CA" → USD). Unknown stays unknown, never assumed. */
export function currencyOf(jurisdiction: string | null | undefined): 'CAD' | 'USD' | null {
  const c = String(jurisdiction ?? '').slice(0, 2).toUpperCase();
  return c === 'CA' ? 'CAD' : c === 'US' ? 'USD' : null;
}

export const IN_FORCE = ['active', 'reinstated'] as const;
export const ENDED = ['lapsed', 'cancelled', 'surrendered'] as const;
/** Roles that make a policy the family's own (counted in family totals). Beneficiary-only policies are listed apart. */
export const HOLDING_ROLES: readonly PartyRole[] = ['owner', 'joint_owner', 'insured', 'joint_insured', 'payor'];
