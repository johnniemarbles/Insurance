// Partner onboarding: the good-standing decision, the onboarding stages, the carrier-packet gate and the 6-month recheck. Pure logic.
// Thresholds are per country (Canada: credit pass 600, review 575-599). The compliance officer for the region records the final decision;
// suggestedStanding only proposes one.

export const STANDING_OUTCOMES = ['good_standing', 'needs_review', 'not_in_good_standing'] as const;
export type StandingOutcome = (typeof STANDING_OUTCOMES)[number];

export const STANDING_LABELS: Record<StandingOutcome, { en: string; 'fr-CA': string }> = {
  good_standing: { en: 'Good standing', 'fr-CA': 'Bonne réputation' },
  needs_review: { en: 'Needs review', 'fr-CA': 'À examiner' },
  not_in_good_standing: { en: 'Not in good standing', 'fr-CA': 'Réputation non conforme' },
};

export interface CheckThresholds {
  /** Credit score at or above this passes (when the background check is clear). */
  creditPassMin: number;
  /** Credit score at or above this, and below creditPassMin, goes to review. Below it: not in good standing. */
  creditReviewMin: number;
}
export const CANADA_THRESHOLDS: CheckThresholds = { creditPassMin: 600, creditReviewMin: 575 };

export interface CheckOutcomes {
  /** Equifax Canada score, or null while the check is still running. */
  creditScore: number | null;
  /** true = adverse finding in the background report; false = clear; null = still running. */
  backgroundAdverse: boolean | null;
  /** Any undischarged bankruptcy, consumer proposal, creditor arrangement or unsatisfied judgment, whatever the score. Undefined until the questionnaire is wired in. */
  insolvencyOrJudgment?: boolean | null;
  /** Any screening question answered yes: debt to an insurer or agency, licence refusal or conditions, termination for cause, complaints or discipline. Undefined until the questionnaire is wired in. */
  redFlag?: boolean | null;
}

/**
 * Suggested outcome from the check results. 'pending' while a result is missing. Any of these goes to review, whatever the score:
 * an adverse background report, an insolvency or judgment, or a red-flag answer. A credit score alone never passes a broker.
 */
export function suggestedStanding(c: CheckOutcomes, t: CheckThresholds = CANADA_THRESHOLDS): StandingOutcome | 'pending' {
  if (c.backgroundAdverse === true || c.insolvencyOrJudgment === true || c.redFlag === true) return 'needs_review';
  if (c.backgroundAdverse === null || c.creditScore === null || c.insolvencyOrJudgment === null || c.redFlag === null) return 'pending';
  if (c.creditScore >= t.creditPassMin) return 'good_standing';
  if (c.creditScore >= t.creditReviewMin) return 'needs_review';
  return 'not_in_good_standing';
}

/** Access is never removed by the standing decision. A partner not in good standing keeps access, shown with a warning (decided by the Compliance officer). */
export function keepsAccessWhile(_outcome: StandingOutcome | 'pending'): boolean {
  return true;
}

/** True when the partner should be warned that the file needs attention (not in good standing). */
export function standingWarning(outcome: StandingOutcome | 'pending'): boolean {
  return outcome === 'not_in_good_standing';
}

export const RECHECK_MONTHS = 6;
export const RECHECK_WARNING_DAYS = 30;

