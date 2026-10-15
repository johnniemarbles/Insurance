// Partner onboarding for the Compliance officer, as a section of the Compliance page: a board of every partner's progress, invitations,
// and a file per partner to record the checks, decide the standing and move the agency agreement.
// The partner's own view is in onboarding-partner.tsx. Results and reasons are shown here only; the API never returns them to partners.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Locale } from './types.ts';
import { OB, ProgressBar, STAGE_LABEL, StepList, WAITING_ON, stagePercent, type Stage } from './onboarding-shared.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const OUTCOMES = ['good_standing', 'needs_review', 'not_in_good_standing'] as const;

const T = {
  en: {
    title: 'Partner onboarding', sub: 'Invite a partner, run the Equifax credit and Sterling background checks, decide good standing, then send the agency agreement. The partner sees only the outcome.',
    partner: 'Partner', country: 'Country', inviteBtn: 'Send invitation', invLabel: { created: 'Invite created', sent: 'Invite sent', opened: 'Link opened', accepted: 'Login created', overdue: 'Invite overdue: no reply after 72 hours', not_sent: 'Email not sent' } as Record<string, string>, extOn: 'Extension installed', extOff: 'Extension not installed yet', resendHead: 'Send a new invitation', resendBtn: 'Send new invitation', resendNote: 'The earlier link stops working. The partner gets one email with the login link and the install step.', adminEmail: 'Email of the partner’s administrator', adminHint: 'They get one email to create their PII login and install the Gmail extension.', invitedSent: (e: string) => `Invited. The invitation was emailed to ${e}. The link works once and expires in 7 days.`, invitedNotSent: (e: string, why: string) => `Invited, but the email to ${e} was not sent: ${why}. Fix the cause and invite again.`, cancel: 'Cancel',
    cases: 'Partners in onboarding', none: 'Nobody is in onboarding yet. Invite a partner to start.', name: 'Partner', stage: 'Progress', standing: 'Standing', recheck: 'Next check', open: 'Open',
    back: 'All partners in onboarding', dash: '—', standingPending: 'Standing pending',
    tiles: { total: 'In onboarding', action: 'Waiting on compliance', partner: 'Waiting on the partner', active: 'Active', due: 'Checks due in 30 days', notGood: 'Not in good standing' },
    tileHint: { action: 'Record checks or decide', partner: 'Profile, consent or signature', due: 'Recheck soon or overdue' } as Record<string, string>,
    filters: { all: 'All', action: 'Waiting on compliance', partner: 'Waiting on partner', active: 'Active' },
    filterNone: 'Nothing in this view.',
    nextHead: 'Next step', overdue: 'overdue', soon: 'due soon',
    next: {
      invited: 'The partner has been invited and has not submitted the profile yet.',
      form_submitted: 'The partner must give consent to the credit and background checks.',
      consents_recorded: 'Consent is in. Record the Equifax and Sterling results as they arrive.',
      checks_requested: 'Checks are running. Record each result as it comes in.',
      checks_complete: 'Every check is in. Record the good-standing decision.',
      standing_decided_good: 'Standing is good. Send the agency agreement.',
      standing_decided_other: 'The agency agreement is sent only for good standing, so it cannot go out for this decision.',
      agency_agreement_sent: 'The agreement is with the partner, who signs through the link emailed to them.',
      agency_agreement_signed: 'The agreement is signed. Activate the partner.',
      active: 'The partner is active. Carrier packets are sent from the partner’s page.',
    } as Record<string, string>,
    sections: { consents: 'Consents given', checks: 'Checks', decision: 'Good-standing decision', agreement: 'Agency agreement', packets: 'Carrier packets', signed: 'Signed agreements', decisions: 'Decisions on file' },
    noConsent: 'No consent recorded yet.', noChecks: 'No checks yet.', noPackets: 'None yet.', noSigned: 'None signed yet.',
    kind: { credit: 'Credit (Equifax)', background: 'Background (Sterling)', licence: 'Licence' } as Record<string, string>,
    status: { requested: 'Requested', complete: 'Complete', failed: 'Failed' } as Record<string, string>,
    checkCol: 'Check', checkL: 'Check', statusL: 'Status',
    provider: 'Provider', score: 'Credit score', adverse: 'Background report', clear: 'Clear', adverseYes: 'Adverse finding',
    record: 'Record check', suggested: 'Rule suggests', pending: 'Waiting for a check result', decisionLocked: 'The decision opens once every check is complete.',
    outcome: 'Decision', reason: 'Reason (kept in the file, never shown to the partner)', decide: 'Record decision',
    screen: { head: 'Screening questions', hint: 'Answer yes or no for each question. Any yes sends the file to review, whatever the credit score. Only the compliance officer sees the answers.', insolv: 'Any undischarged bankruptcy, consumer proposal, creditor arrangement or unsatisfied judgment?', debt: 'Any current debt to an insurer, agency or financial institution?', licence: 'Any licence refusal, suspension or conditions?', term: 'Any termination for cause or market-conduct allegations?', sponsor: 'Any sponsorship change in the last 5 years?', complaints: 'Any complaints or disciplinary history (CISRO or APEXA)?', record: 'Record screening', recorded: 'Recorded', none: 'Not recorded yet.', firstHead: 'Record the screening questions first. The decision waits for them.', yes: 'Yes', no: 'No', redFlag: 'Red flag', insolvency: 'Insolvency or judgment' },
    reqs: { head: 'Onboarding requirements', hint: 'Compliance Managers can switch each requirement on or off for the company. Every change needs a reason and is kept on record.', only: 'Only a Compliance Manager can change these.', on: 'On', off: 'Off', change: 'Change', reason: 'Reason (kept with the change)', save: 'Save change', cancel: 'Cancel', history: 'Changes on record', none: 'No changes yet.', pending: 'Not yet enforced: stored now, enforced when its step is built.', items: { screeningBeforeDecision: 'Screening questions before a decision', ownershipRequired: 'Ownership tiers for a corporate broker', pendingApproval: 'Pending Compliance Approval before a broker is decided', presidentExceptions: 'President and CEO approval for red-flag exceptions' } as Record<string, string>, shortReason: 'Give a reason of at least 10 characters.' },
    exc: { head: 'President and CEO exception', why: 'This file has a red flag, a judgment, an insolvency or an adverse background report. It can be decided as good standing only with the President and CEO’s approval.', reason: 'Reason for the exception (kept on the file)', approve: 'Approve exception', waiting: 'Waiting for the President and CEO’s approval.', none: 'No exception approved yet.', approved: 'Approved by', pendingChip: 'Pending compliance approval', pendingNote: 'Only a Compliance Manager records the decision while this applies.' },
    own: { head: 'Broker type and ownership', type: 'Broker type', individual: 'Individual', corporate: 'Corporation', saveType: 'Save type', typeNone: 'Not recorded yet.', owners: 'Directors and owners', name: 'Name', director: 'Director', share: 'Share %', identified: 'Identified', pep: 'PEP and HIO checked', guarantee: 'Guarantee signed', remove: 'Remove', add: 'Add person', none: 'No one added yet.', complete: 'The ownership file is complete.', stepsHead: 'Steps taken (nobody holds 25% or more)', stepsHint: 'Describe how the holders were established. At least 10 characters.', stepsSave: 'Save steps', ownerRequired: 'Needed before the decision while the requirement is on.', missing: { type_missing: 'Record the broker type', directors_missing: 'Add at least one director', identity_missing: 'Identify each director and each holder of 25% or more', guarantee_missing: 'Signed guarantee for each holder of 10% or more', pep_hio_missing: 'PEP and HIO checked for each person', steps_missing: 'Record the steps taken' } as Record<string, string>, locked: 'Only the Compliance Manager can change the ownership file.' },
    agTitle: 'Agreement title', agVersion: 'Version', agText: 'Agreement text (as issued by counsel)', agSend: 'Send agency agreement to the partner',
    agResend: 'Send the agreement again', agWaiting: 'Waiting for the partner to sign. The link was emailed to the partner’s people.', agSentOk: 'Agreement sent.', agHint: 'The partner signs through a private link with a code sent to their email.',
    agSignedOn: 'Signed', agPdf: 'Sealed PDF', activate: 'Activate partner',
    outcomeL: { good_standing: 'Good standing', needs_review: 'Needs review', not_in_good_standing: 'Not in good standing' } as Record<string, string>,
    credit: (pass: number, review: number) => `Credit ${pass} or more passes. ${review} to ${pass - 1} needs review. Below ${review} is not in good standing.`,
  },
  'fr-CA': {
    title: 'Intégration des partenaires', sub: 'Invitez un partenaire, faites les vérifications de crédit Equifax et d’antécédents Sterling, décidez de la bonne réputation, puis envoyez l’entente d’agence. Le partenaire ne voit que le résultat.',
    partner: 'Partenaire', country: 'Pays', inviteBtn: 'Envoyer l’invitation', invLabel: { created: 'Invitation créée', sent: 'Invitation envoyée', opened: 'Lien ouvert', accepted: 'Connexion créée', overdue: 'Invitation en retard : aucune réponse après 72 heures', not_sent: 'Courriel non envoyé' } as Record<string, string>, extOn: 'Extension installée', extOff: 'Extension pas encore installée', resendHead: 'Envoyer une nouvelle invitation', resendBtn: 'Envoyer une nouvelle invitation', resendNote: 'L’ancien lien ne fonctionne plus. Le partenaire reçoit un seul courriel avec le lien de connexion et l’étape d’installation.', adminEmail: 'Courriel de l’administrateur du partenaire', adminHint: 'Il reçoit un seul courriel pour créer sa connexion PII et installer l’extension Gmail.', invitedSent: (e: string) => `Invité. L’invitation a été envoyée par courriel à ${e}. Le lien ne fonctionne qu’une fois et expire dans 7 jours.`, invitedNotSent: (e: string, why: string) => `Invité, mais le courriel à ${e} n’a pas été envoyé : ${why}. Corrigez la cause et invitez à nouveau.`, cancel: 'Annuler',
    cases: 'Partenaires en intégration', none: 'Personne n’est en intégration pour l’instant. Invitez un partenaire pour commencer.', name: 'Partenaire', stage: 'Progression', standing: 'Réputation', recheck: 'Prochaine vérification', open: 'Ouvrir',
    back: 'Tous les partenaires en intégration', dash: '—', standingPending: 'Réputation en attente',
    tiles: { total: 'En intégration', action: 'En attente de la conformité', partner: 'En attente du partenaire', active: 'Actifs', due: 'Vérifications dans 30 jours', notGood: 'Réputation non conforme' },
    tileHint: { action: 'Enregistrer des vérifications ou décider', partner: 'Profil, consentement ou signature', due: 'Recontrôle bientôt ou en retard' } as Record<string, string>,
    filters: { all: 'Tous', action: 'En attente de la conformité', partner: 'En attente du partenaire', active: 'Actifs' },
    filterNone: 'Rien dans cette vue.',
    nextHead: 'Prochaine étape', overdue: 'en retard', soon: 'bientôt due',
    next: {
      invited: 'Le partenaire a été invité et n’a pas encore soumis son profil.',
      form_submitted: 'Le partenaire doit consentir aux vérifications de crédit et d’antécédents.',
      consents_recorded: 'Le consentement est reçu. Enregistrez les résultats Equifax et Sterling à leur arrivée.',
      checks_requested: 'Les vérifications sont en cours. Enregistrez chaque résultat à son arrivée.',
      checks_complete: 'Toutes les vérifications sont reçues. Enregistrez la décision de bonne réputation.',
      standing_decided_good: 'La réputation est bonne. Envoyez l’entente d’agence.',
      standing_decided_other: 'L’entente d’agence n’est envoyée qu’en cas de bonne réputation; elle ne peut donc pas partir pour cette décision.',
      agency_agreement_sent: 'L’entente est chez le partenaire, qui la signe par le lien envoyé par courriel.',
      agency_agreement_signed: 'L’entente est signée. Activez le partenaire.',
      active: 'Le partenaire est actif. Les dossiers auprès des assureurs s’envoient depuis sa page.',
    } as Record<string, string>,
    sections: { consents: 'Consentements donnés', checks: 'Vérifications', decision: 'Décision de bonne réputation', agreement: 'Entente d’agence', packets: 'Dossiers auprès des assureurs', signed: 'Ententes signées', decisions: 'Décisions au dossier' },
    noConsent: 'Aucun consentement enregistré pour l’instant.', noChecks: 'Aucune vérification pour l’instant.', noPackets: 'Aucun pour l’instant.', noSigned: 'Aucune entente signée pour l’instant.',
    kind: { credit: 'Crédit (Equifax)', background: 'Antécédents (Sterling)', licence: 'Permis' } as Record<string, string>,
    status: { requested: 'Demandée', complete: 'Terminée', failed: 'Échouée' } as Record<string, string>,
    checkCol: 'Vérification', checkL: 'Vérification', statusL: 'Statut',
    provider: 'Fournisseur', score: 'Pointage de crédit', adverse: 'Rapport d’antécédents', clear: 'Sans constat', adverseYes: 'Constat défavorable',
    record: 'Enregistrer la vérification', suggested: 'La règle suggère', pending: 'En attente d’un résultat de vérification', decisionLocked: 'La décision s’ouvre quand toutes les vérifications sont terminées.',
    outcome: 'Décision', reason: 'Motif (conservé au dossier, jamais montré au partenaire)', decide: 'Enregistrer la décision',
    screen: { head: 'Questions de filtrage', hint: 'Répondez oui ou non à chaque question. Un oui envoie le dossier en examen, quel que soit le pointage de crédit. Seul l’agent de conformité voit les réponses.', insolv: 'Faillite non libérée, proposition de consommateur, entente avec les créanciers ou jugement non acquitté?', debt: 'Dette actuelle envers un assureur, un organisme ou une institution financière?', licence: 'Refus, suspension ou conditions de permis?', term: 'Résiliation pour motif ou allégations de conduite sur le marché?', sponsor: 'Changement de parrainage au cours des 5 dernières années?', complaints: 'Plaintes ou antécédents disciplinaires (CISRO ou APEXA)?', record: 'Enregistrer le filtrage', recorded: 'Enregistré', none: 'Pas encore enregistré.', firstHead: 'Enregistrez d’abord les questions de filtrage. La décision attend ces réponses.', yes: 'Oui', no: 'Non', redFlag: 'Signal d’alerte', insolvency: 'Insolvabilité ou jugement' },
    reqs: { head: 'Exigences d’intégration', hint: 'Les gestionnaires de conformité peuvent activer ou désactiver chaque exigence pour l’entreprise. Chaque changement exige un motif et est conservé au dossier.', only: 'Seul un gestionnaire de conformité peut modifier ces exigences.', on: 'Activé', off: 'Désactivé', change: 'Modifier', reason: 'Motif (conservé avec le changement)', save: 'Enregistrer le changement', cancel: 'Annuler', history: 'Changements consignés', none: 'Aucun changement pour l’instant.', pending: 'Pas encore appliquée : enregistrée maintenant, appliquée quand son étape sera construite.', items: { screeningBeforeDecision: 'Questions de filtrage avant une décision', ownershipRequired: 'Paliers de propriété pour un courtier constitué en société', pendingApproval: 'Approbation de conformité en attente avant la décision sur un courtier', presidentExceptions: 'Approbation du président et chef de la direction pour les exceptions à signal d’alerte' } as Record<string, string>, shortReason: 'Donnez un motif d’au moins 10 caractères.' },
    exc: { head: 'Exception du président et chef de la direction', why: 'Ce dossier comporte un signal d’alerte, un jugement, une insolvabilité ou un rapport défavorable. Il ne peut être décidé comme bonne réputation qu’avec l’approbation du président et chef de la direction.', reason: 'Motif de l’exception (conservé au dossier)', approve: 'Approuver l’exception', waiting: 'En attente de l’approbation du président et chef de la direction.', none: 'Aucune exception approuvée pour l’instant.', approved: 'Approuvée par', pendingChip: 'Approbation de conformité en attente', pendingNote: 'Seul un gestionnaire de conformité enregistre la décision tant que ceci s’applique.' },
    own: { head: 'Type de courtier et propriété', type: 'Type de courtier', individual: 'Particulier', corporate: 'Société', saveType: 'Enregistrer le type', typeNone: 'Pas encore enregistré.', owners: 'Administrateurs et propriétaires', name: 'Nom', director: 'Administrateur', share: 'Part %', identified: 'Identifié', pep: 'PPE et OIR vérifiés', guarantee: 'Garantie signée', remove: 'Retirer', add: 'Ajouter une personne', none: 'Personne ajoutée pour l’instant.', complete: 'Le dossier de propriété est complet.', stepsHead: 'Démarches effectuées (personne ne détient 25 % ou plus)', stepsHint: 'Décrivez comment les détenteurs ont été établis. Au moins 10 caractères.', stepsSave: 'Enregistrer les démarches', ownerRequired: 'Requis avant la décision tant que l’exigence est active.', missing: { type_missing: 'Indiquer le type de courtier', directors_missing: 'Ajouter au moins un administrateur', identity_missing: 'Identifier chaque administrateur et chaque détenteur de 25 % ou plus', guarantee_missing: 'Garantie signée pour chaque détenteur de 10 % ou plus', pep_hio_missing: 'PPE et OIR vérifiés pour chaque personne', steps_missing: 'Consigner les démarches effectuées' } as Record<string, string>, locked: 'Seul le gestionnaire de conformité peut modifier le dossier de propriété.' },
    agTitle: 'Titre de l’entente', agVersion: 'Version', agText: 'Texte de l’entente (tel que publié par les conseillers juridiques)', agSend: 'Envoyer l’entente d’agence au partenaire',
    agResend: 'Renvoyer l’entente', agWaiting: 'En attente de la signature du partenaire. Le lien a été envoyé par courriel aux personnes du partenaire.', agSentOk: 'Entente envoyée.', agHint: 'Le partenaire signe par un lien privé avec un code envoyé à son courriel.',
    agSignedOn: 'Signée', agPdf: 'PDF scellé', activate: 'Activer le partenaire',
    outcomeL: { good_standing: 'Bonne réputation', needs_review: 'À examiner', not_in_good_standing: 'Réputation non conforme' } as Record<string, string>,
    credit: (pass: number, review: number) => `Crédit de ${pass} ou plus : réussi. De ${review} à ${pass - 1} : à examiner. Sous ${review} : non conforme.`,
  },
};

