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
  import: 'Import', chooseFile: 'Choose a file', importHelp: 'Bring in records from Streak or any spreadsheet (.xlsx or .csv). The first row must be the column names, and one column must be Name.',
  importEmpty: 'The file has no rows.', importNoName: 'No “Name” column found in the first row.', importIgnored: 'not imported', importAsColumn: 'new column',
  importFields: { name: 'Name', stage: 'Stage', value: 'Value', closeDate: 'Close date', assigned: 'Owner (by email)', days: 'Days in stage', ignore: '' } as Record<string, string>,
  importGo: (n: number) => `Import ${n}`, importDone: (n: number, s: number, f: number) => `Imported ${n}. New stages: ${s}. New columns: ${f}.`, importSkipped: (n: number) => `${n} skipped`,
  editPipeline: 'Edit pipeline', colourTheme: 'Colour theme', shareDown: 'Share with the partners below me', stages: 'Stages', colour: 'Colour', moveUp: 'Move up', moveDown: 'Move down', remove: 'Remove',
  moveRecordsTo: 'Move its records to', addStage: 'Add a stage', columns: 'Columns', addColumn: 'Add a column', type: 'Type', optionsHint: 'Choices, separated by commas', needOptions: 'Add at least one choice for a dropdown column.',
  confirmColumn: (n: string) => `Remove the column “${n}”? Its values are deleted from every record.`, newPipeline: 'New pipeline', blankPipeline: 'Or start blank', templateHelp: 'Start from a ready-made pipeline. You can change everything afterwards.',
  themes: { rainbow: 'Rainbow', ocean: 'Ocean', forest: 'Forest', sunset: 'Sunset', mono: 'Grey' } as Record<string, string>,
  types: { text: 'Text', number: 'Number', currency: 'Money', date: 'Date', dropdown: 'Dropdown', checkbox: 'Checkbox' } as Record<string, string>,
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
  import: 'Importer', chooseFile: 'Choisir un fichier', importHelp: 'Importez des dossiers depuis Streak ou un tableur (.xlsx ou .csv). La première ligne doit contenir les noms de colonnes, dont « Name ».',
  importEmpty: 'Le fichier ne contient aucune ligne.', importNoName: 'Aucune colonne « Name » dans la première ligne.', importIgnored: 'non importée', importAsColumn: 'nouvelle colonne',
  importFields: { name: 'Nom', stage: 'Étape', value: 'Valeur', closeDate: 'Date de clôture', assigned: 'Responsable (courriel)', days: 'Jours à l’étape', ignore: '' } as Record<string, string>,
  importGo: (n) => `Importer ${n}`, importDone: (n, s, f) => `${n} importés. Nouvelles étapes : ${s}. Nouvelles colonnes : ${f}.`, importSkipped: (n) => `${n} ignorés`,
  editPipeline: 'Modifier le pipeline', colourTheme: 'Thème de couleurs', shareDown: 'Partager avec les partenaires sous moi', stages: 'Étapes', colour: 'Couleur', moveUp: 'Monter', moveDown: 'Descendre', remove: 'Retirer',
  moveRecordsTo: 'Déplacer ses dossiers vers', addStage: 'Ajouter une étape', columns: 'Colonnes', addColumn: 'Ajouter une colonne', type: 'Type', optionsHint: 'Choix, séparés par des virgules', needOptions: 'Ajoutez au moins un choix pour une colonne à liste.',
  confirmColumn: (n) => `Retirer la colonne « ${n} »? Ses valeurs seront supprimées de tous les dossiers.`, newPipeline: 'Nouveau pipeline', blankPipeline: 'Ou partir de zéro', templateHelp: 'Partez d’un pipeline prêt à l’emploi. Tout reste modifiable.',
  themes: { rainbow: 'Arc-en-ciel', ocean: 'Océan', forest: 'Forêt', sunset: 'Coucher de soleil', mono: 'Gris' },
  types: { text: 'Texte', number: 'Nombre', currency: 'Montant', date: 'Date', dropdown: 'Liste', checkbox: 'Case à cocher' },
  sortBy: 'Trier par', newPlaceholder: 'Nom du dossier', stalledOnly: 'Bloqués 14 jours et +', rows: (n) => (n === 1 ? '1 dossier' : `${n} dossiers`),
};
export type Strings = typeof en;
export const strings = (l: Locale): Strings => (l === 'fr-CA' ? frCA : en);
