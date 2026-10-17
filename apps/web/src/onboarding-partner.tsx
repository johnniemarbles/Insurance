// The partner's own onboarding, shown at the top of the Compliance page: the stages as a progress list, the standing and what it means for access, the next check date, and the steps the partner completes.
// The API never sends the checks, scores or reasons to a partner, so none are shown here.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { OUTCOME_LABEL, StepList, STAGE_LABEL, type Stage } from './onboarding-shared.tsx';
import { SelfReportForm } from './self-report.tsx';
import { SubBrokerForm } from './sub-broker.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const P = {
  en: {
    frozen: 'Your licence or E&O policy has expired, so carrier submissions are on hold. Renew it to continue.',
    title: 'Your partner onboarding', none: 'There is no onboarding for your partner account.',
    expiresHead: 'Licence and E&O expiry', expiresNone: 'No licence or E&O dates on file yet.', expiryKind: { licence: 'Licence', eo: 'E&O' }, expiryState: { expired: 'Expired: coverage is frozen', expiring: 'Expires within 30 days', valid: 'Valid' },
    progress: 'Your progress', outcome: 'Standing', nextCheck: 'Next check due', next: 'What happens next', pending: 'Being checked',
    keepGood: 'You are in good standing.', keepReview: 'Your file is being reviewed. Your access continues while it is open.',
    keepNot: 'Your file is not in good standing. Your access continues, but please contact your compliance officer.',
    stepProfile: 'Complete your business profile on this page, submit it, then come back here to give consent.', submitForm: 'Submit my profile for onboarding',
    consentHead: 'Consent to checks', consentIntro: 'Your compliance officer records a credit check (Equifax Canada) and a background check (Sterling). PII stores what they enter. It does not call those companies. This consent wording (onboarding-draft-1) has not been signed off by counsel.',
    cCredit: 'I consent to a credit check', cBackground: 'I consent to a background check', cCarrier: 'I agree that carriers may receive my appointment and standing information',
    giveConsent: 'Give consent',
    installHead: 'Install the Gmail extension', installBody: 'Your login works. Now install the PII extension so PII sits beside your Gmail conversations. The install page has the download and four short steps.', installCta: 'Open the install page', installed: 'The Gmail extension is installed.',
    next_invited: 'Submit your business profile on this page to start.',
    next_form_submitted: 'Give your consent to the checks below.',
    next_consents_recorded: 'Thanks. Your checks are being arranged. Nothing more is needed from you right now.',
    next_checks_requested: 'Your checks are running. Nothing more is needed from you right now.',
    next_checks_complete: 'Your checks are complete and your file is with the compliance team.',
    next_standing_decided: 'Your standing is decided. Your agency agreement will be sent to you next.',
    next_agency_agreement_sent: 'Your agency agreement has been emailed to you. Open the link in that email to read and sign it.',
    next_agency_agreement_signed: 'Your agreement is signed. Activation is next.',
    next_active: 'You are active. You can send carrier packets below.',
    packetsHead: 'Carrier packets', carrier: 'Carrier', template: 'Form version', sendPacket: 'Send carrier packet', noPackets: 'None yet.',
    packetStatus: { draft: 'Draft', sent: 'Sent', signed: 'Signed', carrier_approved: 'Approved by carrier', declined: 'Declined' } as Record<string, string>,
  },
  'fr-CA': {
    frozen: 'Votre permis ou votre police E&O a expiré : les soumissions aux assureurs sont suspendues. Renouvelez-la pour continuer.',
    title: 'Votre intégration de partenaire', none: 'Il n’y a pas d’intégration pour votre compte de partenaire.',
    expiresHead: 'Expiration du permis et de l’E&O', expiresNone: 'Aucune date de permis ou d’E&O au dossier pour l’instant.', expiryKind: { licence: 'Permis', eo: 'E&O' }, expiryState: { expired: 'Expiré : la couverture est gelée', expiring: 'Expire dans 30 jours', valid: 'Valide' },
    progress: 'Votre progression', outcome: 'Réputation', nextCheck: 'Prochaine vérification', next: 'Ce qui suit', pending: 'En cours de vérification',
    keepGood: 'Vous êtes en bonne réputation.', keepReview: 'Votre dossier est en cours d’examen. Votre accès se poursuit pendant l’examen.',
    keepNot: 'Votre dossier n’est pas en bonne réputation. Votre accès se poursuit, mais veuillez communiquer avec votre responsable de la conformité.',
    stepProfile: 'Remplissez votre profil d’entreprise sur cette page, soumettez-le, puis revenez ici pour donner votre consentement.', submitForm: 'Soumettre mon profil pour l’intégration',
    consentHead: 'Consentement aux vérifications', consentIntro: 'Votre responsable de la conformité inscrit une vérification de crédit (Equifax Canada) et une vérification d’antécédents (Sterling). PII conserve ce qu’il saisit. Il n’appelle pas ces sociétés. Ce texte de consentement (onboarding-draft-1) n’a pas encore été approuvé par le conseiller juridique.',
    cCredit: 'Je consens à une vérification de crédit', cBackground: 'Je consens à une vérification d’antécédents', cCarrier: 'J’accepte que les assureurs reçoivent mes renseignements de nomination et de réputation',
    giveConsent: 'Donner mon consentement',
    installHead: 'Installer l’extension Gmail', installBody: 'Votre connexion fonctionne. Installez maintenant l’extension PII pour afficher PII à côté de vos conversations Gmail. La page d’installation contient le téléchargement et quatre étapes courtes.', installCta: 'Ouvrir la page d’installation', installed: 'L’extension Gmail est installée.',
    next_invited: 'Soumettez votre profil d’entreprise sur cette page pour commencer.',
    next_form_submitted: 'Donnez votre consentement aux vérifications ci-dessous.',
    next_consents_recorded: 'Merci. Vos vérifications sont en préparation. Rien d’autre n’est requis de votre part pour l’instant.',
    next_checks_requested: 'Vos vérifications sont en cours. Rien d’autre n’est requis de votre part pour l’instant.',
    next_checks_complete: 'Vos vérifications sont terminées et votre dossier est auprès de l’équipe de conformité.',
    next_standing_decided: 'Votre réputation est décidée. Votre entente d’agence vous sera envoyée ensuite.',
    next_agency_agreement_sent: 'Votre entente d’agence vous a été envoyée par courriel. Ouvrez le lien dans ce courriel pour la lire et la signer.',
    next_agency_agreement_signed: 'Votre entente est signée. L’activation est la prochaine étape.',
    next_active: 'Vous êtes actif. Vous pouvez envoyer des dossiers auprès des assureurs ci-dessous.',
    packetsHead: 'Dossiers auprès des assureurs', carrier: 'Assureur', template: 'Version du formulaire', sendPacket: 'Envoyer le dossier', noPackets: 'Aucun pour l’instant.',
    packetStatus: { draft: 'Brouillon', sent: 'Envoyé', signed: 'Signé', carrier_approved: 'Approuvé par l’assureur', declined: 'Refusé' } as Record<string, string>,
  },
};

