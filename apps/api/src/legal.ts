// Public pages: privacy policy, terms of use and support. Wording follows what the product really does (see consent.ts for the in-app notices).
export type Lang = 'en' | 'fr-CA';
export interface LegalInfo {
  country: 'CA' | 'US';
  entity: string;
  product: string;
  privacyEmail: string;
  supportEmail: string;
  stored: 'US' | 'CA';
  /** Set when signed paperwork is also copied to write-once cloud storage: the country of that storage. */
  archive?: 'US' | 'CA' | null;
  governing?: string;
  updated: string;
}
interface Section { h: string; p: string[] }
interface Doc { title: string; intro: string; sections: Section[] }

const place = (i: LegalInfo, l: Lang) => (l === 'fr-CA' ? (i.stored === 'CA' ? 'au Canada' : 'sur des serveurs sécurisés aux États-Unis') : (i.stored === 'CA' ? 'in Canada' : 'on secure servers in the United States'));

export function privacy(i: LegalInfo, l: Lang): Doc {
  const ca = i.country === 'CA';
  if (l === 'fr-CA') {
    return {
      title: 'Politique de confidentialité',
      intro: `${i.entity} (« nous ») exploite ${i.product}, un outil de gestion de la clientèle et de la conformité qui s’intègre à Gmail. Cette politique explique quels renseignements nous recueillons, pourquoi, et quels sont vos droits. Dernière mise à jour : ${i.updated}.`,
      sections: [
        { h: 'Qui utilise ce service', p: ['Le service est offert sur invitation aux partenaires, producteurs et administrateurs d’organisations du réseau. Votre organisation décide qui est invité et quel rôle chacun reçoit.'] },
        { h: 'Ce que nous recueillons', p: [
          'Votre compte Google : adresse courriel, nom et photo de profil, uniquement pour vous connecter. La connexion ne donne pas accès à votre boîte de réception.',
          'Ce que vous saisissez : fiches, contacts, pipelines, notes, tâches, paramètres et documents de conformité (permis, assurance E&O, entente de partenariat).',
          'Les conversations courriel que vous choisissez d’associer à une fiche, conservées en entier avec les noms des pièces jointes. Pour les autres messages, nous pouvons conserver des renseignements limités (expéditeur, destinataires, objet, date et bref aperçu) afin d’offrir des rappels et des suivis.',
          'Des journaux d’activité et de sécurité (qui a fait quoi et quand).'] },
        { h: 'Pourquoi nous les utilisons', p: ['Pour fournir le service à votre organisation : suivre les clients et les renouvellements, gérer la conformité des partenaires, envoyer des rappels et assurer la sécurité du service. Nous ne vendons ni ne partageons vos renseignements à des fins publicitaires.', 'L’utilisation et le transfert des renseignements reçus des API de Google respecteront la politique sur les données utilisateur des services d’API de Google, y compris les exigences d’utilisation limitée.'] },
        { h: 'Fonctions d’intelligence artificielle', p: ['Quand vous utilisez une fonction d’IA, le texte sur lequel vous lui demandez de travailler est envoyé à notre fournisseur (Anthropic) pour produire le résultat. Il n’est pas utilisé pour entraîner des modèles.'] },
        { h: 'Qui peut voir vos renseignements', p: ['Vous, vos sous-partenaires et les personnes qui vous supervisent dans votre organisation. Les autres partenaires de votre niveau n’y ont pas accès, et chaque entreprise est isolée des autres. Le siège social voit uniquement les renseignements de conformité des partenaires (permis, assurance, documents), jamais vos fiches clients.', 'Nous faisons appel à des prestataires d’hébergement et d’infrastructure pour exploiter le service. Ils n’agissent que selon nos instructions.'] },
        { h: 'Où ils sont conservés', p: [`Vos données sont conservées ${place(i, l)}. Les communications avec le service sont chiffrées (HTTPS).`, ...(i.stored === 'US' ? ['Comme les serveurs sont situés aux États-Unis, vos renseignements peuvent être accessibles aux autorités de ce pays conformément à ses lois.'] : []), ...(i.archive ? [`Les documents signés (conseils consignés et documents finals de signature) sont aussi copiés, chiffrés, dans un stockage à écriture unique d’Amazon Web Services ${i.archive === 'CA' ? 'au Canada' : 'aux États-Unis'}, afin de ne pas pouvoir être modifiés avant la fin de leur période de conservation.`] : [])] },
        { h: 'Durée de conservation', p: ['Nous conservons vos renseignements tant que votre organisation utilise le service. Si vous retirez une conversation d’une fiche, la copie conservée est supprimée. À la fin du service ou sur demande valide, nous supprimons ou anonymisons les renseignements, sauf ceux que la loi nous oblige à garder (par exemple les journaux de sécurité).'] },
        { h: 'Vos droits', p: [ca ? 'Vous pouvez demander l’accès à vos renseignements, leur correction ou leur suppression, et retirer votre consentement. Si vous croyez que vos droits n’ont pas été respectés, vous pouvez déposer une plainte auprès du Commissariat à la protection de la vie privée du Canada.' : 'Selon l’État où vous résidez, vous pouvez demander l’accès à vos renseignements, leur correction ou leur suppression. Nous ne vendons pas de renseignements personnels.', `Écrivez-nous à ${i.privacyEmail}. Nous répondons dans les 30 jours.`] },
        { h: 'Mineurs', p: ['Le service est destiné à un usage professionnel par des adultes. Il n’est pas destiné aux personnes de moins de 18 ans.'] },
        { h: 'Modifications', p: ['Nous afficherons toute modification importante dans le service avant son entrée en vigueur.'] },
        { h: 'Nous joindre', p: [`Responsable de la protection de la vie privée : ${i.privacyEmail}`] },
      ],
    };
  }
  return {
    title: 'Privacy Policy',
    intro: `${i.entity} ("we") operates ${i.product}, a client-relationship and compliance tool that works inside Gmail. This policy explains what information we collect, why, and the choices you have. Last updated: ${i.updated}.`,
    sections: [
      { h: 'Who uses this service', p: ['The service is available by invitation to partners, producers and administrators in our network. Your organization decides who is invited and what role each person has.'] },
      { h: 'What we collect', p: [
        'Your Google account: email address, name and profile picture. We use them to sign you in. While you are online, your name and photo are shown to other partners and to our staff. Signing in does not give us access to your inbox.',
        'What you enter: records, contacts, pipelines, notes, tasks, settings and compliance documents (licences, E&O insurance, partner agreement).',
        'Email conversations you choose to link to a record, stored in full with attachment names. For other messages we may keep limited details (sender, recipients, subject, date and a short preview) to provide reminders and follow-ups.',
        'Activity and security logs (who did what, and when).'] },
      { h: 'How we use it', p: ['To provide the service to your organization: tracking clients and renewals, managing partner compliance, sending reminders and keeping the service secure. We do not sell your information or share it for advertising.', 'Our use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.'] },
      { h: 'AI features', p: ['When you use an AI feature, the text you ask it to work on is sent to our provider (Anthropic) to produce the result. It is not used to train models.'] },
      { h: 'Who can see your information', p: ['You, your sub-partners and the people above you in your organization. Other partners at your level cannot see it, and each company is kept separate from every other. Head office sees only partner compliance information (licences, insurance, documents), never your client records.', 'We use hosting and infrastructure providers to run the service. They act only on our instructions.'] },
      { h: 'Where it is stored', p: [`Your data is stored ${place(i, l)}. Connections to the service are encrypted (HTTPS).`, ...(i.stored === 'US' ? ['Because the servers are in the United States, your information may be accessible to authorities there under that country’s laws.'] : []), ...(i.archive ? [`Signed documents (recorded advice and final signed paperwork) are also copied, encrypted, to write-once storage at Amazon Web Services ${i.archive === 'CA' ? 'in Canada' : 'in the United States'}, so they cannot be altered before their retention period ends.`] : [])] },
      { h: 'How long we keep it', p: ['We keep your information while your organization uses the service. If you remove a conversation from a record, the stored copy is deleted. When the service ends, or on a valid request, we delete or anonymize information, except what the law requires us to keep (for example security logs).'] },
      { h: 'Your rights', p: [ca ? 'You may ask to access, correct or delete your information, and withdraw your consent. If you believe your rights have not been respected, you may complain to the Office of the Privacy Commissioner of Canada.' : 'Depending on the state where you live, you may ask to access, correct or delete your information. We do not sell personal information.', `Write to ${i.privacyEmail}. We reply within 30 days.`] },
      { h: 'Children', p: ['The service is for professional use by adults. It is not intended for anyone under 18.'] },
      { h: 'Changes', p: ['We will show any important change inside the service before it takes effect.'] },
      { h: 'Contact', p: [`Privacy officer: ${i.privacyEmail}`] },
    ],
  };
}