type Dict = (typeof T)['en'];
export interface InviteInfo { email: string; status: 'created' | 'sent' | 'opened' | 'accepted' | 'overdue' | 'not_sent'; reminders: number; error: string | null }
export interface CaseRow { id: string; nodeId: string; partnerName: string; country: string; stage: Stage; outcome: string | null; label: string; keepsAccess: boolean; recheck: { dueOn: string; status: string } | null; loginCreated?: boolean; extensionInstalled?: boolean; invite?: InviteInfo | null }
interface Detail extends CaseRow {
  suggested: string; thresholds: { creditPassMin: number; creditReviewMin: number };
  consents: { kind: string; accepted: boolean; createdAt: string }[];
  checks: { id: string; kind: string; provider: string; status: string; score: number | null; adverse: boolean | null; requestedAt: string }[];
  decisions: { suggested: string; outcome: string; reason: string; decidedAt: string }[];
  carrierPackets: { id: string; carrier: string; templateVersion: string; status: string; createdAt: string }[];
  screening?: { insolvencyOrJudgment: boolean; redFlag: boolean; recordedAt: string } | null;
  exceptions?: { reason: string; approverName: string; approvedAt: string }[];
  canApproveException?: boolean;
  awaitingApproval?: boolean;
  ownership?: { type: 'individual' | 'corporate' | null; owners: { id: string; fullName: string; isDirector: boolean; sharePercent: number; identified: boolean; pepHioDetermined: boolean; guaranteeSigned: boolean }[]; steps: string | null; problems: string[] };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateOf = (s: string) => s.slice(0, 10);
const dayMs = 86_400_000;
type Filter = 'all' | 'action' | 'partner' | 'active';
const matches = (f: Filter, stage: Stage) => (f === 'all' ? true : f === 'active' ? stage === 'active' : f === 'partner' ? WAITING_ON[stage] === 'partner' : WAITING_ON[stage] === 'officer');
const countryName = (c: string) => (c === 'CA' ? 'Canada' : c);

/** Page heading used by every compliance section: title and summary on the left, the section switch on the right. */
export function SectionHead({ title, sub, right }: { title: string; sub: string; right?: ComponentChildren }) {
  return (
    <header class="obhead">
      <div><h2>{title}</h2><p class="muted">{sub}</p></div>
      {right && <div class="obhead-right">{right}</div>}
    </header>
  );
}

type MPStrings = { title: string; sub: string; none: string; name: string; staffHead: string; staffNone: string; assign: string; pickStaff: string; remove: string; checksHead: string; complete: string; outstanding: string; recheckDue: string; staffNote: string; credit: string; background: string };
const MP: Record<'en' | 'fr-CA', MPStrings> = {
  en: { title: 'Partner onboarding progress', sub: 'The steps each partner in your branch has reached. Checks and decisions are kept by compliance.', none: 'No partner in your branch is in onboarding yet.', name: 'Partner', staffHead: 'Staff on this partner', staffNone: 'No staff assigned yet.', assign: 'Assign', pickStaff: 'Choose a staff member', remove: 'Remove', checksHead: 'Checks', complete: 'Complete', outstanding: 'Outstanding', recheckDue: 'Next check due', staffNote: 'Staff follow up with the partner and collect documents. Screening and decisions stay with compliance.', credit: 'Credit check', background: 'Background check' },
  'fr-CA': { title: 'Progression de l’intégration des partenaires', sub: 'Les étapes atteintes par chaque partenaire de votre succursale. Les vérifications et décisions sont gérées par la conformité.', none: 'Aucun partenaire de votre succursale n’est en intégration pour l’instant.', name: 'Partenaire', staffHead: 'Personnel assigné à ce partenaire', staffNone: 'Aucun membre du personnel assigné pour l’instant.', assign: 'Assigner', pickStaff: 'Choisir un membre du personnel', remove: 'Retirer', checksHead: 'Vérifications', complete: 'Complète', outstanding: 'En attente', recheckDue: 'Prochaine vérification', staffNote: 'Le personnel fait le suivi auprès du partenaire et recueille les documents. La vérification et les décisions restent à la conformité.', credit: 'Vérification de crédit', background: 'Vérification d’antécédents' },
} as const;

type BoardStaff = { userId: string; name: string };
type BoardRow = {
  id: string; partnerName: string;
  steps?: { step: Stage; status: 'done' | 'current' | 'pending' }[];
  // Branch manager rows: who is assigned and who can still be assigned. Staff rows carry the checks and the due date instead.
  staff?: BoardStaff[]; candidates?: BoardStaff[];
  checks?: { kind: string; complete: boolean }[]; recheck?: { dueOn: string } | null;
};

/**
 * Partner onboarding for branch management and for assigned staff (plan v7, sections 6 and 7). A branch manager sees each partner's
 * steps and assigns or removes staff. Staff see the same steps with the checks complete or outstanding and the next due date:
 * never a score, a provider, the screening answers or the standing.
 */
export function ManagerProgressBoard({ call, locale }: { call: Call; locale: Locale }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [err, setErr] = useState('');
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const m = MP[lc];
  const x = OB[lc];
  const load = () => call('GET', '/v1/onboarding/cases').then((r) => setRows(r.cases ?? []), () => setRows([]));
  useEffect(() => { void load(); }, [call]);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(errText(e)); } };
  const shown = (rows ?? []).filter((r) => Array.isArray(r.steps));
  return (
    <section class="obmanager" aria-label={m.title}>
      <SectionHead title={m.title} sub={m.sub} />
      {err && <div class="err" role="alert">{err}</div>}
      {rows === null && <div class="msg">…</div>}
      {rows !== null && shown.length === 0 && <div class="calm">{m.none}</div>}
      {shown.map((r) => <BoardCard key={r.id} r={r} m={m} x={x} lc={lc} act={act} call={call} />)}
    </section>
  );
}