interface View {
  id: string; partnerName: string; country: string; stage: string; outcome: string | null; label: string; keepsAccess: boolean; warning: boolean; loginCreated: boolean; extensionInstalled: boolean;
  recheck: { dueOn: string; status: string } | null; consentsGiven: string[];
  carrierPackets: { id: string; carrier: string; status: string; effectiveDate: string | null }[];
  expiries?: { id: string; kind: 'licence' | 'eo'; label: string; expiresOn: string; status: 'expired' | 'expiring' | 'valid' }[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `embedded` (the Compliance page) shows nothing when the account has no onboarding; the standalone form shows a short notice instead. */
export function PartnerOnboarding({ call, locale, embedded = false }: { call: Call; locale: Locale; embedded?: boolean }) {
  const t = P[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState({ credit: false, background: false, carrier: false });
  const [carrierChoice, setCarrierChoice] = useState({ carrierName: '', jurisdiction: 'CA-ON' });
  const [contracts, setContracts] = useState<{ id: string; carrierName: string; jurisdiction: string; state: string }[]>([]);
  const [contractsError, setContractsError] = useState('');
  const [packet, setPacket] = useState({ carrier: 'iA Financial Group', templateVersion: 'F11-92A' });

  const load = async () => {
    try {
      const next = ((await call('GET', '/v1/onboarding/mine')).onboarding ?? null) as View | null;
      setView(next);
      setError('');
      if (next) {
        try {
          const data = await call('GET', `/v1/onboarding/cases/${next.id}/carrier-contracts`);
          setContracts((data.contracts ?? []) as typeof contracts);
          setContractsError('');
        } catch (e) { setContractsError(errText(e)); }
      } else setContracts([]);
    } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, [call]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(errText(e).includes('licence_or_eo_expired') ? t.frozen : errText(e)); } finally { setBusy(false); }
  };

  if (view === undefined) return embedded ? null : <section class="obwrap">{error && <div class="err" role="alert">{error}</div>}</section>;
  if (view === null) return embedded ? (error ? <div class="err" role="alert">{error}</div> : null) : <section class="obwrap"><div class="calm">{t.none}</div></section>;

  const stage = view.stage as Stage;
  const keepText = view.outcome === 'good_standing' ? t.keepGood : view.outcome === 'needs_review' ? t.keepReview : view.outcome === 'not_in_good_standing' ? t.keepNot : null;
  const outcome = view.outcome ? (OUTCOME_LABEL[view.outcome]?.[lc] ?? view.outcome) : t.pending;

  return (
    <section class="obwrap obpartner pg" aria-label={t.title}>
      <header class="obhead">
        <div><span class="obkicker">{t.title}</span><h2>{view.partnerName}</h2></div>
        <div class="obhead-right">
          <span class="chip">{STAGE_LABEL[stage][lc]}</span>
          <span class={`chip ${view.outcome === 'good_standing' ? 'ok' : view.outcome ? 'warn' : ''}`}>{t.outcome}: {outcome}</span>
        </div>
      </header>

      {error && <div class="err" role="alert">{error}</div>}

      <section class="obcard">
        <h3>{t.progress}</h3>
        <StepList stage={stage} locale={locale} />
        <div class="obnext" role="status"><b>{t.next}:</b> {t[`next_${stage}` as 'next_active']}</div>
        {keepText && <div class={`banner ${view.warning ? 'warn' : ''}`} role="status">{keepText}</div>}
        {view.recheck && <p class="muted obnote">{t.nextCheck}: {view.recheck.dueOn.slice(0, 10)}</p>}
      </section>

      <section class="obcard">
        <h3>{t.expiresHead}</h3>
        {(view.expiries ?? []).length === 0 ? <p class="muted">{t.expiresNone}</p> : (
          <ul class="oblist">{(view.expiries ?? []).map((e) => <li key={e.id}>{e.label} · {t.expiryKind[e.kind]} · {e.expiresOn}<span class="muted">{t.expiryState[e.status]}</span></li>)}</ul>
        )}
      </section>

      <section class="obcard">
        <h3>{lc === 'fr-CA' ? 'Choix des assureurs' : 'Carrier contracting'}</h3>
        <p class="muted">{lc === 'fr-CA' ? 'Choisissez les assureurs pendant votre intégration. La demande ne permet pas encore de vendre.' : 'Select carriers during onboarding. A request does not authorize selling.'}</p>
        {contractsError && <p class="err" role="alert">{contractsError}</p>}
        {contracts.length === 0 ? <p class="muted">{lc === 'fr-CA' ? 'Aucun assureur sélectionné.' : 'No carriers selected.'}</p> :
          <ul class="oblist">{contracts.map(c => <li key={c.id}>{c.carrierName} ({c.jurisdiction}) <span class="muted">{c.state}</span></li>)}</ul>}
        <form class="obform" onSubmit={e => {
          e.preventDefault();
          void run(() => call('POST', `/v1/onboarding/cases/${view.id}/carrier-contracts`, carrierChoice));
        }}>
          <label class="fl">{t.carrier}<input required maxLength={120} value={carrierChoice.carrierName}
            onInput={e => setCarrierChoice({ ...carrierChoice, carrierName: (e.target as HTMLInputElement).value })} /></label>
          <label class="fl">{lc === 'fr-CA' ? 'Juridiction' : 'Jurisdiction'}
            <input required maxLength={15} value={carrierChoice.jurisdiction}
              onInput={e => setCarrierChoice({ ...carrierChoice, jurisdiction: (e.target as HTMLInputElement).value })} /></label>
          <button class="btn" type="submit" disabled={busy || !carrierChoice.carrierName.trim()}>
            {lc === 'fr-CA' ? 'Demander le contrat' : 'Request carrier contract'}
          </button>
        </form>
      </section>

      <SelfReportForm call={call} locale={locale} caseId={view.id} />
      {stage === 'active' && <SubBrokerForm call={call} locale={locale} caseId={view.id} />}

      {view.loginCreated && (
        <section class="obcard">
          <h3>{view.extensionInstalled ? t.installed : t.installHead}</h3>
          {!view.extensionInstalled && <p class="muted">{t.installBody}</p>}
          {!view.extensionInstalled && <a class="btn" href={`/install?lang=${lc}`} target="_blank" rel="noopener">{t.installCta}</a>}
        </section>
      )}

      {stage === 'invited' && (
        <section class="obcard">
          <p>{t.stepProfile}</p>
          <button class="btn" disabled={busy} onClick={() => run(() => call('POST', `/v1/onboarding/cases/${view.id}/form`))}>{t.submitForm}</button>
        </section>
      )}

      {stage === 'form_submitted' && (
        <section class="obcard">
          <h3>{t.consentHead}</h3>
          <p class="muted">{t.consentIntro}</p>
          <div class="obchecks">
            <label><input type="checkbox" checked={consent.credit} onChange={(e) => setConsent({ ...consent, credit: (e.target as HTMLInputElement).checked })} /> {t.cCredit}</label>
            <label><input type="checkbox" checked={consent.background} onChange={(e) => setConsent({ ...consent, background: (e.target as HTMLInputElement).checked })} /> {t.cBackground}</label>
            <label><input type="checkbox" checked={consent.carrier} onChange={(e) => setConsent({ ...consent, carrier: (e.target as HTMLInputElement).checked })} /> {t.cCarrier}</label>
          </div>
          <button class="btn" disabled={busy || !consent.credit || !consent.background} onClick={() => run(() => call('POST', `/v1/onboarding/cases/${view.id}/consents`, {
            consents: [
              { kind: 'credit_check', accepted: consent.credit },
              { kind: 'background_check', accepted: consent.background },
              { kind: 'carrier_reporting', accepted: consent.carrier },
            ],
          }))}>{t.giveConsent}</button>
        </section>
      )}

      {stage === 'active' && (
        <section class="obcard">
          <h3>{t.packetsHead}</h3>
          {view.carrierPackets.length === 0 ? <p class="muted">{t.noPackets}</p> : (
            <ul class="oblist">{view.carrierPackets.map((p) => <li>{p.carrier}<span class="muted">{t.packetStatus[p.status] ?? p.status}</span></li>)}</ul>
          )}
          <form class="obform" onSubmit={(e) => { e.preventDefault(); void run(() => call('POST', `/v1/onboarding/cases/${view.id}/carrier-packets`, packet)); }}>
            <label class="fl">{t.carrier}<input value={packet.carrier} onInput={(e) => setPacket({ ...packet, carrier: (e.target as HTMLInputElement).value })} /></label>
            <label class="fl">{t.template}<input value={packet.templateVersion} onInput={(e) => setPacket({ ...packet, templateVersion: (e.target as HTMLInputElement).value })} /></label>
            <button class="btn" type="submit" disabled={busy}>{t.sendPacket}</button>
          </form>
        </section>
      )}
    </section>
  );
}