export function terms(i: LegalInfo, l: Lang): Doc {
  const gov = i.governing ?? (i.country === 'US'
    ? (l === 'fr-CA' ? 'les lois de l’État de la Californie' : 'the laws of the State of California')
    : (l === 'fr-CA' ? 'les lois de la province de l’Ontario et les lois fédérales du Canada qui s’y appliquent' : 'the laws of the Province of Ontario and the federal laws of Canada applicable therein'));
  if (l === 'fr-CA') {
    return {
      title: 'Conditions d’utilisation',
      intro: `Ces conditions régissent votre utilisation de ${i.product}, exploité par ${i.entity}. En vous connectant, vous les acceptez. Dernière mise à jour : ${i.updated}.`,
      sections: [
        { h: 'Le service', p: ['Le service est offert sur invitation, pour un usage professionnel au sein de votre organisation. Votre administrateur peut modifier votre rôle ou retirer votre accès.'] },
        { h: 'Votre compte', p: ['Vous vous connectez avec votre compte Google. Gardez-le sécurisé et ne partagez pas votre accès. Vous êtes responsable de ce qui est fait avec votre compte.'] },
        { h: 'Vos données', p: ['Vos renseignements et ceux de vos clients vous appartiennent, ou appartiennent à votre organisation. Vous nous autorisez à les traiter pour fournir le service, comme décrit dans la politique de confidentialité. Vous devez avoir le droit de saisir les renseignements que vous ajoutez, et obtenir les consentements requis de vos clients.'] },
        { h: 'Usage acceptable', p: ['N’utilisez pas le service pour enfreindre la loi, envoyer du pourriel, accéder à des données qui ne sont pas les vôtres, perturber le service ou en contourner la sécurité.'] },
        { h: 'Conformité et assurance', p: ['Le service aide à suivre les permis, l’assurance E&O et les renouvellements, mais il ne fournit ni conseil juridique, ni conseil en assurance. Vous restez responsable de respecter les obligations de permis et de réglementation qui s’appliquent à vous.'] },
        { h: 'Disponibilité', p: ['Nous faisons des efforts raisonnables pour que le service soit disponible et sûr, mais il est fourni « tel quel », sans garantie, et peut être interrompu pour entretien.'] },
        { h: 'Limite de responsabilité', p: ['Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes indirectes ou accessoires, ni de la perte de profits ou de données. Notre responsabilité totale se limite à 100 $ ou au montant payé pour le service, selon le plus élevé.'] },
        { h: 'Fin du service', p: ['Votre organisation ou nous pouvons mettre fin à votre accès. Les dispositions qui doivent survivre à la fin du service continuent de s’appliquer.'] },
        { h: 'Droit applicable', p: [`Ces conditions sont régies par ${gov}.`] },
        { h: 'Nous joindre', p: [`Questions : ${i.supportEmail}`] },
      ],
    };
  }
  return {
    title: 'Terms of Use',
    intro: `These terms govern your use of ${i.product}, operated by ${i.entity}. By signing in you accept them. Last updated: ${i.updated}.`,
    sections: [
      { h: 'The service', p: ['The service is by invitation, for professional use within your organization. Your administrator may change your role or remove your access.'] },
      { h: 'Your account', p: ['You sign in with your Google account. Keep it secure and do not share your access. You are responsible for what is done with your account.'] },
      { h: 'Your data', p: ['Your information and your clients’ information belongs to you or your organization. You allow us to process it to provide the service, as described in the Privacy Policy. You must have the right to enter the information you add, and obtain any consents you need from your clients.'] },
      { h: 'Acceptable use', p: ['Do not use the service to break the law, send spam, access data that is not yours, disrupt the service or get around its security.'] },
      { h: 'Compliance and insurance', p: ['The service helps track licences, E&O insurance and renewals, but it is not legal or insurance advice. You remain responsible for meeting the licensing and regulatory obligations that apply to you.'] },
      { h: 'Availability', p: ['We make reasonable efforts to keep the service available and secure, but it is provided "as is" without warranty and may be interrupted for maintenance.'] },
      { h: 'Limit of liability', p: ['To the extent the law allows, we are not liable for indirect or incidental losses, or for lost profits or data. Our total liability is limited to $100 or the amount paid for the service, whichever is greater.'] },
      { h: 'Ending the service', p: ['Your organization or we may end your access. Terms that are meant to continue after the service ends will continue to apply.'] },
      { h: 'Governing law', p: [`These terms are governed by ${gov}.`] },
      { h: 'Contact', p: [`Questions: ${i.supportEmail}`] },
    ],
  };
}

