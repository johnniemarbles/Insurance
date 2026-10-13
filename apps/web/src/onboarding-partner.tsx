// The partner's own onboarding view. Shows the stage, the outcome and what it means for access, the next check date, and the steps the partner completes.
// The API never sends the checks, scores or reasons to a partner, so none are shown here.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const P = {
  en: {
    title: 'Your partner onboarding', none: 'There is no onboarding for your partner account.',
    progress: 'Where things stand', stage: 'Stage', outcome: 'Standing', nextCheck: 'Next check due',
    pending: 'Being checked', keepGood: 'You are in good standing.', keepReview: 'Your file is being reviewed. Your access continues while it is open.',
    keepNot: 'Your file is not in good standing. Your access continues, but please contact your compliance officer.',
    stepProfile: 'Complete your business profile on the Compliance page, submit it, then continue here.', submitForm: 'Submit my profile for onboarding',
    consentHead: 'Consent to checks', consentIntro: 'PII runs a credit check (Equifax Canada) and a background check (Sterling Backcheck) to decide your standing. You can choose whether to share carrier reporting.',
    cCredit: 'I consent to a credit check', cBackground: 'I consent to a background check', cCarrier: 'I agree that carriers may receive my appointment and standing information',
    giveConsent: 'Give consent', consentDone: 'Consent recorded.',
    waitReview: 'Your file is with the compliance team. Nothing more is needed from you right now.',
    waitNext: 'Your standing is decided. Your agency agreement will be sent to you next.',
    waitAgreement: 'Your agency agreement has been emailed to you. Open the link in that email to read and sign it.',
    waitActivate: 'Your agreement is signed. Activation is next.',
    packetsHead: 'Carrier packets', carrier: 'Carrier', template: 'Form version', sendPacket: 'Send carrier packet', noPackets: 'None yet.',
    packetStatus: { draft: 'Draft', sent: 'Sent', signed: 'Signed', carrier_approved: 'Approved by carrier', declined: 'Declined' } as Record<string, string>,
    stageL: { invited: 'Invited', form_submitted: 'Profile submitted', consents_recorded: 'Consent given', checks_requested: 'Checks requested', checks_complete: 'Checks complete', standing_decided: 'Standing decided', agency_agreement_sent: 'Agreement sent', agency_agreement_signed: 'Agreement signed', active: 'Active' } as Record<string, string>,
    outcomeL: { good_standing: 'Good standing', needs_review: 'Needs review', not_in_good_standing: 'Not in good standing' } as Record<string, string>,
    dash: '—',
  },
  'fr-CA': {
    title: 'Votre intégration de partenaire', none: 'Il n’y a pas d’intégration pour votre compte de partenaire.',
    progress: 'Où en sont les choses', stage: 'Étape', outcome: 'Réputation', nextCheck: 'Prochaine vérification',
    pending: 'En cours de vérification', keepGood: 'Vous êtes en bonne réputation.', keepReview: 'Votre dossier est en cours d’examen. Votre accès se poursuit pendant l’examen.',
    keepNot: 'Votre dossier n’est pas en bonne réputation. Votre accès se poursuit, mais veuillez communiquer avec votre responsable de la conformité.',
    stepProfile: 'Remplissez votre profil d’entreprise dans la page Conformité, soumettez-le, puis revenez ici.', submitForm: 'Soumettre mon profil pour l’intégration',
    consentHead: 'Consentement aux vérifications', consentIntro: 'PII fait une vérification de crédit (Equifax Canada) et une vérification d’antécédents (Sterling Backcheck) pour décider de votre réputation. Vous choisissez si vous partagez les renseignements aux assureurs.',
    cCredit: 'Je consens à une vérification de crédit', cBackground: 'Je consens à une vérification d’antécédents', cCarrier: 'J’accepte que les assureurs reçoivent mes renseignements de nomination et de réputation',
    giveConsent: 'Donner mon consentement', consentDone: 'Consentement enregistré.',
    waitReview: 'Votre dossier est auprès de l’équipe de conformité. Rien d’autre n’est requis de votre part pour l’instant.',
    waitNext: 'Votre réputation est décidée. Votre entente d’agence vous sera envoyée ensuite.',
    waitAgreement: 'Votre entente d’agence vous a été envoyée par courriel. Ouvrez le lien dans ce courriel pour la lire et la signer.',
    waitActivate: 'Votre entente est signée. L’activation est la prochaine étape.',
    packetsHead: 'Dossiers auprès des assureurs', carrier: 'Assureur', template: 'Version du formulaire', sendPacket: 'Envoyer le dossier', noPackets: 'Aucun pour l’instant.',
    packetStatus: { draft: 'Brouillon', sent: 'Envoyé', signed: 'Signé', carrier_approved: 'Approuvé par l’assureur', declined: 'Refusé' } as Record<string, string>,
    stageL: { invited: 'Invité', form_submitted: 'Profil soumis', consents_recorded: 'Consentement donné', checks_requested: 'Vérifications demandées', checks_complete: 'Vérifications terminées', standing_decided: 'Réputation décidée', agency_agreement_sent: 'Entente envoyée', agency_agreement_signed: 'Entente signée', active: 'Actif' } as Record<string, string>,
    outcomeL: { good_standing: 'Bonne réputation', needs_review: 'À examiner', not_in_good_standing: 'Réputation non conforme' } as Record<string, string>,
    dash: '—',
  },
};

