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
}

/** Suggested outcome from the check results. 'pending' while a result is missing. An adverse background report always goes to review. */
export function suggestedStanding(c: CheckOutcomes, t: CheckThresholds = CANADA_THRESHOLDS): StandingOutcome | 'pending' {
  if (c.backgroundAdverse === true) return 'needs_review';
  if (c.backgroundAdverse === null || c.creditScore === null) return 'pending';
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

/** Stages move forward one at a time. Returns the reason a move is refused, or null when it is allowed. */
export function stageMoveBlock(from: OnboardingStage, to: OnboardingStage, standing: StandingOutcome | 'pending'): string | null {
  const i = ONBOARDING_STAGES.indexOf(from); const j = ONBOARDING_STAGES.indexOf(to);
  if (j !== i + 1) return 'only_next_stage';
  if (to === 'agency_agreement_sent' && standing !== 'good_standing') return 'standing_not_good';
  return null;
}

export const CARRIER_PACKET_BLOCKS = ['agency_agreement_not_signed', 'not_active', 'standing_not_good', 'check_overdue'] as const;
export type CarrierPacketBlock = (typeof CARRIER_PACKET_BLOCKS)[number];

/** Gate for stage 2: a carrier packet can be sent only after the PII agency agreement, with a current good-standing decision. */
export function carrierPacketBlocks(p: {
  agencyAgreementSigned: boolean; stage: OnboardingStage; standing: StandingOutcome | 'pending';
  lastChecked: Date | null; now: Date;
}): CarrierPacketBlock[] {
  const b: CarrierPacketBlock[] = [];
  if (!p.agencyAgreementSigned) b.push('agency_agreement_not_signed');
  if (p.stage !== 'active') b.push('not_active');
  if (p.standing !== 'good_standing') b.push('standing_not_good');
  if (!p.lastChecked || recheckStatus(p.lastChecked, p.now) === 'overdue') b.push('check_overdue');
  return b;
}