export function support(i: LegalInfo, l: Lang): Doc {
  if (l === 'fr-CA') {
    return {
      title: 'Soutien',
      intro: `Besoin d’aide avec ${i.product}? Écrivez-nous à ${i.supportEmail}. Nous répondons habituellement en deux jours ouvrables.`,
      sections: [
        { h: 'Je ne peux pas me connecter', p: ['Utilisez le compte Google associé à l’adresse où vous avez reçu l’invitation. Si le message indique que votre compte n’est pas invité, demandez à votre administrateur de vous inviter.', 'Si le lien d’invitation a expiré, demandez à la personne qui vous a invité de vous en envoyer un nouveau.'] },
        { h: 'Je ne vois pas PII dans Gmail', p: ['Installez l’extension Chrome PII, puis rechargez Gmail. Cherchez PII dans le panneau de gauche. Si l’extension demande une mise à jour, mettez-la à jour depuis Chrome.'] },
        { h: 'Je suis administrateur dans deux pays', p: ['Utilisez le sélecteur de pays dans le menu PII. Chaque pays est un service distinct : connectez-vous à chacun une fois.'] },
        { h: 'Mes renseignements', p: [`Pour accéder à vos renseignements, les corriger ou les supprimer : ${i.privacyEmail}.`] },
        { h: 'Signaler un problème de sécurité', p: [`Écrivez à ${i.supportEmail} avec « Sécurité » dans l’objet. Ne joignez pas de renseignements sur des clients.`] },
      ],
    };
  }
  return {
    title: 'Support',
    intro: `Need help with ${i.product}? Email ${i.supportEmail}. We usually reply within two business days.`,
    sections: [
      { h: 'I cannot sign in', p: ['Use the Google account for the address where you received your invitation. If the message says your account has not been invited, ask your administrator to invite you.', 'If your invitation link has expired, ask the person who invited you to send a new one.'] },
      { h: 'I do not see PII in Gmail', p: ['Install the PII Chrome extension, then reload Gmail. Look for PII in the left panel. If the extension asks for an update, update it from Chrome.'] },
      { h: 'I am an administrator in two countries', p: ['Use the country switcher in the PII menu. Each country is a separate service, so sign in to each one once.'] },
      { h: 'My information', p: [`To access, correct or delete your information: ${i.privacyEmail}.`] },
      { h: 'Report a security problem', p: [`Email ${i.supportEmail} with "Security" in the subject. Please do not attach client information.`] },
    ],
  };
}