interface View {
  id: string; partnerName: string; country: string; stage: string; outcome: string | null; label: string; keepsAccess: boolean; warning: boolean;
  recheck: { dueOn: string; status: string } | null; consentsGiven: string[];
  carrierPackets: { id: string; carrier: string; status: string; effectiveDate: string | null }[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PartnerOnboarding({ call, locale }: { call: Call; locale: Locale }) {
  const t = P[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState({ credit: false, background: false, carrier: false });
  const [packet, setPacket] = useState({ carrier: 'iA Financial Group', templateVersion: 'F11-92A' });

  const load = async () => {
    try { setView(((await call('GET', '/v1/onboarding/mine')).onboarding ?? null) as View | null); setError(''); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, [call]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  if (view === undefined) return <section class="onboarding">{error && <div class="err" role="alert">{error}</div>}</section>;
  if (view === null) return <section class="onboarding"><div class="msg">{t.none}</div></section>;

  const keepText = view.outcome === 'good_standing' ? t.keepGood : view.outcome === 'needs_review' ? t.keepReview : view.outcome === 'not_in_good_standing' ? t.keepNot : null;
  const stage = view.stage;

  return (
    <section class="onboarding">
      <h2>{t.title}</h2>
      <h3>{view.partnerName}</h3>
      <p>{t.stage}: <strong>{t.stageL[stage]}</strong> · {t.outcome}: <strong>{view.outcome ? t.outcomeL[view.outcome] : t.pending}</strong></p>
      {keepText && <div class={view.warning ? 'banner warn' : 'muted'} role="status">{keepText}</div>}
      {view.recheck && <p class="muted">{t.nextCheck}: {view.recheck.dueOn.slice(0, 10)}</p>}
      {error && <div class="err" role="alert">{error}</div>}

      {stage === 'invited' && (
        <>
          <p>{t.stepProfile}</p>
          <button class="btn" disabled={busy} onClick={() => run(() => call('POST', `/v1/onboarding/cases/${view.id}/form`))}>{t.submitForm}</button>
        </>
      )}

      {stage === 'form_submitted' && (
        <>
          <h3>{t.consentHead}</h3>
          <p>{t.consentIntro}</p>
          <label style={{ display: 'block' }}><input type="checkbox" checked={consent.credit} onChange={(e) => setConsent({ ...consent, credit: (e.target as HTMLInputElement).checked })} /> {t.cCredit}</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={consent.background} onChange={(e) => setConsent({ ...consent, background: (e.target as HTMLInputElement).checked })} /> {t.cBackground}</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={consent.carrier} onChange={(e) => setConsent({ ...consent, carrier: (e.target as HTMLInputElement).checked })} /> {t.cCarrier}</label>
          <button class="btn" disabled={busy || !consent.credit || !consent.background} onClick={() => run(() => call('POST', `/v1/onboarding/cases/${view.id}/consents`, {
            consents: [
              { kind: 'credit_check', accepted: consent.credit },
              { kind: 'background_check', accepted: consent.background },
              { kind: 'carrier_reporting', accepted: consent.carrier },
            ],
          }))}>{t.giveConsent}</button>
        </>
      )}

      {['consents_recorded', 'checks_requested', 'checks_complete'].includes(stage) && <p class="muted">{t.waitReview}</p>}
      {stage === 'standing_decided' && <p class="muted">{t.waitNext}</p>}
      {stage === 'agency_agreement_sent' && <p class="muted">{t.waitAgreement}</p>}
      {stage === 'agency_agreement_signed' && <p class="muted">{t.waitActivate}</p>}

      {stage === 'active' && (
        <>
          <h3>{t.packetsHead}</h3>
          {view.carrierPackets.length === 0 ? <p class="muted">{t.noPackets}</p> : (
            <ul>{view.carrierPackets.map((p) => <li>{p.carrier} · {t.packetStatus[p.status] ?? p.status}</li>)}</ul>
          )}
          <div class="erow">
            <label class="fl">{t.carrier}<input value={packet.carrier} onInput={(e) => setPacket({ ...packet, carrier: (e.target as HTMLInputElement).value })} /></label>
            <label class="fl">{t.template}<input value={packet.templateVersion} onInput={(e) => setPacket({ ...packet, templateVersion: (e.target as HTMLInputElement).value })} /></label>
            <button class="btn" disabled={busy} onClick={() => run(() => call('POST', `/v1/onboarding/cases/${view.id}/carrier-packets`, packet))}>{t.sendPacket}</button>
          </div>
        </>
      )}
    </section>
  );
}
