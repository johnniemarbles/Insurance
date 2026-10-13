// Shared pieces of partner onboarding: the stages in order, their labels, and the progress display used by the compliance dashboard and the partner's own view.
import type { Locale } from './types.ts';

export const STAGES = ['invited', 'form_submitted', 'consents_recorded', 'checks_requested', 'checks_complete', 'standing_decided', 'agency_agreement_sent', 'agency_agreement_signed', 'active'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, Record<Locale, string>> = {
  invited: { en: 'Invited', 'fr-CA': 'Invité' },
  form_submitted: { en: 'Profile submitted', 'fr-CA': 'Profil soumis' },
  consents_recorded: { en: 'Consent given', 'fr-CA': 'Consentement donné' },
  checks_requested: { en: 'Checks running', 'fr-CA': 'Vérifications en cours' },
  checks_complete: { en: 'Checks complete', 'fr-CA': 'Vérifications terminées' },
  standing_decided: { en: 'Standing decided', 'fr-CA': 'Réputation décidée' },
  agency_agreement_sent: { en: 'Agreement sent', 'fr-CA': 'Entente envoyée' },
  agency_agreement_signed: { en: 'Agreement signed', 'fr-CA': 'Entente signée' },
  active: { en: 'Active', 'fr-CA': 'Actif' },
};

export const OUTCOME_LABEL: Record<string, Record<Locale, string>> = {
  good_standing: { en: 'Good standing', 'fr-CA': 'Bonne réputation' },
  needs_review: { en: 'Needs review', 'fr-CA': 'À examiner' },
  not_in_good_standing: { en: 'Not in good standing', 'fr-CA': 'Réputation non conforme' },
};

/** Who has the next move: the partner, or the Compliance officer. */
export const WAITING_ON: Record<Stage, 'partner' | 'officer' | 'none'> = {
  invited: 'partner', form_submitted: 'partner', consents_recorded: 'officer', checks_requested: 'officer',
  checks_complete: 'officer', standing_decided: 'officer', agency_agreement_sent: 'partner', agency_agreement_signed: 'officer', active: 'none',
};

export const stageIndex = (s: string): number => STAGES.indexOf(s as Stage);

/** Stage progress as a whole percent, 0 at invitation and 100 once active. */
export const stagePercent = (s: string): number => Math.round((Math.max(0, stageIndex(s)) / (STAGES.length - 1)) * 100);

export const OB = {
  'en': { step: (n: number, of: number) => `Step ${n} of ${of}`, done: 'Done', now: 'Now', todo: 'To come', progress: 'Progress', waitPartner: 'Waiting on the partner', waitOfficer: 'Waiting on compliance', waitNone: 'Complete' },
  'fr-CA': { step: (n: number, of: number) => `Étape ${n} de ${of}`, done: 'Terminé', now: 'En cours', todo: 'À venir', progress: 'Progression', waitPartner: 'En attente du partenaire', waitOfficer: 'En attente de la conformité', waitNone: 'Terminé' },
} as const;

/** Segmented bar: one segment per stage, filled up to the current stage. */
export function ProgressBar({ stage, locale }: { stage: string; locale: Locale }) {
  const i = Math.max(0, stageIndex(stage));
  const x = OB[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  return (
    <span class="obprog" role="img" aria-label={`${x.progress}: ${x.step(i + 1, STAGES.length)}`}>
      {STAGES.map((s, k) => <i key={s} class={k < i || (stage === 'active' && k === i) ? 'done' : k === i ? 'cur' : ''} />)}
    </span>
  );
}

/** The full stage list with each step marked done, now or to come. */
export function StepList({ stage, locale }: { stage: string; locale: Locale }) {
  const i = stageIndex(stage);
  const x = OB[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  return (
    <ol class="obsteps">
      {STAGES.map((s, k) => {
        const state = k < i || stage === 'active' ? 'done' : k === i ? 'cur' : 'todo';
        return (
          <li key={s} class={state} aria-current={k === i ? 'step' : undefined}>
            <span class="obdot" aria-hidden="true">{state === 'done' ? '✓' : k + 1}</span>
            <span><b>{STAGE_LABEL[s][locale === 'fr-CA' ? 'fr-CA' : 'en']}</b><small>{state === 'done' ? x.done : state === 'cur' ? x.now : x.todo}</small></span>
          </li>
        );
      })}
    </ol>
  );
}