function BoardCard({ r, m, x, lc, act, call }: { r: BoardRow; m: MPStrings; x: { done: string; now: string; todo: string }; lc: 'en' | 'fr-CA'; act: (fn: () => Promise<unknown>) => Promise<void>; call: Call }) {
  const [pick, setPick] = useState('');
  return (
    <div class="obmanager-row" key={r.id}>
      <b>{r.partnerName}</b>
      <ol class="obtrack" aria-label={`${m.name}: ${r.partnerName}`}>
        {r.steps!.map((s, k) => (
          <li key={s.step} class={s.status} aria-current={s.status === 'current' ? 'step' : undefined}>
            <span class="obdot" aria-hidden="true">{s.status === 'done' ? '✓' : k + 1}</span>
            <span class="oblabel"><b>{STAGE_LABEL[s.step][lc]}</b><small>{s.status === 'done' ? x.done : s.status === 'current' ? x.now : x.todo}</small></span>
          </li>
        ))}
      </ol>
      {r.checks && (
        <div class="obstaffview">
          <b>{m.checksHead}</b>
          <ul>{r.checks.map((c, k) => <li key={k}>{c.kind === 'credit' ? m.credit : c.kind === 'background' ? m.background : c.kind} · {c.complete ? m.complete : m.outstanding}</li>)}</ul>
          {r.recheck && <small class="muted">{m.recheckDue}: {r.recheck.dueOn}</small>}
          <p class="muted">{m.staffNote}</p>
        </div>
      )}
      {r.candidates && (
        <div class="obstaffview">
          <b>{m.staffHead}</b>
          {(r.staff ?? []).length === 0 && <p class="muted">{m.staffNone}</p>}
          <ul>
            {(r.staff ?? []).map((s) => (
              <li key={s.userId}>{s.name} <button class="link" onClick={() => void act(() => call('DELETE', `/v1/onboarding/cases/${r.id}/staff/${s.userId}`))}>{m.remove}</button></li>
            ))}
          </ul>
          {r.candidates.length > 0 && (
            <form class="obform" onSubmit={(e) => { e.preventDefault(); if (pick) void act(() => call('POST', `/v1/onboarding/cases/${r.id}/staff`, { userId: pick })).then(() => setPick('')); }}>
              <label class="fl">{m.pickStaff}
                <select value={pick} onChange={(e) => setPick((e.target as HTMLSelectElement).value)}>
                  <option value="">{m.pickStaff}</option>
                  {r.candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
                </select>
              </label>
              <button class="primary" disabled={!pick}>{m.assign}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** The company's onboarding requirements. A Compliance Manager switches each on or off, with a reason; the history is shown to everyone. */
export interface Requirements {
  requirements: Record<string, boolean>;
  canChange: boolean;
  history: { requirement: string; from: boolean; to: boolean; reason: string; changedBy: string; at: string }[];
}
export function RequirementsPanel({ call, t, locale: _locale, onChange }: { call: Call; t: Dict; locale: Locale; onChange?: (r: Requirements) => void }) {
  const [data, setData] = useState<Requirements | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = (await call('GET', '/v1/onboarding/requirements')) as Requirements; setData(r); onChange?.(r); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (key: string, value: boolean) => {
    if (reason.trim().length < 10) { setError(t.reqs.shortReason); return; }
    setBusy(true); setError('');
    try {
      await call('PUT', '/v1/onboarding/requirements', { requirement: key, value, reason: reason.trim() });
      setOpen(null); setReason(''); await load();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  if (!data) return error ? <div class="err" role="alert">{error}</div> : null;
  return (
    <section class="obcard">
      <h3>{t.reqs.head}</h3>
      <p class="muted">{t.reqs.hint}</p>
      {!data.canChange && <p class="muted">{t.reqs.only}</p>}
      {error && <div class="err" role="alert">{error}</div>}
      <ul class="oblist">
        {REQ_KEYS.map((k) => {
          const on = data.requirements[k] !== false;
          return (
            <li key={k}>
              <span>{t.reqs.items[k]}{!REQ_ENFORCED.includes(k) && <small class="muted"> · {t.reqs.pending}</small>}</span>
              <span class="row">
                <span class={on ? 'chip ok' : 'chip warn'}>{on ? t.reqs.on : t.reqs.off}</span>
                {data.canChange && open !== k && <button class="btn quiet" onClick={() => { setOpen(k); setReason(''); setError(''); }}>{t.reqs.change}</button>}
              </span>
              {data.canChange && open === k && (
                <form class="obform obspan2" onSubmit={(e) => { e.preventDefault(); void save(k, !on); }}>
                  <label class="fl obspan2">{t.reqs.reason}
                    <textarea rows={2} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
                  </label>
                  <button class="btn" type="submit" disabled={busy}>{t.reqs.save}: {on ? t.reqs.off : t.reqs.on}</button>
                  <button class="btn quiet" type="button" onClick={() => setOpen(null)}>{t.reqs.cancel}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <h4>{t.reqs.history}</h4>
      {data.history.length === 0 ? <p class="muted">{t.reqs.none}</p> : (
        <ul class="oblist">
          {data.history.map((h) => (
            <li>{dateOf(h.at)} · {t.reqs.items[h.requirement]}: {h.to ? t.reqs.on : t.reqs.off}<span class="muted">{h.changedBy} · {h.reason}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
const REQ_KEYS = ['screeningBeforeDecision', 'ownershipRequired', 'pendingApproval', 'presidentExceptions'] as const;
/** Requirements the server enforces today. The rest are stored and will be enforced when their step is built. */
const REQ_ENFORCED: string[] = ['screeningBeforeDecision', 'ownershipRequired', 'pendingApproval', 'presidentExceptions'];

/** The Compliance officer's queue and decision view: totals, a progress table for every broker, and the file for one broker. Brokers are added from the Structure page (Add broker). */
export function OnboardingDashboard({ call, locale, tabs }: { call: Call; locale: Locale; tabs?: ComponentChildren }) {
  const t: Dict = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    try {
      const r = await call('GET', '/v1/onboarding/cases');
      setCases(r.cases as CaseRow[]);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => { void load(); }, [call]);


  const tiles = useMemo(() => {
    const all = cases ?? [];
    const now = Date.now();
    return {
      total: all.filter((c) => c.stage !== 'active').length,
      action: all.filter((c) => WAITING_ON[c.stage] === 'officer').length,
      partner: all.filter((c) => WAITING_ON[c.stage] === 'partner').length,
      active: all.filter((c) => c.stage === 'active').length,
      due: all.filter((c) => c.stage === 'active' && c.recheck && new Date(c.recheck.dueOn).getTime() - now <= 30 * dayMs).length,
      notGood: all.filter((c) => c.outcome === 'not_in_good_standing').length,
    };
  }, [cases]);

  if (openId) return <CaseFile call={call} t={t} locale={locale} id={openId} onBack={() => { setOpenId(null); void load(); }} />;

  const shown = (cases ?? []).filter((c) => matches(filter, c.stage));
  const tile = (k: keyof Dict['tiles'], tone?: 'warn' | 'ok') => {
    const n = tiles[k as keyof typeof tiles];
    return (
      <div class={`obtile ${tone && n > 0 ? tone : ''}`}>
        <b>{n}</b>
        <span>{t.tiles[k]}</span>
        {t.tileHint[k] && <small>{t.tileHint[k]}</small>}
      </div>
    );
  };

  return (
    <div class="home obwrap">
      <SectionHead title={t.title} sub={t.sub} right={tabs} />
      {error && <div class="err" role="alert">{error}</div>}

      <div class="obtiles">
        {tile('total')}{tile('action', 'warn')}{tile('partner')}{tile('active', 'ok')}{tile('due', 'warn')}{tile('notGood', 'warn')}
      </div>

      <RequirementsPanel call={call} t={t} locale={locale} />

      <section class="obcard">
        <div class="obtool">
          <div class="seg" role="tablist" aria-label={t.cases}>
            {(['all', 'action', 'partner', 'active'] as Filter[]).map((f) => (
              <button role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{t.filters[f]}</button>
            ))}
          </div>
          <span class="spacer" />
        </div>

        {cases === null && <div class="msg">…</div>}
        {cases && cases.length === 0 && <div class="calm">{t.none}</div>}
        {cases && cases.length > 0 && shown.length === 0 && <div class="calm">{t.filterNone}</div>}
        {shown.length > 0 && (
          <div class="obtablewrap">
            <table class="obtable">
              <thead><tr><th>{t.name}</th><th>{t.stage}</th><th>{t.standing}</th><th>{t.recheck}</th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)}>
                    <td>
                      <button class="oblink" onClick={(e) => { e.stopPropagation(); setOpenId(c.id); }}>{c.partnerName}</button>
                      <small class="muted">{countryName(c.country)}</small>
                      {c.invite && <div><small class={c.invite.status === 'overdue' || c.invite.status === 'not_sent' ? 'warn' : 'muted'}>{t.invLabel[c.invite.status]}</small></div>}
                      {c.loginCreated && <div><small class="muted">{c.extensionInstalled ? t.extOn : t.extOff}</small></div>}
                    </td>
                    <td>
                      <div class="obstage">
                        <ProgressBar stage={c.stage} locale={locale} />
                        <span><b>{STAGE_LABEL[c.stage][lc]}</b> <small class="muted">{Math.round(stagePercent(c.stage))}%</small></span>
                      </div>
                    </td>
                    <td>
                      {c.outcome
                        ? <span class={`chip ${c.outcome === 'good_standing' ? 'ok' : 'warn'}`}>{t.outcomeL[c.outcome]}</span>
                        : <small class="muted">{t.standingPending}</small>}
                    </td>
                    <td>
                      {c.recheck
                        ? <span class={`chip ${c.recheck.status === 'overdue' ? 'warn' : c.recheck.status === 'due_soon' ? '' : 'ok'}`}>{dateOf(c.recheck.dueOn)}{c.recheck.status === 'overdue' ? ` · ${t.overdue}` : c.recheck.status === 'due_soon' ? ` · ${t.soon}` : ''}</span>
                        : <small class="muted">{t.dash}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Send the partner's administrator a fresh invitation (the earlier link stops working). Shown until the partner has a login. */
function ResendInvite({ call, t, nodeId, defaultEmail, onSent }: { call: Call; t: Dict; nodeId: string; defaultEmail: string; onSent: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await call('POST', '/v1/onboarding/cases', { nodeId, adminEmail: email.trim() });
      const inv = r.invitation;
      setMsg(inv?.status === 'sent' ? { ok: true, text: t.invitedSent(inv.email) } : { ok: false, text: t.invitedNotSent(inv?.email ?? email.trim(), inv?.error ?? 'the mail service did not accept it') });
      onSent();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  return (
    <div class="obinvite" role="group" aria-label={t.resendHead}>
      <b>{t.resendHead}</b>
      <label class="fl">{t.adminEmail}
        <input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="name@agency.ca" />
      </label>
      <button class="btn" disabled={busy || !valid} onClick={send}>{t.resendBtn}</button>
      <small class="muted">{t.resendNote}</small>
      {msg && <div class={msg.ok ? 'banner' : 'err'} role="status">{msg.text}</div>}
    </div>
  );
}

/** Broker type and ownership: the type, each director and owner with their checks, and the steps when nobody holds 25% or more. Officer only. */
function OwnershipCard({ call, t, id, own, run }: { call: Call; t: Dict; id: string; own: NonNullable<Detail['ownership']>; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [type, setType] = useState<string>(own.type ?? 'corporate');
  const [person, setPerson] = useState({ fullName: '', isDirector: false, sharePercent: '0' });
  const [steps, setSteps] = useState(own.steps ?? '');
  const flags = (o: NonNullable<Detail['ownership']>['owners'][number]) => ({
    fullName: o.fullName, isDirector: o.isDirector, sharePercent: o.sharePercent, identified: o.identified, pepHioDetermined: o.pepHioDetermined, guaranteeSigned: o.guaranteeSigned,
  });
  const toggle = (o: NonNullable<Detail['ownership']>['owners'][number], k: 'identified' | 'pepHioDetermined' | 'guaranteeSigned') =>
    run(() => call('PUT', `/v1/onboarding/cases/${id}/owners/${o.id}`, { ...flags(o), [k]: !o[k] }));
  return (
    <section class="obcard wide">
      <h3>{t.own.head}</h3>
      <p class="muted">{t.own.ownerRequired}</p>
      <form class="obform" onSubmit={(e) => { e.preventDefault(); void run(() => call('POST', `/v1/onboarding/cases/${id}/type`, { type })); }}>
        <label class="fl">{t.own.type}
          <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
            <option value="individual">{t.own.individual}</option><option value="corporate">{t.own.corporate}</option>
          </select>
        </label>
        <button class="btn" type="submit">{t.own.saveType}</button>
      </form>
      {own.type === null && <p class="muted">{t.own.typeNone}</p>}
      {own.type === 'corporate' && (
        <>
          <h4>{t.own.owners}</h4>
          {own.owners.length === 0 ? <p class="muted">{t.own.none}</p> : (
            <div class="obtablewrap">
              <table class="obtable">
                <thead><tr><th>{t.own.name}</th><th>{t.own.director}</th><th>{t.own.share}</th><th>{t.own.identified}</th><th>{t.own.pep}</th><th>{t.own.guarantee}</th><th /></tr></thead>
                <tbody>
                  {own.owners.map((o) => (
                    <tr>
                      <td>{o.fullName}</td>
                      <td>{o.isDirector ? '✓' : ''}</td>
                      <td>{o.sharePercent}%</td>
                      <td><button class="btn quiet" onClick={() => toggle(o, 'identified')}>{o.identified ? '✓' : '—'}</button></td>
                      <td><button class="btn quiet" onClick={() => toggle(o, 'pepHioDetermined')}>{o.pepHioDetermined ? '✓' : '—'}</button></td>
                      <td><button class="btn quiet" onClick={() => toggle(o, 'guaranteeSigned')}>{o.guaranteeSigned ? '✓' : '—'}</button></td>
                      <td><button class="btn quiet" onClick={() => run(() => call('DELETE', `/v1/onboarding/cases/${id}/owners/${o.id}`))}>{t.own.remove}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form class="obform" onSubmit={(e) => { e.preventDefault(); if (person.fullName.trim()) void run(() => call('POST', `/v1/onboarding/cases/${id}/owners`, { fullName: person.fullName.trim(), isDirector: person.isDirector, sharePercent: Number(person.sharePercent), identified: false, pepHioDetermined: false, guaranteeSigned: false })).then(() => setPerson({ fullName: '', isDirector: false, sharePercent: '0' })); }}>
            <label class="fl">{t.own.name}<input value={person.fullName} onInput={(e) => setPerson({ ...person, fullName: (e.target as HTMLInputElement).value })} /></label>
            <label class="fl">{t.own.director}
              <select value={person.isDirector ? 'yes' : 'no'} onChange={(e) => setPerson({ ...person, isDirector: (e.target as HTMLSelectElement).value === 'yes' })}>
                <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
              </select>
            </label>
            <label class="fl">{t.own.share}<input type="number" min={0} max={100} value={person.sharePercent} onInput={(e) => setPerson({ ...person, sharePercent: (e.target as HTMLInputElement).value })} /></label>
            <button class="btn" type="submit">{t.own.add}</button>
          </form>
          {own.problems.includes('steps_missing') && (
            <form class="obform" onSubmit={(e) => { e.preventDefault(); void run(() => call('PUT', `/v1/onboarding/cases/${id}/ownership-steps`, { steps })); }}>
              <label class="fl obspan2">{t.own.stepsHead}<textarea rows={2} value={steps} onInput={(e) => setSteps((e.target as HTMLTextAreaElement).value)} /></label>
              <p class="muted obspan2">{t.own.stepsHint}</p>
              <button class="btn" type="submit">{t.own.stepsSave}</button>
            </form>
          )}
        </>
      )}
      {own.problems.length === 0 ? <p class="muted">{t.own.complete}</p> : (
        <ul class="oblist">{own.problems.map((p) => <li>{t.own.missing[p] ?? p}</li>)}</ul>
      )}
      <p class="muted">{t.own.locked}</p>
    </section>
  );
}

/** A red flag can be decided as good standing only with the President and CEO's approval, recorded here. */
function ExceptionCard({ call, t, id, d, run }: { call: Call; t: Dict; id: string; d: Detail; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const flagged = d.screening?.insolvencyOrJudgment === true || d.screening?.redFlag === true
    || d.checks.some((c) => c.kind === 'background' && c.status === 'complete' && c.adverse === true);
  if (!flagged) return null;
  const approved = d.exceptions ?? [];
  return (
    <section class="obcard wide">
      <h3>{t.exc.head}</h3>
      <p class="muted">{t.exc.why}</p>
      {approved.length === 0 ? <p class="muted">{t.exc.none}</p> : (
        <ul class="oblist">{approved.map((x) => <li>{t.exc.approved} {x.approverName} · {dateOf(x.approvedAt)}<span class="muted">{x.reason}</span></li>)}</ul>
      )}
      {approved.length === 0 && (d.canApproveException ? (
        <form class="obform" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 10) void run(() => call('POST', `/v1/onboarding/cases/${id}/exception-approval`, { reason: reason.trim() })); }}>
          <label class="fl obspan2">{t.exc.reason}<textarea rows={2} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} /></label>
          <button class="btn" type="submit" disabled={reason.trim().length < 10}>{t.exc.approve}</button>
        </form>
      ) : <p class="muted">{t.exc.waiting}</p>)}
    </section>
  );
}

function CaseFile({ call, t, locale, id, onBack }: { call: Call; t: Dict; locale: Locale; id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState({ kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: '', adverse: 'false' });
  const [decision, setDecision] = useState({ outcome: 'good_standing', reason: '' });
  const [scr, setScr] = useState({ insolv: 'no', debt: 'no', licence: 'no', term: 'no', sponsor: 'no', complaints: 'no' });
  const [screenRequired, setScreenRequired] = useState(true);
  const [agr, setAgr] = useState({ title: 'PII agency agreement', version: '', body: '' });
  const [signed, setSigned] = useState<{ id: string; title: string; version: string; signedAt: string }[]>([]);
  const [sentOk, setSentOk] = useState(false);
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';

  const load = async () => {
    try { setD((await call('GET', `/v1/onboarding/cases/${id}`)) as Detail); setError(''); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    void (async () => {
      try { const r = (await call('GET', '/v1/onboarding/requirements')) as Requirements; setScreenRequired(r.requirements.screeningBeforeDecision !== false); } catch { setScreenRequired(true); }
    })();
  }, [id]);
  useEffect(() => {
    void (async () => {
      try { setSigned((await call('GET', `/v1/onboarding/cases/${id}/agreements`)).agreements ?? []); } catch { setSigned([]); }
    })();
  }, [id, d?.stage]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const recordCheck = () => run(() => {
    const body: Record<string, unknown> = { kind: check.kind, provider: check.provider, status: check.status };
    if (check.kind === 'credit' && check.status === 'complete') body.score = Number(check.score);
    if (check.kind === 'background' && check.status === 'complete') body.adverse = check.adverse === 'true';
    return call('POST', `/v1/onboarding/cases/${id}/checks`, body);
  });

  const recordScreening = () => run(() => {
    const flag = scr.debt === 'yes' || scr.licence === 'yes' || scr.term === 'yes' || scr.sponsor === 'yes' || scr.complaints === 'yes';
    return call('POST', `/v1/onboarding/cases/${id}/screening`, {
      insolvencyOrJudgment: scr.insolv === 'yes',
      redFlag: flag,
      answers: { insolvencyOrJudgment: scr.insolv, debtToInsurer: scr.debt, licenceRefusedOrConditions: scr.licence, terminationForCause: scr.term, sponsorshipChanges5y: scr.sponsor, complaintsOrDiscipline: scr.complaints },
    });
  });
  const decide = () => run(() => call('POST', `/v1/onboarding/cases/${id}/decision`, decision));
  const nextStage = (s: string) => run(() => call('POST', `/v1/onboarding/cases/${id}/stage`, { to: s }));

  if (!d) return <div class="home obwrap"><button class="btn quiet" onClick={onBack}>← {t.back}</button>{error && <div class="err" role="alert">{error}</div>}</div>;

  const suggestedLabel = d.suggested === 'pending' ? t.pending : t.outcomeL[d.suggested];
  const canDecide = d.stage === 'checks_complete';
  const canRecord = ['consents_recorded', 'checks_requested', 'checks_complete'].includes(d.stage);
  const nextKey = d.stage === 'standing_decided' ? (d.outcome === 'good_standing' ? 'standing_decided_good' : 'standing_decided_other') : d.stage;
  const dueState = d.recheck?.status;

  return (
    <div class="home obwrap">
      <button class="btn quiet obback" onClick={onBack}>← {t.back}</button>
      <SectionHead
        title={d.partnerName}
        sub={`${countryName(d.country)} · ${STAGE_LABEL[d.stage][lc]}`}
        right={<>
          <span class={`chip ${d.outcome === 'good_standing' ? 'ok' : d.outcome ? 'warn' : ''}`}>{d.outcome ? t.outcomeL[d.outcome] : t.standingPending}</span>
          {d.awaitingApproval && <span class="chip warn" title={t.exc.pendingNote}>{t.exc.pendingChip}</span>}
          {d.recheck && <span class={`chip ${dueState === 'overdue' ? 'warn' : ''}`}>{t.recheck}: {dateOf(d.recheck.dueOn)}{dueState === 'overdue' ? ` · ${t.overdue}` : dueState === 'due_soon' ? ` · ${t.soon}` : ''}</span>}
        </>}
      />
      {error && <div class="err" role="alert">{error}</div>}

      <section class="obcard">
        <StepList stage={d.stage} locale={locale} />
        <div class="obnext" role="status"><b>{t.nextHead}:</b> {t.next[nextKey]}</div>
        {d.invite && <p class="muted obnote">{t.invLabel[d.invite.status]} · {d.invite.email}{d.invite.reminders > 0 ? ` · ${d.invite.reminders}/3` : ''}{d.invite.error ? ` · ${d.invite.error}` : ''}</p>}
        {d.loginCreated && <p class="muted obnote">{d.extensionInstalled ? t.extOn : t.extOff}</p>}
        {!d.loginCreated && (
          <ResendInvite call={call} t={t} nodeId={d.nodeId} defaultEmail={d.invite?.email ?? ''} onSent={() => void load()} />
        )}
      </section>

      <div class="obgrid">
        <section class="obcard">
          <h3>{t.sections.consents}</h3>
          {d.consents.length === 0 ? <p class="muted">{t.noConsent}</p> : (
            <ul class="oblist">{d.consents.map((c) => <li>{c.kind.replace(/_/g, ' ')}<span class={c.accepted ? 'chip ok' : 'chip warn'}>{c.accepted ? 'Yes' : 'No'}</span></li>)}</ul>
          )}
        </section>

        <section class="obcard">
          <h3>{t.sections.packets}</h3>
          {d.carrierPackets.length === 0 ? <p class="muted">{t.noPackets}</p> : (
            <ul class="oblist">{d.carrierPackets.map((p) => <li>{p.carrier}<span class="muted">{p.templateVersion} · {p.status}</span></li>)}</ul>
          )}
        </section>

        <section class="obcard wide">
          <h3>{t.sections.checks}</h3>
          {d.checks.length === 0 ? <p class="muted">{t.noChecks}</p> : (
            <div class="obtablewrap">
              <table class="obtable">
                <thead><tr><th>{t.checkCol}</th><th>{t.provider}</th><th>{t.statusL}</th><th>{t.score}</th><th>{t.adverse}</th></tr></thead>
                <tbody>
                  {d.checks.map((c) => (
                    <tr>
                      <td>{t.kind[c.kind] ?? c.kind}</td>
                      <td>{c.provider}</td>
                      <td>{t.status[c.status] ?? c.status}</td>
                      <td>{c.score ?? t.dash}</td>
                      <td>{c.kind === 'background' && c.status === 'complete' ? (c.adverse ? t.adverseYes : t.clear) : t.dash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canRecord && (
            <form class="obform" onSubmit={(e) => { e.preventDefault(); void recordCheck(); }}>
              <label class="fl">{t.checkL}
                <select value={check.kind} onChange={(e) => setCheck({ ...check, kind: (e.target as HTMLSelectElement).value, provider: (e.target as HTMLSelectElement).value === 'credit' ? 'Equifax Canada' : 'Sterling Backcheck' })}>
                  <option value="credit">{t.kind.credit}</option><option value="background">{t.kind.background}</option>
                </select>
              </label>
              <label class="fl">{t.provider}<input value={check.provider} onInput={(e) => setCheck({ ...check, provider: (e.target as HTMLInputElement).value })} /></label>
              <label class="fl">{t.statusL}
                <select value={check.status} onChange={(e) => setCheck({ ...check, status: (e.target as HTMLSelectElement).value })}>
                  <option value="complete">{t.status.complete}</option><option value="requested">{t.status.requested}</option><option value="failed">{t.status.failed}</option>
                </select>
              </label>
              {check.kind === 'credit' && check.status === 'complete' && (
                <label class="fl">{t.score}<input type="number" min={300} max={900} value={check.score} onInput={(e) => setCheck({ ...check, score: (e.target as HTMLInputElement).value })} /></label>
              )}
              {check.kind === 'background' && check.status === 'complete' && (
                <label class="fl">{t.adverse}
                  <select value={check.adverse} onChange={(e) => setCheck({ ...check, adverse: (e.target as HTMLSelectElement).value })}>
                    <option value="false">{t.clear}</option><option value="true">{t.adverseYes}</option>
                  </select>
                </label>
              )}
              <button class="btn" type="submit" disabled={busy}>{t.record}</button>
            </form>
          )}
        </section>

        <ExceptionCard call={call} t={t} id={id} d={d} run={run} />
        {d.ownership && <OwnershipCard call={call} t={t} id={id} own={d.ownership} run={run} />}
        <section class="obcard wide">
          <h3>{t.screen.head}</h3>
          {d.screening ? (
            <ul class="oblist">
              <li>{t.screen.insolvency}<span class={d.screening.insolvencyOrJudgment ? 'chip warn' : 'chip ok'}>{d.screening.insolvencyOrJudgment ? t.screen.yes : t.screen.no}</span></li>
              <li>{t.screen.redFlag}<span class={d.screening.redFlag ? 'chip warn' : 'chip ok'}>{d.screening.redFlag ? t.screen.yes : t.screen.no}</span></li>
              <li>{t.screen.recorded}<span class="muted">{dateOf(d.screening.recordedAt)}</span></li>
            </ul>
          ) : <p class="muted">{t.screen.none}</p>}
          {canRecord && (
            <form class="obform" onSubmit={(e) => { e.preventDefault(); void recordScreening(); }}>
              <p class="muted obspan2">{t.screen.hint}</p>
                <label class="fl obspan2">{t.screen.insolv}
                  <select value={scr.insolv} onChange={(e) => setScr({ ...scr, insolv: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
                <label class="fl obspan2">{t.screen.debt}
                  <select value={scr.debt} onChange={(e) => setScr({ ...scr, debt: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
                <label class="fl obspan2">{t.screen.licence}
                  <select value={scr.licence} onChange={(e) => setScr({ ...scr, licence: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
                <label class="fl obspan2">{t.screen.term}
                  <select value={scr.term} onChange={(e) => setScr({ ...scr, term: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
                <label class="fl obspan2">{t.screen.sponsor}
                  <select value={scr.sponsor} onChange={(e) => setScr({ ...scr, sponsor: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
                <label class="fl obspan2">{t.screen.complaints}
                  <select value={scr.complaints} onChange={(e) => setScr({ ...scr, complaints: (e.target as HTMLSelectElement).value })}>
                    <option value="no">{t.screen.no}</option><option value="yes">{t.screen.yes}</option>
                  </select>
                </label>
              <button class="btn" type="submit" disabled={busy}>{t.screen.record}</button>
            </form>
          )}
        </section>

        <section class="obcard wide">
          <h3>{t.sections.decision}</h3>
          {canDecide && screenRequired && !d.screening ? <p class="muted">{t.screen.firstHead}</p> : canDecide ? (
            <>
              <p class="obhint">{t.suggested}: <strong>{suggestedLabel}</strong> · {t.credit(d.thresholds.creditPassMin, d.thresholds.creditReviewMin)}</p>
              <form class="obform" onSubmit={(e) => { e.preventDefault(); if (decision.reason.trim()) void decide(); }}>
                <label class="fl">{t.outcome}
                  <select value={decision.outcome} onChange={(e) => setDecision({ ...decision, outcome: (e.target as HTMLSelectElement).value })}>
                    {OUTCOMES.map((o) => <option value={o}>{t.outcomeL[o]}</option>)}
                  </select>
                </label>
                <label class="fl obspan2">{t.reason}
                  <textarea rows={2} value={decision.reason} onInput={(e) => setDecision({ ...decision, reason: (e.target as HTMLTextAreaElement).value })} />
                </label>
                <button class="btn" type="submit" disabled={busy || decision.reason.trim().length < 1}>{t.decide}</button>
              </form>
            </>
          ) : <p class="muted">{t.decisionLocked}</p>}
          {d.decisions.length > 0 && (
            <>
              <h4>{t.sections.decisions}</h4>
              <ul class="oblist">{d.decisions.map((x) => <li>{dateOf(x.decidedAt)}<span>{t.outcomeL[x.outcome]} · {x.reason}</span></li>)}</ul>
            </>
          )}
        </section>

        <section class="obcard wide">
          <h3>{t.sections.agreement}</h3>
          {(d.stage === 'standing_decided' || d.stage === 'agency_agreement_sent') && d.outcome === 'good_standing' && (
            <>
              <p class="muted">{t.agHint}</p>
              <form class="obform" onSubmit={(e) => { e.preventDefault(); void run(async () => { await call('POST', `/v1/onboarding/cases/${id}/agreement`, agr); setSentOk(true); }); }}>
                <label class="fl">{t.agTitle}<input value={agr.title} onInput={(e) => setAgr({ ...agr, title: (e.target as HTMLInputElement).value })} /></label>
                <label class="fl">{t.agVersion}<input value={agr.version} onInput={(e) => setAgr({ ...agr, version: (e.target as HTMLInputElement).value })} /></label>
                <label class="fl obspan2">{t.agText}
                  <textarea rows={6} value={agr.body} onInput={(e) => setAgr({ ...agr, body: (e.target as HTMLTextAreaElement).value })} />
                </label>
                <button class="btn" type="submit" disabled={busy || agr.body.trim().length < 1 || agr.version.trim().length < 1 || agr.title.trim().length < 1}>
                  {d.stage === 'agency_agreement_sent' ? t.agResend : t.agSend}
                </button>
              </form>
              {sentOk && d.stage === 'standing_decided' && <p class="muted">{t.agSentOk}</p>}
            </>
          )}
          {d.stage === 'agency_agreement_sent' && <p class="muted">{t.agWaiting}</p>}
          <h4>{t.sections.signed}</h4>
          {signed.length === 0 ? <p class="muted">{t.noSigned}</p> : (
            <ul class="oblist">{signed.map((a) => <li>{a.title} · {a.version}<span>{t.agSignedOn} {dateOf(a.signedAt)} · <a href={`/v1/onboarding/agreements/${a.id}/pdf`}>{t.agPdf}</a></span></li>)}</ul>
          )}
          {d.stage === 'agency_agreement_signed' && (
            <button class="btn" disabled={busy} onClick={() => nextStage('active')}>{t.activate}</button>
          )}
        </section>
      </div>
    </div>
  );
}
