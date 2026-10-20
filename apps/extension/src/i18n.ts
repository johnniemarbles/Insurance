export type Locale = 'en' | 'fr-CA';
const en = {
  wrongTitle: 'Different Google account', wrongBody: (gmail: string, pii: string) => `This Gmail is ${gmail}, but PII is signed in as ${pii}. Nothing is shown until they match.`, signInAs: (g: string) => `Sign in as ${g}`,
  loading: 'Loading…', signIn: 'Sign in with Google', signedOut: 'Sign in to see your CRM here.', offline: 'Cannot reach the server.',
  retry: 'Try again', notice: 'Privacy notice', accept: 'I understand', pipeline: 'Pipeline', stage: 'Stage', location: 'Location',
  createBox: 'Add this email to the CRM', boxName: 'Name', create: 'Create', creating: 'Creating…', recent: 'Recent boxes', none: 'Nothing here yet.',
  noPipeline: 'No pipeline is available to you yet. Ask your manager to create one.', created: 'Box created', saved: 'Saved',
  readOnly: 'Read only', chooseLocation: 'Choose a location', fromSender: 'Contact', search: 'Search boxes',
  addToBox: 'Add this conversation to a box', newBox: 'New box…', existingBox: 'Box', review: 'Review and add', cancel: 'Cancel', acceptAdd: 'Accept and add',
  linked: 'Conversation added', unlink: 'Remove conversation', notes: 'Notes', addNote: 'Add note', notePh: 'Write a note…', tasks: 'Tasks', addTask: 'Add task',
  taskPh: 'New task…', skipped: (n: number) => `${n} collapsed message(s) were not included. Expand them and add again to include them.`, confirmUnlink: 'Remove this conversation and delete the stored copy?',
  keysOff: 'Adding conversations is not available on this server yet.',
  share: 'Share with a teammate', shareWho: 'Who should look at this?', shareNote: 'Add a short note (optional)', shareSend: 'Send', shareDone: 'Shared. They will see it in their notifications.', shareNone: 'No teammates found.',
  aliasHint: (alias: string, pipeline: string) => `Sent to ${alias}, so this looks like a ${pipeline} lead. The pipeline is chosen for you.`,
  family: 'Family', addToFamily: 'Add', notNow: 'Not now', suggest: (n: string, f: string) => `Add ${n} to ${f}?`, added: (n: string, f: string) => `${n} added to ${f}.`,
  roles: { head: 'Head', spouse_partner: 'Spouse or partner', child: 'Child', dependent: 'Dependent', other: 'Other' } as Record<string, string>,
  reasons: { same_conversation: 'In this conversation', same_last_name: 'Same last name' } as Record<string, string>,
};
export type Strings = typeof en;
const frCA: Strings = {
  wrongTitle: 'Autre compte Google', wrongBody: (gmail: string, pii: string) => `Ce Gmail est ${gmail}, mais PII est connecté en tant que ${pii}. Rien n’est affiché tant qu’ils ne correspondent pas.`, signInAs: (g: string) => `Se connecter en tant que ${g}`,
  loading: 'Chargement…', signIn: 'Se connecter avec Google', signedOut: 'Connectez-vous pour voir votre CRM ici.', offline: 'Impossible de joindre le serveur.',
  retry: 'Réessayer', notice: 'Avis de confidentialité', accept: 'J’ai compris', pipeline: 'Pipeline', stage: 'Étape', location: 'Emplacement',
  createBox: 'Ajouter ce courriel au CRM', boxName: 'Nom', create: 'Créer', creating: 'Création…', recent: 'Fiches récentes', none: 'Rien pour le moment.',
  noPipeline: 'Aucun pipeline n’est disponible pour vous. Demandez à votre gestionnaire d’en créer un.', created: 'Fiche créée', saved: 'Enregistré',
  readOnly: 'Lecture seule', chooseLocation: 'Choisissez un emplacement', fromSender: 'Contact', search: 'Rechercher des fiches',
  addToBox: 'Ajouter cette conversation à une fiche', newBox: 'Nouvelle fiche…', existingBox: 'Fiche', review: 'Lire et ajouter', cancel: 'Annuler', acceptAdd: 'Accepter et ajouter',
  linked: 'Conversation ajoutée', unlink: 'Retirer la conversation', notes: 'Notes', addNote: 'Ajouter une note', notePh: 'Écrire une note…', tasks: 'Tâches', addTask: 'Ajouter une tâche',
  taskPh: 'Nouvelle tâche…', skipped: (n: number) => `${n} message(s) réduit(s) n’ont pas été inclus. Développez-les et ajoutez de nouveau pour les inclure.`, confirmUnlink: 'Retirer cette conversation et supprimer la copie conservée?',
  keysOff: 'L’ajout de conversations n’est pas encore disponible sur ce serveur.',
  share: 'Partager avec un collègue', shareWho: 'Qui devrait regarder ceci?', shareNote: 'Ajoutez une courte note (facultatif)', shareSend: 'Envoyer', shareDone: 'Partagé. La personne le verra dans ses notifications.', shareNone: 'Aucun collègue trouvé.',
  aliasHint: (alias: string, pipeline: string) => `Envoyé à ${alias}: il s’agit sans doute d’une piste « ${pipeline} ». Le pipeline est choisi pour vous.`,
  family: 'Famille', addToFamily: 'Ajouter', notNow: 'Pas maintenant', suggest: (n: string, f: string) => `Ajouter ${n} à ${f}?`, added: (n: string, f: string) => `${n} ajouté à ${f}.`,
  roles: { head: 'Chef de famille', spouse_partner: 'Conjoint ou partenaire', child: 'Enfant', dependent: 'Personne à charge', other: 'Autre' } as Record<string, string>,
  reasons: { same_conversation: 'Dans cette conversation', same_last_name: 'Même nom de famille' } as Record<string, string>,
};
export const strings = (l: Locale): Strings => (l === 'fr-CA' ? frCA : en);