export function nextCheckDue(lastChecked: Date, months = RECHECK_MONTHS): Date {
  const d = new Date(lastChecked.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

export type RecheckStatus = 'current' | 'due_soon' | 'overdue';
export function recheckStatus(lastChecked: Date, now: Date): RecheckStatus {
  const due = nextCheckDue(lastChecked).getTime();
  if (now.getTime() >= due) return 'overdue';
  if (due - now.getTime() <= RECHECK_WARNING_DAYS * 86_400_000) return 'due_soon';
  return 'current';
}

export const ONBOARDING_STAGES = [
  'invited', 'form_submitted', 'consents_recorded', 'checks_requested', 'checks_complete',
  'standing_decided', 'agency_agreement_sent', 'agency_agreement_signed', 'active',
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export type StepStatus = 'done' | 'current' | 'pending';
/**
 * Every onboarding step in order, with whether it is done, current or still to do. This is all a Branch manager sees of a broker's
 * onboarding: the step name and its status. The last step is done once the case is active.
 */
export function progressSteps(stage: OnboardingStage): { step: OnboardingStage; status: StepStatus }[] {
  const at = ONBOARDING_STAGES.indexOf(stage);
  return ONBOARDING_STAGES.map((step, i) => {
    const status: StepStatus = i < at || (stage === 'active' && i === at) ? 'done' : i === at ? 'current' : 'pending';
    return { step, status };
  });
}

/** Stages move forward one at a time. Returns the reason a move is refused, or null when it is allowed. */
export function stageMoveBlock(from: OnboardingStage, to: OnboardingStage, standing: StandingOutcome | 'pending'): string | null {
  const i = ONBOARDING_STAGES.indexOf(from); const j = ONBOARDING_STAGES.indexOf(to);
  if (j !== i + 1) return 'only_next_stage';
  if (to === 'agency_agreement_sent' && standing !== 'good_standing') return 'standing_not_good';
  return null;
}

export const CARRIER_PACKET_BLOCKS = ['agency_agreement_not_signed', 'not_active', 'standing_not_good', 'check_overdue', 'licence_or_eo_expired'] as const;
export type CarrierPacketBlock = (typeof CARRIER_PACKET_BLOCKS)[number];

/** Gate for stage 2: a carrier packet can be sent only after the PII agency agreement, with a current good-standing decision. */
export function carrierPacketBlocks(p: {
  agencyAgreementSigned: boolean; stage: OnboardingStage; standing: StandingOutcome | 'pending';
  lastChecked: Date | null; now: Date;
  /** A licence or E&O policy has expired: submissions are frozen until it is renewed (plan v6, section 2). */
  frozenForExpiry?: boolean;
}): CarrierPacketBlock[] {
  const b: CarrierPacketBlock[] = [];
  if (p.frozenForExpiry) b.push('licence_or_eo_expired');
  if (!p.agencyAgreementSigned) b.push('agency_agreement_not_signed');
  if (p.stage !== 'active') b.push('not_active');
  if (p.standing !== 'good_standing') b.push('standing_not_good');
  if (!p.lastChecked || recheckStatus(p.lastChecked, p.now) === 'overdue') b.push('check_overdue');
  return b;
}

/**
 * Onboarding requirements a Compliance Manager can switch on or off for the company. All are on by default. A switch-off is
 * recorded with a reason. screeningBeforeDecision is enforced now; the others are enforced as their steps are built.
 */
export const REQUIREMENT_KEYS = ['screeningBeforeDecision', 'ownershipRequired', 'pendingApproval', 'presidentExceptions'] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];
export const REQUIREMENT_COLUMN: Record<RequirementKey, string> = {
  screeningBeforeDecision: 'screening_before_decision',
  ownershipRequired: 'ownership_required',
  pendingApproval: 'pending_approval',
  presidentExceptions: 'president_exceptions',
};
export const REQUIREMENT_DEFAULTS: Record<RequirementKey, boolean> = {
  screeningBeforeDecision: true, ownershipRequired: true, pendingApproval: true, presidentExceptions: true,
};

/** Broker type, set by the Compliance officer before the decision. */
export const BROKER_TYPES = ['individual', 'corporate'] as const;
export type BrokerType = (typeof BROKER_TYPES)[number];

export interface OwnerRecord {
  isDirector: boolean;
  /** Share of the corporate broker, 0 to 100. */
  sharePercent: number;
  /** Identity verified. Required for directors and holders of 25% or more. */
  identified: boolean;
  /** PEP and HIO determination recorded for this person. */
  pepHioDetermined: boolean;
  /** Personal guarantee signed. Required for holders of 10% or more. */
  guaranteeSigned: boolean;
}

export const OWNERSHIP_GUARANTEE_MIN = 10;
export const OWNERSHIP_IDENTITY_MIN = 25;
export const OWNERSHIP_PROBLEMS = ['type_missing', 'directors_missing', 'identity_missing', 'guarantee_missing', 'pep_hio_missing', 'steps_missing'] as const;
export type OwnershipProblem = (typeof OWNERSHIP_PROBLEMS)[number];

/**
 * What is still missing from a broker's ownership file (onboarding plan, section 7). An individual broker needs no tiers.
 * A corporate broker needs a director, identity for directors and holders of 25% or more, a guarantee from holders of 10% or
 * more, a PEP and HIO determination for everyone, and the recorded steps when nobody holds 25% or more.
 */
export function ownershipProblems(type: BrokerType | null, owners: OwnerRecord[], stepsRecorded: boolean): OwnershipProblem[] {
  if (type === null) return ['type_missing'];
  if (type === 'individual') return [];
  const out = new Set<OwnershipProblem>();
  if (!owners.some((o) => o.isDirector)) out.add('directors_missing');
  if (owners.some((o) => (o.isDirector || o.sharePercent >= OWNERSHIP_IDENTITY_MIN) && !o.identified)) out.add('identity_missing');
  if (owners.some((o) => o.sharePercent >= OWNERSHIP_GUARANTEE_MIN && !o.guaranteeSigned)) out.add('guarantee_missing');
  if (owners.some((o) => !o.pepHioDetermined)) out.add('pep_hio_missing');
  if (!owners.some((o) => o.sharePercent >= OWNERSHIP_IDENTITY_MIN) && !stepsRecorded) out.add('steps_missing');
  return [...out];
}
