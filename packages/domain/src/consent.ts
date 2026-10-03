// Consent notices (PRD Appendix A, v1). Drafted by product; counsel must review before launch.
// Region text is always stated, so the notice matches where the data really is.

export type Locale = 'en' | 'fr-CA';
export type Region = 'ca-qc' | 'us';

export const NOTICE_VERSION = 'v1';

export function regionText(locale: Locale, region: Region): string {
  if (locale === 'fr-CA') return region === 'ca-qc' ? 'au Québec' : 'aux États-Unis';
  return region === 'ca-qc' ? 'in Canada (Quebec)' : 'in the United States';
}

export interface FirstLoginParams {
  locale: Locale;
  region: Region;
  companyName: string;
  locationName?: string;
  privacyEmail: string;
  policyUrl: string;
}

function above(params: { companyName: string; locationName?: string }): string {
  return [params.locationName, params.companyName].filter(Boolean).join(', ');
}

export function firstLoginNotice(p: FirstLoginParams): string {
  const region = regionText(p.locale, p.region);
  if (p.locale === 'fr-CA') {
    return (
      `Votre organisation (${p.companyName}) utilise ce système pour gérer les relations avec la clientèle et la formation. ` +
      `Les renseignements que vous saisissez et les conversations courriel que vous choisissez d’associer à une fiche sont visibles par vous, ` +
      `par vos sous-partenaires et par les personnes qui vous supervisent dans votre organisation (${above(p)}). ` +
      `Les autres partenaires de votre niveau n’y ont pas accès. Vos données sont conservées ${region}. ` +
      `Seules les conversations que vous associez sont conservées en entier. Nous pouvons aussi conserver des renseignements limités sur les autres messages ` +
      `(expéditeur, destinataires, objet, date et bref aperçu) afin d’offrir des rappels et des fonctions de suivi. ` +
      `Vous pouvez demander d’accéder à vos renseignements, de les faire corriger ou de les faire supprimer en tout temps en communiquant avec ${p.privacyEmail}. ` +
      `Politique de confidentialité : ${p.policyUrl}.`
    );
  }
  return (
    `Your organization (${p.companyName}) uses this system to manage client relationships and training. ` +
    `Information you enter, and email conversations you choose to link to a record, are visible to you, to your sub-partners, ` +
    `and to the people above you in your organization (${above(p)}). Other partners at your level cannot see your information. ` +
    `Your data is stored ${region}. Only conversations you link are stored in full. We may also keep limited details of other messages ` +
    `(sender, recipients, subject, date and a short preview) to provide reminders and follow-up features. ` +
    `You can ask to access, correct or delete your information at any time by contacting ${p.privacyEmail}. ` +
    `Privacy policy: ${p.policyUrl}.`
  );
}

export interface LinkThreadParams {
  locale: Locale;
  region: Region;
  recordName: string;
  companyName: string;
  locationName?: string;
}

export function linkThreadNotice(p: LinkThreadParams): string {
  const region = regionText(p.locale, p.region);
  if (p.locale === 'fr-CA') {
    return (
      `Ajouter cette conversation à ${p.recordName}? Une copie de ce fil de courriels (contenu des messages et noms des pièces jointes) ` +
      `sera conservée de façon sécurisée ${region} et sera visible par vous et par les personnes qui vous supervisent dans votre organisation (${above(p)}). ` +
      `Vos autres courriels ne sont ni conservés en entier ni partagés. Vous pouvez retirer la conversation en tout temps; la copie conservée sera alors supprimée.`
    );
  }
  return (
    `Add this conversation to ${p.recordName}? A copy of this email thread (message content and attachment names) ` +
    `will be stored securely ${region} and will be visible to you and to the people above you in your organization (${above(p)}). ` +
    `Your other emails are not stored in full or shared. You can remove the conversation at any time, which deletes the stored copy.`
  );
}
