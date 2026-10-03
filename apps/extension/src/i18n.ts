export type Locale = 'en' | 'fr-CA';
const en = {
  loading: 'Loading…', signIn: 'Sign in with Google', signedOut: 'Sign in to see your CRM here.', offline: 'Cannot reach the server.',
  retry: 'Try again', notice: 'Privacy notice', accept: 'I understand', pipeline: 'Pipeline', stage: 'Stage', location: 'Location',
  createBox: 'Add this email to the CRM', boxName: 'Name', create: 'Create', creating: 'Creating…', recent: 'Recent boxes', none: 'Nothing here yet.',
  noPipeline: 'No pipeline is available to you yet. Ask your manager to create one.', created: 'Box created', saved: 'Saved',
  readOnly: 'Read only', chooseLocation: 'Choose a location', fromSender: 'Contact', search: 'Search boxes',
};
const frCA: typeof en = {
  loading: 'Chargement…', signIn: 'Se connecter avec Google', signedOut: 'Connectez-vous pour voir votre CRM ici.', offline: 'Impossible de joindre le serveur.',
  retry: 'Réessayer', notice: 'Avis de confidentialité', accept: 'J’ai compris', pipeline: 'Pipeline', stage: 'Étape', location: 'Emplacement',
  createBox: 'Ajouter ce courriel au CRM', boxName: 'Nom', create: 'Créer', creating: 'Création…', recent: 'Fiches récentes', none: 'Rien pour le moment.',
  noPipeline: 'Aucun pipeline n’est disponible pour vous. Demandez à votre gestionnaire d’en créer un.', created: 'Fiche créée', saved: 'Enregistré',
  readOnly: 'Lecture seule', chooseLocation: 'Choisissez un emplacement', fromSender: 'Contact', search: 'Rechercher des fiches',
};
export type Strings = typeof en;
export const strings = (l: Locale): Strings => (l === 'fr-CA' ? frCA : en);
