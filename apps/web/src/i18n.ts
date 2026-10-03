import type { Locale } from './types.ts';

const en = {
  needConsent: 'Open the PII panel on any email in Gmail to read and accept the privacy notice first.', loading: 'Loading…', retry: 'Try again', signedOut: 'Sign in to use PII.', signIn: 'Sign in with Google', offline: 'Cannot reach the server.',
  noPipelines: 'No pipelines yet. Ask your administrator to create one.', pipeline: 'Pipeline',
  all: 'All', mine: 'Mine', below: 'My team', search: 'Search', newBox: 'New', name: 'Name', stage: 'Stage', value: 'Value',
  closeDate: 'Close date', inStage: 'In stage', days: (n: number) => (n === 1 ? '1 day' : `${n} days`), today: 'Today',
  empty: 'Nothing here yet.', loadMore: 'Load more', create: 'Create', cancel: 'Cancel', close: 'Close', location: 'Location',
  chooseLocation: 'Choose a location', history: 'History', created: 'Created in', movedTo: (a: string | null, b: string | null) => `Moved from ${a ?? '—'} to ${b ?? '—'}`,
  saved: 'Saved', total: (n: number) => `${n} total`, edit: 'Edit', clearFilter: 'Show all stages', readOnly: 'View only: this record belongs to another branch.',
  table: 'Table', board: 'Board', selected: (n: number) => `${n} selected`, moveTo: 'Move to stage', apply: 'Apply', selectAll: 'Select all', bulkFailed: (n: number) => `${n} could not be moved (view-only records).`,
  sortBy: 'Sort by', newPlaceholder: 'Name of the record', stalledOnly: 'Stuck 14+ days', rows: (n: number) => (n === 1 ? '1 record' : `${n} records`),
};
const frCA: typeof en = {
  needConsent: 'Ouvrez le panneau PII sur un courriel dans Gmail pour lire et accepter l’avis de confidentialité.', loading: 'Chargement…', retry: 'Réessayer', signedOut: 'Connectez-vous pour utiliser PII.', signIn: 'Se connecter avec Google', offline: 'Impossible de joindre le serveur.',
  noPipelines: 'Aucun pipeline pour l’instant. Demandez à votre administrateur d’en créer un.', pipeline: 'Pipeline',
  all: 'Tous', mine: 'Les miens', below: 'Mon équipe', search: 'Rechercher', newBox: 'Nouveau', name: 'Nom', stage: 'Étape', value: 'Valeur',
  closeDate: 'Date de clôture', inStage: 'À cette étape', days: (n: number) => (n === 1 ? '1 jour' : `${n} jours`), today: 'Aujourd’hui',
  empty: 'Rien ici pour l’instant.', loadMore: 'Afficher plus', create: 'Créer', cancel: 'Annuler', close: 'Fermer', location: 'Emplacement',
  chooseLocation: 'Choisir un emplacement', history: 'Historique', created: 'Créé à l’étape', movedTo: (a, b) => `Déplacé de ${a ?? '—'} à ${b ?? '—'}`,
  saved: 'Enregistré', total: (n) => `${n} au total`, edit: 'Modifier', clearFilter: 'Afficher toutes les étapes', readOnly: 'Lecture seule : ce dossier appartient à une autre branche.',
  table: 'Tableau', board: 'Tableau Kanban', selected: (n) => (n === 1 ? '1 sélectionné' : `${n} sélectionnés`), moveTo: 'Déplacer à l’étape', apply: 'Appliquer', selectAll: 'Tout sélectionner', bulkFailed: (n) => `${n} n’ont pas pu être déplacés (lecture seule).`,
  sortBy: 'Trier par', newPlaceholder: 'Nom du dossier', stalledOnly: 'Bloqués 14 jours et +', rows: (n) => (n === 1 ? '1 dossier' : `${n} dossiers`),
};
export type Strings = typeof en;
export const strings = (l: Locale): Strings => (l === 'fr-CA' ? frCA : en);
