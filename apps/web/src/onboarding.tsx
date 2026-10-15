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
    invite: 'Invite a partner', inviteHead: 'Invite a partner to onboarding', partner: 'Partner', country: 'Country', inviteBtn: 'Send invitation', invLabel: { created: 'Invite created', sent: 'Invite sent', opened: 'Link opened', accepted: 'Login created', overdue: 'Invite overdue: no reply after 72 hours', not_sent: 'Email not sent' } as Record<string, string>, extOn: 'Extension installed', extOff: 'Extension not installed yet', resendHead: 'Send a new invitation', resendBtn: 'Send new invitation', resendNote: 'The earlier link stops working. The partner gets one email with the login link and the install step.', adminEmail: 'Email of the partner’s administrator', adminHint: 'They get one email to create their PII login and install the Gmail extension.', invitedSent: (e: string) => `Invited. The invitation was emailed to ${e}. The link works once and expires in 7 days.`, invitedNotSent: (e: string, why: string) => `Invited, but the email to ${e} was not sent: ${why}. Fix the cause and invite again.`, cancel: 'Cancel',
    noPartners: 'Every partner is already in onboarding.', invitedOk: (n: number) => (n > 0 ? `Invited. An email was sent to ${n} ${n === 1 ? 'person' : 'people'} at the partner.` : 'Invited. No email was sent: nobody at this partner has a PII login yet. Ask the company administrator to add one, then tell them to open Compliance.'),
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
    agTitle: 'Agreement title', agVersion: 'Version', agText: 'Agreement text (as issued by counsel)', agSend: 'Send agency agreement to the partner',
    agResend: 'Send the agreement again', agWaiting: 'Waiting for the partner to sign. The link was emailed to the partner’s people.', agSentOk: 'Agreement sent.', agHint: 'The partner signs through a private link with a code sent to their email.',
    agSignedOn: 'Signed', agPdf: 'Sealed PDF', activate: 'Activate partner',
    outcomeL: { good_standing: 'Good standing', needs_review: 'Needs review', not_in_good_standing: 'Not in good standing' } as Record<string, string>,
    credit: (pass: number, review: number) => `Credit ${pass} or more passes. ${review} to ${pass - 1} needs review. Below ${review} is not in good standing.`,
  },
  'fr-CA': {
    title: 'Intégration des partenaires', sub: 'Invitez un partenaire, faites les vérifications de crédit Equifax et d’antécédents Sterling, décidez de la bonne réputation, puis envoyez l’entente d’agence. Le partenaire ne voit que le résultat.',
    invite: 'Inviter un partenaire', inviteHead: 'Inviter un partenaire à l’intégration', partner: 'Partenaire', country: 'Pays', inviteBtn: 'Envoyer l’invitation', invLabel: { created: 'Invitation créée', sent: 'Invitation envoyée', opened: 'Lien ouvert', accepted: 'Connexion créée', overdue: 'Invitation en retard : aucune réponse après 72 heures', not_sent: 'Courriel non envoyé' } as Record<string, string>, extOn: 'Extension installée', extOff: 'Extension pas encore installée', resendHead: 'Envoyer une nouvelle invitation', resendBtn: 'Envoyer une nouvelle invitation', resendNote: 'L’ancien lien ne fonctionne plus. Le partenaire reçoit un seul courriel avec le lien de connexion et l’étape d’installation.', adminEmail: 'Courriel de l’administrateur du partenaire', adminHint: 'Il reçoit un seul courriel pour créer sa connexion PII et installer l’extension Gmail.', invitedSent: (e: string) => `Invité. L’invitation a été envoyée par courriel à ${e}. Le lien ne fonctionne qu’une fois et expire dans 7 jours.`, invitedNotSent: (e: string, why: string) => `Invité, mais le courriel à ${e} n’a pas été envoyé : ${why}. Corrigez la cause et invitez à nouveau.`, cancel: 'Annuler',
    noPartners: 'Tous les partenaires sont déjà en intégration.', invitedOk: (n: number) => (n > 0 ? `Invité. Un courriel a été envoyé à ${n} personne${n === 1 ? '' : 's'} du partenaire.` : 'Invité. Aucun courriel envoyé : personne chez ce partenaire n’a encore de connexion PII. Demandez à l’administrateur de l’entreprise d’en ajouter une, puis dites-lui d’ouvrir Conformité.'),
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

const MP = {
  en: { title: 'Partner onboarding progress', sub: 'The steps each partner in your branch has reached. Checks and decisions are kept by compliance.', none: 'No partner in your branch is in onboarding yet.', name: 'Partner' },
  'fr-CA': { title: 'Progression de l’intégration des partenaires', sub: 'Les étapes atteintes par chaque partenaire de votre succursale. Les vérifications et décisions sont gérées par la conformité.', none: 'Aucun partenaire de votre succursale n’est en intégration pour l’instant.', name: 'Partenaire' },
} as const;

/** A branch manager's view of partner onboarding: each partner's steps and their status. The API sends nothing else to a manager. */
export function ManagerProgressBoard({ call, locale }: { call: Call; locale: Locale }) {
  const [rows, setRows] = useState<{ id: string; partnerName: string; steps?: { step: Stage; status: 'done' | 'current' | 'pending' }[] }[] | null>(null);
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const m = MP[lc];
  const x = OB[lc];
  useEffect(() => { void call('GET', '/v1/onboarding/cases').then((r) => setRows(r.cases ?? []), () => setRows([])); }, [call]);
  const shown = (rows ?? []).filter((r) => Array.isArray(r.steps));
  return (
    <section class="obmanager" aria-label={m.title}>
      <SectionHead title={m.title} sub={m.sub} />
      {rows === null && <div class="msg">…</div>}
      {rows !== null && shown.length === 0 && <div class="calm">{m.none}</div>}
      {shown.map((r) => (
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
        </div>
      ))}
    </section>
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
const REQ_ENFORCED: string[] = ['screeningBeforeDecision'];

/** The Compliance officer's onboarding board: totals, invitations, a progress table for every partner, and the file for one partner. */
export function OnboardingDashboard({ call, locale, tabs }: { call: Call; locale: Locale; tabs?: ComponentChildren }) {
  const t: Dict = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviting, setInviting] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [country, setCountry] = useState<'CA' | 'US'>('CA');
  const [adminEmail, setAdminEmail] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    try {
      const r = await call('GET', '/v1/onboarding/cases');
      setCases(r.cases as CaseRow[]);
      const p = await call('GET', '/v1/compliance/partners');
      const inOnboarding = new Set((r.cases as CaseRow[]).map((c) => c.nodeId));
      setPartners((p.partners as { id: string; name: string }[]).filter((x) => !inOnboarding.has(x.id)));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => { void load(); }, [call]);

  const invite = async () => {
    setError(''); setNotice('');
    try {
      const r = await call('POST', '/v1/onboarding/cases', { nodeId: partnerId, country, adminEmail: adminEmail.trim() });
      setPartnerId(''); setAdminEmail(''); setInviting(false);
      const inv = r.invitation;
      setNotice(inv
        ? (inv.status === 'sent' ? t.invitedSent(inv.email) : t.invitedNotSent(inv.email, inv.error ?? 'the mail service did not accept it'))
        : t.invitedOk(Number(r.emailedTo ?? 0)));
      await load();
    } catch (e) { setError(errText(e)); }
  };

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
      {notice && <div class="banner" role="status">{notice}</div>}

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
          {!inviting && partners.length > 0 && <button class="btn" onClick={() => { setInviting(true); setNotice(''); }}>{t.invite}</button>}
          {!inviting && partners.length === 0 && cases && cases.length > 0 && <span class="muted">{t.noPartners}</span>}
        </div>

        {inviting && (
          <div class="obinvite" role="group" aria-label={t.inviteHead}>
            <b>{t.inviteHead}</b>
            <label class="fl">{t.partner}
              <select value={partnerId} onChange={(e) => setPartnerId((e.target as HTMLSelectElement).value)}>
                <option value="">—</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label class="fl">{t.country}
              <select value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value as 'CA' | 'US')}>
                <option value="CA">Canada</option><option value="US">US</option>
              </select>
            </label>
            <label class="fl">{t.adminEmail}
              <input type="email" value={adminEmail} onInput={(e) => setAdminEmail((e.target as HTMLInputElement).value)} placeholder="name@agency.ca" />
              <small class="muted">{t.adminHint}</small>
            </label>
            <button class="btn" disabled={!partnerId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())} onClick={invite}>{t.inviteBtn}</button>
            <button class="btn quiet" onClick={() => { setInviting(false); setPartnerId(''); setAdminEmail(''); }}>{t.cancel}</button>
          </div>
        )}

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
function ResendInvite({ call, t, nodeId, country, defaultEmail, onSent }: { call: Call; t: Dict; nodeId: string; country: string; defaultEmail: string; onSent: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await call('POST', '/v1/onboarding/cases', { nodeId, country, adminEmail: email.trim() });
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
          <ResendInvite call={call} t={t} nodeId={d.nodeId} country={d.country} defaultEmail={d.invite?.email ?? ''} onSent={() => void load()} />
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
